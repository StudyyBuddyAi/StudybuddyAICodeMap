/**
 * The medical-notes request handler: study sheets, flashcard decks, explain
 * and enhance.
 *
 * Tiers decide the writer:
 *   - Premium — Pro users (unless they chose "fastest"), and free/anon users'
 *     first premium-hook generations — are written by Corti
 *     (CORTI_NOTES_MODEL, default corti-s1-instant) with the prompts adjusted
 *     for it (_shared/medical-notes-prompts-corti.ts).
 *   - Everyone else is written by GPT-OSS 20B through OpenRouter (Cerebras /
 *     Groq), with the original GPT-OSS prompts (_shared/medical-notes-prompts.ts).
 *   - If Corti cannot serve a premium request before streaming starts, Claude
 *     Haiku 4.5 answers it instead, and the response says so
 *     (X-Model-Fallback: corti_unavailable) so the client can show it.
 *
 * The provider comparison behind these choices is docs/corti-provider-spike.md.
 *
 * Everything that must happen before the writer is called — retrieval,
 * memory, profile, premium hook, quota — runs concurrently where the steps are
 * independent, and each stage's duration is logged.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { makeEmbeddings, embedQuery, retrieveChunks, type RagChunk } from "./rag.ts";
import { requestSourceLabels, type RawSourceLabel } from "./source-labels.ts";
import {
  openMemoryWindow,
  readMemoryTurns,
  writeUserTurn,
  completeTurn,
  trim500,
  type MemoryTurn,
} from "./memory.ts";
import { buildNotesPrompts, type NotesPromptInput } from "./medical-notes-prompts.ts";
import { buildCortiNotesPrompts } from "./medical-notes-prompts-corti.ts";
import { asCortiModel, cortiChatCompletion, cortiConfigFromEnv, type CortiModel } from "./corti.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-simulate-corti-outage, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-model-used, x-model-fallback, x-is-premium, x-retrieved-chunks",
};

// Structured, machine-parseable logs (visible in Supabase edge-fn logs).
// Metadata only — never log notes/topic content, tokens, or keys.
const log = (event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ fn: "medical-notes", event, ...fields }));
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const STANDARD_MODEL = "openai/gpt-oss-20b";
const FALLBACK_MODEL = "anthropic/claude-haiku-4.5";
const DEFAULT_PREMIUM_MODEL: CortiModel = "corti-s1-instant";
const SOURCE_LABEL_MODEL = "openai/gpt-oss-20b";

const ANON_PREMIUM_LIMIT = 1;
const FREE_PREMIUM_LIMIT = 3;
const DAILY_CAP = 5;

/**
 * How long to wait for Corti's response headers before treating it as
 * unavailable. Corti starts streaming in well under a second when healthy
 * (median 0.4–0.8 s measured), so this only trips on a stalled gateway.
 * Cleared as soon as headers arrive — it never cuts off a stream in progress.
 */
const CORTI_HEADERS_TIMEOUT_MS = 15_000;

/**
 * Users allowed to simulate a Corti outage with `x-simulate-corti-outage: 1`,
 * so the Haiku fallback can be exercised against deployed code. Only the eval
 * harness's anonymous user (scripts/notes-eval/session.ts); the header is
 * ignored for everyone else.
 */
const OUTAGE_SIMULATION_USER_IDS = ["5c9c6e25-92f0-4422-883c-4de07eb16246"];

function sanitizeJsonOutput(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return cleaned;
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

const since = (t: number) => Date.now() - t;

/**
 * Embeds and retrieves, retrying once on failure. Still fail-open: after the
 * retry, an error yields no chunks and generation proceeds ungrounded.
 * Retrieval was measured returning 0 chunks under concurrent load for queries
 * that retrieve normally one at a time, which a single retry absorbs.
 */
async function retrieveWithRetry(
  authClient: SupabaseClient,
  openRouterApiKey: string,
  query: string,
  topK: number,
  threshold: number
): Promise<{ chunks: RagChunk[]; attempts: number; error: string | null }> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const embedding = await embedQuery(makeEmbeddings(openRouterApiKey), query);
      const { chunks } = await retrieveChunks(authClient, embedding, topK, threshold);
      return { chunks, attempts: attempt, error: null };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
      log("retrieval_failed", { attempt, err: lastError });
    }
  }
  return { chunks: [], attempts: 2, error: lastError };
}

/** POSTs a streaming chat completion to OpenRouter. */
function openRouterStream(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[]
): Promise<Response> {
  return fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://studybuddy.app",
      "X-Title": "StudyBuddy",
    },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: 0.7,
      max_tokens: 8192,
      messages,
      provider: model.startsWith("openai/gpt-oss")
        ? { order: ["Cerebras", "Groq"], allow_fallbacks: true }
        : { order: ["Anthropic"], allow_fallbacks: true },
    }),
  });
}

