import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { ChatOpenAI, OpenAIEmbeddings } from "npm:@langchain/openai@0.3.0";
import { awaitAllCallbacks } from "npm:@langchain/core@0.3.0/callbacks/promises";
import { LangChainTracer } from "npm:@langchain/core@0.3.0/tracers/tracer_langchain";
import { Client as LangSmithClient } from "npm:langsmith@0.3.6";

const ALLOWED_ORIGINS = new Set([
  "https://studyybuddyai.com",
  "https://www.studyybuddyai.com",
  "http://localhost:8080",
]);

const BASE_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-model-used",
};

// Origin-aware CORS. Only allowlisted origins get Access-Control-Allow-Origin;
// anything else gets no CORS headers (browser denies the cross-origin call).
function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return { ...BASE_CORS_HEADERS };
  }
  return { ...BASE_CORS_HEADERS, "Access-Control-Allow-Origin": origin };
}

const MAX_QUERY_LENGTH = 10_000;
const MAX_BODY_BYTES = 102_400; // 100 KB

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

async function flushTraces(client: LangSmithClient | null) {
  try {
    await awaitAllCallbacks();
    if (client) {
      await client.awaitPendingTraceBatches();
    }
    log("callbacks_flushed_ok");
  } catch (flushErr: unknown) {
    const flushMsg = flushErr instanceof Error ? flushErr.message : String(flushErr);
    log("callbacks_flush_error", { err: flushMsg });
  }
}

