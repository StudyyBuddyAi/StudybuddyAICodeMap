import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { ChatOpenAI, OpenAIEmbeddings } from "npm:@langchain/openai@0.3.0";
import { awaitAllCallbacks } from "npm:@langchain/core@0.3.0/callbacks/promises";
import { LangChainTracer } from "npm:@langchain/core@0.3.0/tracers/tracer_langchain";
import { Client as LangSmithClient } from "npm:langsmith@0.3.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-model-used",
};

interface GuidelineChunkMatch {
  id: string;
  guideline_id: string;
  guideline_name: string;
  section_title: string | null;
  content: string;
  source_url: string | null;
  similarity: number;
}

interface RagSource {
  id: string;
  similarity: number;
  guidelineName: string;
  sourceName: string;
  sectionTitle: string | null;
  sourceUrl: string | null;
  content: string;
  metadata: Record<string, unknown>;
}

// Structured, machine-parseable logs for Supabase edge-fn logs
const log = (event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ fn: "rag-generate", event, ...fields }));
};

// We keep a module-level reference so flushTraces() can reach it.
let _langSmithClient: LangSmithClient | null = null;

async function flushTraces() {
  try {
    // 1. Await LangChain's internal callback-manager queue
    await awaitAllCallbacks();
    log("callbacks_flushed_ok");
  } catch (flushErr: unknown) {
    const flushMsg = flushErr instanceof Error ? flushErr.message : String(flushErr);
    log("callbacks_flush_error", { err: flushMsg });
  }

  // 2. Await LangSmithClient's own HTTP batch queue — this is the
  //    critical step: the client batches POSTs to api.smith.langchain.com
  //    independently of LangChain's callback manager, so without this
  //    the Deno isolate can die before the traces actually leave the process.
  if (_langSmithClient) {
    try {
      await _langSmithClient.awaitPendingTraceBatches();
      log("langsmith_batches_flushed_ok");
    } catch (batchErr: unknown) {
      const batchMsg = batchErr instanceof Error ? batchErr.message : String(batchErr);
      log("langsmith_batches_flush_error", { err: batchMsg });
    }
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    // ── 1. Environment & Validation ─────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  // Optional secret that allows secure diagnostics without exposing keys.
  const ragDebugToken = Deno.env.get("RAG_DEBUG_TOKEN");

  if (!supabaseUrl || !serviceRoleKey || !openRouterApiKey) {
    log("missing_env_vars");
    return new Response(
      JSON.stringify({ error: { code: "CONFIG_ERROR", message: "Server environment misconfigured" } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

    // LangSmith tracing: بمجرد ما تحط الـ secrets التالية على Supabase،
    // كل استدعاء LangChain تحت رح يترسل تلقائياً لـ LangSmith كـ trace:
    //   supabase secrets set LANGCHAIN_TRACING_V2=true
    //   supabase secrets set LANGCHAIN_API_KEY=xxx
    //   supabase secrets set LANGCHAIN_PROJECT=StudyBuddyAI
    // ما في داعي لأي كود إضافي هون.

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Verify JWT to get authenticated user identity if provided
    let userId = "anonymous";
    if (token) {
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);
      if (user?.id) {
        userId = user.id;
      }
    }

    const body = await req.json().catch(() => ({}));
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const topK = typeof body.topK === "number" ? body.topK : 5;
    const threshold = typeof body.threshold === "number" ? body.threshold : 0.65;
    const feature = typeof body.feature === "string" ? body.feature : "general";

    if (!query) {
      return new Response(
        JSON.stringify({ error: { code: "INVALID_INPUT", message: "Query string is required" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── LangChain clients (عبر OpenRouter، متل ما كانوا بالـ fetch القديم) ──
    const embeddings = new OpenAIEmbeddings({
      apiKey: openRouterApiKey,
      configuration: { baseURL: "https://openrouter.ai/api/v1" },
      modelName: "text-embedding-3-small",
    });

    const chatModel = new ChatOpenAI({
      apiKey: openRouterApiKey,
      configuration: { baseURL: "https://openrouter.ai/api/v1" },
      modelName: "gpt-4o-mini",
      temperature: 0.3,
    });

    // Tracer صريح بدل الاعتماد على auto-detection عبر env vars
    // (اللي ممكن ما يشتغل صح جوا بيئة Deno Edge Function)
    const langsmithApiKey = Deno.env.get("LANGSMITH_API_KEY") ?? Deno.env.get("LANGCHAIN_API_KEY");
    const langsmithProject =
      Deno.env.get("LANGSMITH_PROJECT") ?? Deno.env.get("LANGCHAIN_PROJECT") ?? "default";

    let tracers: LangChainTracer[] = [];

    // small helper to mask secrets before logging/returning diagnostics
    const maskKey = (k: string | undefined | null) => {
      if (!k) return null;
      if (k.length <= 8) return "****";
      return `${k.slice(0, 4)}...${k.slice(-4)}`;
    };

    if (langsmithApiKey) {
      _langSmithClient = new LangSmithClient({
        apiKey: langsmithApiKey,
        apiUrl: "https://api.smith.langchain.com",
      });

      tracers = [
        new LangChainTracer({
          projectName: langsmithProject,
          client: _langSmithClient,
        }),
      ];

      log("langsmith_tracer_configured", { project: langsmithProject, keyMask: maskKey(langsmithApiKey) });
    } else {
      log("langsmith_key_missing");
    }

    // Secure diagnostics: if the caller provides a debugToken matching RAG_DEBUG_TOKEN
    // the function will return non-secret diagnostics that help debug tracing issues.
    // To use: set RAG_DEBUG_TOKEN in your project secrets, then POST { "debugToken": "<token>" }.
    if (typeof body === "object" && (body as any).debugToken && ragDebugToken && (body as any).debugToken === ragDebugToken) {
      const diag: Record<string, unknown> = {
        langsmithConfigured: !!langsmithApiKey,
        langsmithProject,
        langsmithKeyMask: maskKey(langsmithApiKey),
        langchainTracingV2: Deno.env.get("LANGCHAIN_TRACING_V2") === "true",
      };

      try {
        await awaitAllCallbacks();
        (diag as any).callbacksFlushed = true;
      } catch (e: unknown) {
        (diag as any).callbacksFlushError = e instanceof Error ? e.message : String(e);
      }

      if (_langSmithClient) {
        try {
          await _langSmithClient.awaitPendingTraceBatches();
          (diag as any).langsmithBatchesFlushed = true;
        } catch (e: unknown) {
          (diag as any).langsmithBatchesFlushError = e instanceof Error ? e.message : String(e);
        }
      }

      return new Response(JSON.stringify({ diagnostics: diag }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 2. Create Query Embedding (عبر LangChain) ───────────────────
    log("embedding_start", { userId, queryLength: query.length });

    let queryEmbedding: number[];
    try {
      // Pass tracers so the embedding call is also recorded in LangSmith
      queryEmbedding = await embeddings.embedQuery(query, {
        callbacks: tracers,
        runName: "rag-generate-embedding",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create query embedding";
      log("embedding_failed", { err: message });
      await flushTraces();
      return new Response(
        JSON.stringify({
          error: { code: "EMBEDDING_FAILED", message, refundQuota: true },
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 3. Vector Search via Supabase RPC ───────────────────────────
    log("rpc_search_start", { topK, threshold });

    const { data: chunks, error: rpcError } = await supabaseAdmin.rpc("match_guideline_chunks", {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: topK,
    });

    if (rpcError) {
      log("rpc_search_failed", { rpcError });
    }

    const matches: GuidelineChunkMatch[] = Array.isArray(chunks) ? chunks : [];

    // ── 4. Evaluate Retrieval Quality & Build System Prompt ──────────
    let grounded = false;
    let context = "";
    let sources: RagSource[] = [];

    if (matches.length > 0) {
      // Populate context and sources whenever any matches are returned from the DB.
      // `grounded` remains a strict flag indicating whether top match meets the
      // similarity threshold; even when below threshold we still surface the
      // retrieved sources so the caller can inspect them.
      context = matches
        .map(
          (chunk, i) =>
            `[Source ${i + 1}: ${chunk.guideline_name}${chunk.section_title ? " - " + chunk.section_title : ""}]\n${chunk.content}`
        )
        .join("\n\n");

      sources = matches.map((chunk) => ({
        id: chunk.id,
        similarity: chunk.similarity,
        guidelineName: chunk.guideline_name,
        sourceName: chunk.guideline_name,
        sectionTitle: chunk.section_title ?? null,
        sourceUrl: chunk.source_url ?? null,
        content: chunk.content,
        metadata: {},
      }));

      grounded = matches[0].similarity >= threshold;
    }

    const systemPrompt = grounded
      ? `You are StudyBuddy AI, a medical study assistant. Use ONLY the following retrieved reference material to answer the user's request. When information is present in the retrieved material, answer using that material and DO NOT invent or infer additional facts. Always include inline citations referencing the exact source(s) you used in square brackets using this format: "[Source 1: Guideline Name - Section Title]". After the main answer, append a clear "SOURCES" section that lists each retrieved source in order with its index, guideline name, section title (if any), and source URL (if any). If the retrieved material does not fully answer the user's question, explicitly say so and list what remains unknown. Do not fabricate sources; do not claim evidence you do not have.\n\nContext:\n${context}`
      : `You are StudyBuddy AI, a medical study assistant. No specific reference material was found in the knowledge base for this topic. Answer using your general medical knowledge, and note that this response is not grounded in a verified source.`;

    // ── 5. Call AI Provider (Chat Completion) عبر LangChain ─────────
    log("completion_start", { grounded, matchesCount: matches.length });

    let answer: string;
    try {
      const response = await chatModel.invoke(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: query },
        ],
        { callbacks: tracers, runName: "rag-generate-completion" }
      );
      answer = response.content as string;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "AI provider request failed";
      log("completion_failed", { err: message });
      await flushTraces();
      return new Response(
        JSON.stringify({
          error: { code: "AI_PROVIDER_FAILED", message, refundQuota: true },
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 6. Asynchronous Audit Logging ───────────────────────────────
    if (userId !== "anonymous") {
      supabaseAdmin
        .from("rag_logs")
        .insert({
          user_id: userId,
          feature,
          query,
          grounded,
          source_ids: sources.map((s) => s.id),
        })
        .then(({ error: logErr }) => {
          if (logErr) log("audit_log_failed", { err: logErr });
        });
    }

    log("rag_success", { elapsedMs: Date.now() - startedAt, grounded, sourcesCount: sources.length });

    // مهم بالـ Edge Functions: ننتظر إرسال أي traces معلقة لـ LangSmith
    // قبل ما نرجع الـ response ويتقفل الـ isolate، وإلا الـ traces بتنضاع
    await flushTraces();

    // ── 7. Return Success Response ──────────────────────────────────
    return new Response(
      JSON.stringify({
        answer,
        grounded,
        sources,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    log("unexpected_error", { err: message });

    // Even on unexpected errors, try to flush any partial traces
    await flushTraces();

    return new Response(
      JSON.stringify({ error: { code: "INTERNAL_ERROR", message } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});