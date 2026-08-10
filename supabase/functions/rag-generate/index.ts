import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

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

    if (!supabaseUrl || !serviceRoleKey || !openRouterApiKey) {
      log("missing_env_vars");
      return new Response(
        JSON.stringify({ error: { code: "CONFIG_ERROR", message: "Server environment misconfigured" } }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // ── 2. Create Query Embedding via OpenRouter ────────────────────
    log("embedding_start", { userId, queryLength: query.length });

    const embeddingRes = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openRouterApiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: query,
      }),
    });

    const embeddingData = await embeddingRes.json().catch(() => null);

    if (
      !embeddingRes.ok ||
      !embeddingData?.data?.[0]?.embedding ||
      !Array.isArray(embeddingData.data[0].embedding)
    ) {
      log("embedding_failed", { status: embeddingRes.status, err: embeddingData?.error });
      return new Response(
        JSON.stringify({
          error: {
            code: "EMBEDDING_FAILED",
            message: embeddingData?.error?.message || "Failed to create query embedding",
            refundQuota: true,
          },
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const queryEmbedding: number[] = embeddingData.data[0].embedding;

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

    if (matches.length > 0 && matches[0].similarity >= threshold) {
      grounded = true;
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
    }

    const systemPrompt = grounded
      ? `You are StudyBuddy AI, a medical study assistant. Use ONLY the following retrieved reference material to answer the user's request. Always cite and reference the source guideline name (e.g., "[Source: Guideline Name - Section Title]") when citing facts in your answer. If the context does not fully cover the topic, say so explicitly rather than guessing.\n\nContext:\n${context}`
      : `You are StudyBuddy AI, a medical study assistant. No specific reference material was found in the knowledge base for this topic. Answer using your general medical knowledge, and note that this response is not grounded in a verified source.`;

    // ── 5. Call AI Provider (Chat Completion) via OpenRouter ────────
    log("completion_start", { grounded, matchesCount: matches.length });

    const completionRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openRouterApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query },
        ],
        temperature: 0.3,
      }),
    });

    const completionData = await completionRes.json().catch(() => null);

    if (!completionRes.ok || !completionData?.choices?.[0]?.message?.content) {
      log("completion_failed", { status: completionRes.status, err: completionData?.error });
      return new Response(
        JSON.stringify({
          error: {
            code: "AI_PROVIDER_FAILED",
            message: completionData?.error?.message || "AI provider request failed",
            refundQuota: true,
          },
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const answer = completionData.choices[0].message.content;

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

    return new Response(
      JSON.stringify({ error: { code: "INTERNAL_ERROR", message } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