/**
 * Decode a verified JWT's payload (middle segment) to read identity claims.
 * Used for `is_anonymous`, which the DB also reads via `auth.jwt() ->> 'is_anonymous'`.
 * Returns {} on any parse failure — never throws.
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const b64url = token.split(".")[1] ?? "";
    const pad = b64url.length % 4 === 0 ? "" : "=".repeat(4 - (b64url.length % 4));
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

// Best-effort per-instance burst limiter. Deno isolates are ephemeral (a
// module-level Map does not survive cold starts and is not shared across
// instances), so this only flattens bursts — it is NOT a distributed limit.
// The daily usage_records quota is the authoritative control.
const BURST_LIMIT_PER_MINUTE = 10;
const burstBuckets = new Map<string, number[]>();

function checkBurstLimit(userId: string, nowMs: number): boolean {
  const cutoff = nowMs - 60_000;
  const recent = (burstBuckets.get(userId) ?? []).filter((t) => t > cutoff);
  if (recent.length >= BURST_LIMIT_PER_MINUTE) {
    burstBuckets.set(userId, recent);
    return false;
  }
  recent.push(nowMs);
  burstBuckets.set(userId, recent);
  return true;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }

  const startedAt = Date.now();
  let quotaConsumed = false;
  let userId = "";

  try {
    // ── 1. Environment & Validation ─────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");

    if (!supabaseUrl || !serviceRoleKey || !openRouterApiKey) {
      log("missing_env_vars");
      return new Response(
        JSON.stringify({ error: { code: "CONFIG_ERROR", message: "Server environment misconfigured" } }),
          { status: 500, headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    // LangSmith tracing: بمجرد ما تحط الـ secrets التالية على Supabase،
    // كل استدعاء LangChain تحت رح يترسل تلقائياً لـ LangSmith كـ trace:
    //   supabase secrets set LANGCHAIN_TRACING_V2=true
    //   supabase secrets set LANGCHAIN_API_KEY=xxx
    //   supabase secrets set LANGCHAIN_PROJECT=StudyBuddyAI
    // ما في داعي لأي كود إضافي هون.

    // ── JWT verification ──────────────────────────────────────────────
    // Reject missing/invalid tokens before doing any work. The client sends the
    // user's Supabase access token as the Authorization bearer.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Missing or invalid token" } }),
        { status: 401, headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Missing or invalid token" } }),
        { status: 401, headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    userId = user.id;

    // ── Burst rate limit (best-effort, per-instance) ──────────────────
    if (!checkBurstLimit(userId, Date.now())) {
      return new Response(
        JSON.stringify({ error: { code: "RATE_LIMITED", message: "Rate limit exceeded" } }),
        { status: 429, headers: { ...buildCorsHeaders(req), "Content-Type": "application/json", "Retry-After": "60" } }
      );
    }

    // ── Server-side identity & entitlement ────────────────────────────
    // Entitlement is derived from the verified JWT + profiles row,
    // never from request body fields. Any isPro / isAnonymous / userId
    // sent in the request body are UI hints at most and are ignored here.
    const isAnonymous =
      user.is_anonymous === true || decodeJwtPayload(token).is_anonymous === true;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("is_pro, pro_expires_at")
      .eq("id", userId)
      .maybeSingle();

    const isProUser =
      profile?.is_pro === true &&
      (profile.pro_expires_at === null ||
        new Date(profile.pro_expires_at) > new Date());

    const declaredLength = Number(req.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      log("body_too_large", { declaredLength });
      return new Response(
        JSON.stringify({ error: { code: "INVALID_INPUT", message: "Request body too large" } }),
        { status: 400, headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const topK = typeof body.topK === "number" ? body.topK : 5;
    const threshold = typeof body.threshold === "number" ? body.threshold : 0.65;
    const feature = typeof body.feature === "string" ? body.feature : "general";

    if (!query) {
      return new Response(
        JSON.stringify({ error: { code: "INVALID_INPUT", message: "Query string is required" } }),
        { status: 400, headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    if (query.length > MAX_QUERY_LENGTH) {
      log("query_too_long", { queryLength: query.length });
      return new Response(
        JSON.stringify({ error: { code: "INVALID_INPUT", message: "Query too long" } }),
        { status: 400, headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    // ── Server-side daily RAG quota ──────────────────────────────────
    // Consume before calling AI; refund below if the upstream call fails
    // so failed generations never burn quota. Pro users are uncapped.
    const ANON_RAG_LIMIT = 3;
    const FREE_RAG_LIMIT = 5;

    if (!isProUser) {
      const ragCap = isAnonymous ? ANON_RAG_LIMIT : FREE_RAG_LIMIT;
      const { data: consumeResult, error: consumeError } = await supabaseAdmin.rpc(
        "consume_usage",
        { p_user: userId, p_kind: "rag", p_cap: ragCap }
      );
      if (consumeError) {
        console.error("consume_usage failed:", consumeError);
        return new Response(
          JSON.stringify({ error: { code: "QUOTA_CHECK_FAILED", message: "Quota check failed" } }),
        { status: 500, headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" } }
        );
      }
      if (!consumeResult?.allowed) {
        return new Response(
          JSON.stringify({ error: { code: "QUOTA_EXCEEDED", message: "Daily RAG limit reached" } }),
          { status: 429, headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" } }
        );
      }
      quotaConsumed = true;
    }

    log("request_authenticated", {
      userId,
      isAnonymous,
      isProUser,
      quotaConsumed,
      queryLength: query.length,
    });

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

    const langsmithClient = langsmithApiKey
      ? new LangSmithClient({
          apiKey: langsmithApiKey,
          apiUrl: "https://api.smith.langchain.com",
        })
      : null;

    const tracers = langsmithClient
      ? [new LangChainTracer({ projectName: langsmithProject, client: langsmithClient })]
      : [];

    if (!langsmithApiKey) {
      log("langsmith_key_missing");
    }

    // ── Conversation Memory: sliding window of 10 questions per user ──
    // After the 10th question, the 11th starts a new window (full reset).
    // Old data remains in the table (never deleted).
    const conversationHistory: { role: "user" | "assistant"; content: string }[] = [];
    let memoryWindowId: string | null = null;
    let memoryTurnCount = 0;

    const { data: stateRow } = await supabaseAdmin
      .from("rag_memory_state")
      .select("current_window_id, turn_count")
      .eq("user_id", userId)
      .maybeSingle();

    if (!stateRow) {
      const { data: newState } = await supabaseAdmin
        .from("rag_memory_state")
        .insert({ user_id: userId })
        .select("current_window_id, turn_count")
        .single();
      memoryWindowId = newState?.current_window_id ?? null;
      memoryTurnCount = 0;
    } else if (stateRow.turn_count >= 10) {
      const { data: resetState } = await supabaseAdmin
        .from("rag_memory_state")
        .update({ current_window_id: crypto.randomUUID(), turn_count: 0, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .select("current_window_id, turn_count")
        .single();
      memoryWindowId = resetState?.current_window_id ?? null;
      memoryTurnCount = 0;
    } else {
      memoryWindowId = stateRow.current_window_id;
      memoryTurnCount = stateRow.turn_count;
    }

    if (memoryWindowId) {
      const { data: historyRows } = await supabaseAdmin
        .from("rag_conversation_memory")
        .select("question, answer")
        .eq("user_id", userId)
        .eq("window_id", memoryWindowId)
        .order("turn_number", { ascending: true });

      for (const row of historyRows ?? []) {
        conversationHistory.push({ role: "user", content: row.question });
        conversationHistory.push({ role: "assistant", content: row.answer });
      }
    }

    log("memory_window_resolved", { windowId: memoryWindowId, turnCount: memoryTurnCount });

    // ── 2. Create Query Embedding (عبر LangChain) ───────────────────
    log("embedding_start", { userId, queryLength: query.length });

    let queryEmbedding: number[];
    try {
      queryEmbedding = await embeddings.embedQuery(query);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create query embedding";
      log("embedding_failed", { err: message });
      // Refund the consumed quota so a failed embedding never burns quota.
      if (quotaConsumed) {
        try {
          await supabaseAdmin.rpc("refund_usage", { p_user: userId, p_kind: "rag" });
        } catch { /* best effort */ }
      }
      await flushTraces(langsmithClient);
      return new Response(
        JSON.stringify({
          error: { code: "EMBEDDING_FAILED", message: "Unable to process query", refundQuota: true },
        }),
        { status: 502, headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" } }
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

    let systemPrompt = grounded
      ? `You are StudyBuddy AI, a medical study assistant. Use ONLY the following retrieved reference material to answer the user's request. Always cite and reference the source guideline name (e.g., "[Source: Guideline Name - Section Title]") when citing facts in your answer. If the context does not fully cover the topic, say so explicitly rather than guessing.\n\nContext:\n${context}`
      : `You are StudyBuddy AI, a medical study assistant. No specific reference material was found in the knowledge base for this topic. Answer using your general medical knowledge, and note that this response is not grounded in a verified source.`;

    // ── Fix 3: إذا في تاريخ محادثة، خبّر الموديل يستخدمه ──
    if (conversationHistory.length > 0) {
      systemPrompt += `\n\nIMPORTANT: You have access to the previous conversation history between you and this user (provided as prior user/assistant message pairs). Use this context to understand follow-up questions, resolve pronouns (e.g., "it", "that", "the same"), and maintain continuity. If the user refers to something from a previous turn, answer in that context.`;
    }

    // ── 5. Call AI Provider (Chat Completion) عبر LangChain ─────────
    log("completion_start", { grounded, matchesCount: matches.length });

    let answer: string;
    try {
      const response = await chatModel.invoke(
        [
          { role: "system", content: systemPrompt },
          ...conversationHistory,
          { role: "user", content: query },
        ],
        { callbacks: tracers, runName: "rag-generate-completion" }
      );
      answer = response.content as string;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "AI provider request failed";
      log("completion_failed", { err: message });
      // Refund the consumed quota so a failed completion never burns quota.
      if (quotaConsumed) {
        try {
          await supabaseAdmin.rpc("refund_usage", { p_user: userId, p_kind: "rag" });
        } catch { /* best effort */ }
      }
      await flushTraces(langsmithClient);
      return new Response(
        JSON.stringify({
          error: { code: "AI_PROVIDER_FAILED", message: "Unable to generate response", refundQuota: true },
        }),
        { status: 502, headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    // ── 6. Asynchronous Audit Logging & Conversation Memory ──────────
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

    // Save this turn to conversation memory. Must await before returning
    // the response so the Deno isolate doesn't kill the write.
    if (memoryWindowId) {
      const [memResult, stateResult] = await Promise.all([
        supabaseAdmin
          .from("rag_conversation_memory")
          .insert({
            user_id: userId,
            window_id: memoryWindowId,
            turn_number: memoryTurnCount + 1,
            question: query,
            answer,
          }),
        supabaseAdmin
          .from("rag_memory_state")
          .update({ turn_count: memoryTurnCount + 1, updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("current_window_id", memoryWindowId),
      ]);
      if (memResult.error) log("memory_save_failed", { err: memResult.error });
      if (stateResult.error) log("memory_state_update_failed", { err: stateResult.error });
    }

    log("rag_success", { elapsedMs: Date.now() - startedAt, grounded, sourcesCount: sources.length, quotaConsumed });

    // مهم بالـ Edge Functions: ننتظر إرسال أي traces معلقة لـ LangSmith
    // قبل ما نرجع الـ response ويتقفل الـ isolate، وإلا الـ traces بتنضاع
    await flushTraces(langsmithClient);

    // ── 7. Return Success Response ──────────────────────────────────
    return new Response(
      JSON.stringify({
        answer,
        grounded,
        sources,
      }),
      { status: 200, headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    log("unexpected_error", { err: message });
    // Refund the consumed quota so a crashed request never burns quota.
    if (quotaConsumed) {
      try {
        const refundClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        await refundClient.rpc("refund_usage", { p_user: userId, p_kind: "rag" });
      } catch { /* best effort */ }
    }

    return new Response(
      JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }),
      { status: 500, headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});