/**
 * Starts the Corti stream, resolving to null when Corti is unavailable —
 * missing credentials, an auth failure, a network error, a non-2xx, or no
 * response headers within CORTI_HEADERS_TIMEOUT_MS.
 */
async function cortiStream(
  model: CortiModel,
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): Promise<{ response: Response | null; reason: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CORTI_HEADERS_TIMEOUT_MS);
  try {
    const config = cortiConfigFromEnv();
    const response = await cortiChatCompletion(config, {
      model,
      messages,
      stream: true,
      // Round-3 eval: 0.3 judged better than 0.7 (13.7 vs 13.3 /15) and is slightly faster.
      temperature: 0.3,
      maxTokens: 8192,
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => "");
      return { response: null, reason: `corti_${response.status}: ${body.slice(0, 200)}` };
    }
    return { response, reason: null };
  } catch (err: unknown) {
    return { response: null, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleMedicalNotes(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    // ── JWT verification ───────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "invalid_token" }, 401);

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) return json({ error: "invalid_token" }, 401);
    const authMs = since(startedAt);

    // Entitlement fields in the body (userId / isAnonymous / isPro /
    // preferredModel) are ignored: identity and entitlement come from the
    // verified JWT and the profiles row only.
    const body = await req.json();
    const { notes, cardsOnly, explainMode, enhanceMode, useGrounding, topK, threshold, useMemory } = body;

    if (!notes || typeof notes !== "string" || !notes.trim()) {
      return json({ error: "Notes are required" }, 400);
    }

    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");

    const isAnonymous =
      user.is_anonymous === true || decodeJwtPayload(token).is_anonymous === true;
    const quotaEligible = !explainMode && !enhanceMode;
    const usageKind = cardsOnly ? "cards" : "sheet";

    // ── Pre-model work, concurrently ────────────────────────────────────────
    // Grounding: sheet/cards only; explain/enhance are single-item follow-ups.
    const groundingEligible = !enhanceMode && !explainMode;
    const useGroundingFlag = typeof useGrounding === "boolean" ? useGrounding : true;
    const groundingAttempted = groundingEligible && useGroundingFlag;
    const groundingTopK = Math.min(Math.max(Math.round(typeof topK === "number" ? topK : 8), 1), 10);
    const groundingThreshold = Math.min(Math.max(typeof threshold === "number" ? threshold : 0.60, 0.40), 0.90);
    // Search string is the notes/topic alone — style axes lower similarity.
    const searchString = notes.trim();

    const retrievalStartedAt = Date.now();
    const retrievalPromise = groundingAttempted
      ? retrieveWithRetry(authClient, OPENROUTER_API_KEY, searchString, groundingTopK, groundingThreshold)
          .then((r) => ({ ...r, ms: since(retrievalStartedAt) }))
      : Promise.resolve({ chunks: [] as RagChunk[], attempts: 0, error: null, ms: 0 });

    // Memory: the shared 10-turn window. enhance reads but never writes.
    const useMemoryFlag = typeof useMemory === "boolean" ? useMemory : true;
    const memoryWritable = useMemoryFlag && !enhanceMode;
    const memoryStartedAt = Date.now();
    const memoryPromise = (async () => {
      if (!useMemoryFlag) return { window: null, turns: [] as MemoryTurn[], ms: 0 };
      const window = await openMemoryWindow(authClient, user.id);
      const turns = window ? await readMemoryTurns(authClient, user.id, window.windowId) : [];
      return { window, turns, ms: since(memoryStartedAt) };
    })();

    // Entitlement → tier, then premium hook and quota side by side.
    const routingStartedAt = Date.now();
    const routingPromise = (async () => {
      const { data: profile } = await authClient
        .from("profiles")
        .select("is_pro, pro_expires_at, preferred_model")
        .eq("id", user.id)
        .maybeSingle();

      const isProUser =
        profile?.is_pro === true &&
        (profile.pro_expires_at === null || new Date(profile.pro_expires_at) > new Date());
      // Pro users choose between the premium model (default) and "fastest".
      const proWantsFastest = profile?.preferred_model === "gpt-oss";

      const hookPromise: Promise<boolean> = isProUser
        ? Promise.resolve(!proWantsFastest)
        : enhanceMode
        ? Promise.resolve(false)
        : authClient
            .rpc("consume_premium_hook", {
              p_user: user.id,
              p_limit: isAnonymous ? ANON_PREMIUM_LIMIT : FREE_PREMIUM_LIMIT,
            })
            .then(({ data, error }: { data: { allowed?: boolean } | null; error: unknown }) => {
              if (error) {
                console.error("consume_premium_hook failed:", error);
                return false;
              }
              return data?.allowed === true;
            });

      const quotaPromise: Promise<"ok" | "exceeded" | "error" | "exempt"> =
        !quotaEligible || isProUser
          ? Promise.resolve("exempt")
          : authClient
              .rpc("consume_usage", { p_user: user.id, p_kind: usageKind, p_cap: DAILY_CAP })
              .then(({ data, error }: { data: { allowed?: boolean } | null; error: unknown }) => {
                if (error) {
                  console.error("consume_usage failed:", error);
                  return "error" as const;
                }
                return data?.allowed ? ("ok" as const) : ("exceeded" as const);
              });

      const [isPremium, quota] = await Promise.all([hookPromise, quotaPromise]);
      return { isProUser, isPremium, quota, ms: since(routingStartedAt) };
    })();

    const [retrieval, memory, routing] = await Promise.all([retrievalPromise, memoryPromise, routingPromise]);

    if (routing.quota === "error") return json({ error: "quota_check_failed" }, 500);
    if (routing.quota === "exceeded") return json({ error: "quota_exceeded" }, 429);
    const quotaConsumed = routing.quota === "ok";
    const refund = async () => {
      if (!quotaConsumed) return;
      try {
        await authClient.rpc("refund_usage", { p_user: user.id, p_kind: usageKind });
      } catch { /* best effort */ }
    };

    const ragChunks = retrieval.chunks;
    const retrievedChunks = ragChunks.length;
    const grounded = retrievedChunks > 0;

    if (groundingAttempted) {
      // Fire-and-forget audit row — never blocks or fails generation.
      authClient
        .from("rag_logs")
        .insert({
          user_id: user.id,
          feature: cardsOnly ? "cards" : "sheet",
          query: searchString,
          grounded,
          source_ids: ragChunks.map((c) => c.id),
        })
        .then(({ error: logErr }: { error: unknown }) => {
          if (logErr) log("rag_log_failed", { err: logErr });
        });
    }

    // Source labels: cheap formatting side call, started now and raced at the
    // end of the stream so it never delays the first byte.
    const sourceLabelsPromise: Promise<RawSourceLabel[]> = grounded
      ? requestSourceLabels(OPENROUTER_API_KEY, SOURCE_LABEL_MODEL, ragChunks)
      : Promise.resolve([]);

    const memoryTurns = memory.turns;
    const memoryWindow = memory.window;

    // Claim this turn before the model call so a concurrent request can never
    // reuse the turn number.
    let memoryClaim: { rowId: string; turnNumber: number; windowId: string } | null = null;
    if (memoryWritable && memoryWindow) {
      memoryClaim = await writeUserTurn(authClient, user.id, memoryWindow.windowId, memoryWindow.turnCount, notes);
    }

    // ── Prompts and writer ──────────────────────────────────────────────────
    const promptBase: Omit<NotesPromptInput, "family"> = {
      ...body,
      groundingAttempted,
      ragChunks,
      hasMemory: memoryTurns.length > 0,
    };
    const messagesFor = (p: { systemPrompt: string; userContent: string }) => [
      { role: "system" as const, content: p.systemPrompt },
      ...memoryTurns,
      { role: "user" as const, content: p.userContent },
    ];

    const premiumModel = asCortiModel(Deno.env.get("CORTI_NOTES_MODEL"), DEFAULT_PREMIUM_MODEL);
    // Tuned prompts won on both tiers in the round-3 eval; NOTES_PROMPTS=original reverts.
    const useTunedPrompts = Deno.env.get("NOTES_PROMPTS") !== "original";
    const notesPrompts = useTunedPrompts ? buildCortiNotesPrompts : buildNotesPrompts;
    const preModelMs = since(startedAt);
    const callStartedAt = Date.now();

    let response: Response | null = null;
    let modelUsed = "";
    let fallbackReason: string | null = null;

    try {
      if (routing.isPremium) {
        const cortiPrompts = notesPrompts({ ...promptBase, family: "haiku" });
        const simulateOutage =
          OUTAGE_SIMULATION_USER_IDS.includes(user.id) && req.headers.get("x-simulate-corti-outage") === "1";
        const corti = simulateOutage
          ? { response: null, reason: "simulated_outage" }
          : await cortiStream(premiumModel, messagesFor(cortiPrompts));
        if (corti.response) {
          response = corti.response;
          modelUsed = `corti/${premiumModel}`;
        } else {
          fallbackReason = corti.reason;
          log("corti_unavailable", { userId: user.id, reason: corti.reason });
          modelUsed = `openrouter/${FALLBACK_MODEL}`;
          response = await openRouterStream(
            OPENROUTER_API_KEY,
            FALLBACK_MODEL,
            messagesFor(buildNotesPrompts({ ...promptBase, family: "haiku" }))
          );
        }
      } else {
        modelUsed = `openrouter/${STANDARD_MODEL}`;
        response = await openRouterStream(
          OPENROUTER_API_KEY,
          STANDARD_MODEL,
          messagesFor(notesPrompts({ ...promptBase, family: "gptOss" }))
        );
      }
    } catch (fetchErr) {
      await refund();
      throw fetchErr;
    }

    log("generation_start", {
      userId: user.id,
      isAnonymous,
      isProUser: routing.isProUser,
      isPremium: routing.isPremium,
      model: modelUsed,
      fallback: fallbackReason !== null,
      cardsOnly: !!cardsOnly,
      explainMode: !!explainMode,
      enhanceMode: enhanceMode ?? null,
      groundingAttempted,
      retrievedChunks,
      retrievalAttempts: retrieval.attempts,
      useMemory: useMemoryFlag,
      memoryTurnsInPrompt: memoryTurns.length / 2,
      quotaEligible,
      authMs,
      retrievalMs: retrieval.ms,
      memoryMs: memory.ms,
      routingMs: routing.ms,
      preModelMs,
    });

    if (!response || !response.ok || !response.body) {
      await refund();
      const t = response ? await response.text().catch(() => "") : "";
      const status = response?.status ?? 0;
      log("upstream_error", { model: modelUsed, status, body: t.slice(0, 300) });
      if (status === 429) {
        return json({ error: "Rate limit exceeded. Please try again in a moment." }, 429);
      }
      return json({ error: "AI service error" }, status === 400 ? 400 : 500);
    }
    const upstreamBody = response.body;

    // ── Relay ───────────────────────────────────────────────────────────────
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    let assistantText = "";
    let ttfcMs: number | null = null;

    // Builds the assistant-side memory summary for this turn — never the full
    // sheet JSON, which would exhaust the prompt budget within a few turns.
    function buildMemorySummary(): string {
      if (explainMode) return assistantText;
      if (cardsOnly) return `${notes}: ${assistantText}`;
      try {
        const parsed = JSON.parse(sanitizeJsonOutput(assistantText));
        const topic = typeof parsed?.topic === "string" && parsed.topic.trim() ? parsed.topic : notes;
        const overview = typeof parsed?.overview === "string" ? parsed.overview : "";
        return `${topic}: ${overview}`;
      } catch {
        return assistantText;
      }
    }

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      start(controller) {
        // Retrieval count/sources go out before any model bytes. Emitted only
        // when grounding was attempted, so a no-grounding sheet renders as before.
        if (!groundingAttempted) return;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ __meta: { retrievedChunks, sources: ragChunks } })}\n\n`)
        );
      },
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";

        for (const event of events) {
          const dataLine = event.trim().split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload || payload.includes("[DONE]")) continue;

          try {
            const text = JSON.parse(payload)?.choices?.[0]?.delta?.content;
            if (typeof text !== "string" || text.length === 0) continue;
            if (ttfcMs === null) ttfcMs = since(callStartedAt);
            assistantText += text;
            // Re-framed rather than forwarded, so no provider-specific field
            // (Corti's `reasoning`, OpenRouter's metadata) reaches the client.
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`)
            );
          } catch {
            // skip unparseable chunks silently
          }
        }
      },
      async flush(controller) {
        // Book/chapter labels, raced against a timeout so a slow label call
        // can never hold the stream open. Must precede [DONE].
        if (groundingAttempted) {
          try {
            const labels = await Promise.race([
              sourceLabelsPromise,
              new Promise<RawSourceLabel[]>((resolve) => setTimeout(() => resolve([]), 2500)),
            ]);
            if (labels.length > 0) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ __meta: { sourceLabels: labels } })}\n\n`));
            }
          } catch (labelErr: unknown) {
            log("source_labels_failed", { err: labelErr instanceof Error ? labelErr.message : String(labelErr) });
          }
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        log("generation_stream_end", {
          userId: user.id,
          model: modelUsed,
          isPremium: routing.isPremium,
          fallback: fallbackReason !== null,
          preModelMs,
          ttfcMs,
          writerMs: since(callStartedAt),
          elapsedMs: since(startedAt),
        });

        // Awaited: the isolate can be torn down the instant the response completes.
        if (memoryClaim) {
          const summary = trim500(buildMemorySummary()) || trim500(notes) || "(no answer)";
          await completeTurn(authClient, memoryClaim.rowId, summary);
        }
      },
    });

    const headers: Record<string, string> = {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "X-Model-Used": modelUsed,
      "X-Is-Premium": routing.isPremium ? "true" : "false",
      "X-Retrieved-Chunks": String(retrievedChunks),
    };
    if (fallbackReason !== null) headers["X-Model-Fallback"] = "corti_unavailable";

    return new Response(upstreamBody.pipeThrough(transform), { headers });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log("error", { error: message, elapsedMs: since(startedAt) });
    return json({ error: message }, 500);
  }
}
