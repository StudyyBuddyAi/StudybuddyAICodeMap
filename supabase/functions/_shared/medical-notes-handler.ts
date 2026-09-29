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
 * Whatever the tier, which sections a sheet gets is decided by Corti: a
 * one-word archetype classification (_shared/archetype.ts).
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
import { resolveSheetPlan, toWirePlan } from "./sheet-plan.ts";
import { classifyArchetype } from "./archetype.ts";
import { DEFAULT_ARCHETYPE } from "./sheet-sections.ts";
import { buildCortiNotesPrompts } from "./medical-notes-prompts-corti.ts";
import { asCortiModel, cortiChatCompletion, cortiConfigFromEnv, type CortiModel } from "./corti.ts";
import { PERSONALIZE_MAX_TOKENS, isGrantId, parsePersonalizeRequest } from "./personalize.ts";

const ALLOWED_ORIGINS = new Set([
  "https://studyybuddyai.com",
  "https://www.studyybuddyai.com",
  "http://localhost:8080",
]);

const BASE_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-simulate-corti-outage, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-model-used, x-model-fallback, x-is-premium, x-retrieved-chunks",
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

// Structured, machine-parseable logs (visible in Supabase edge-fn logs).
// Metadata only — never log notes/topic content, tokens, or keys.
const log = (event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ fn: "medical-notes", event, ...fields }));
};

const json = (req: Request, body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
  });

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const STANDARD_MODEL = "openai/gpt-oss-20b";
const FALLBACK_MODEL = "anthropic/claude-haiku-4.5";
const DEFAULT_PREMIUM_MODEL: CortiModel = "corti-s1-instant";
const SOURCE_LABEL_MODEL = "openai/gpt-oss-20b";

const ANON_PREMIUM_LIMIT = 1;
const FREE_PREMIUM_LIMIT = 3;
const DAILY_CAP = 5;

const MAX_BODY_BYTES = 102_400; // 100 KB — consistent with rag-generate
const MAX_NOTES_LENGTH = 20_000; // chars; generous for real notes, blocks abuse

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

/**
 * Records that this user was handed a premium sheet without Pro, and returns
 * the grant's id for the sheet to carry. Personalizing that sheet later is
 * then proven against this row rather than a flag the client could set. Null
 * on any failure: the sheet still streams, it just can't be AI-personalized.
 */
async function recordPremiumGrant(client: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await client
    .from("premium_sheet_grants")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (error || !data?.id) {
    log("premium_grant_failed", { userId, err: error });
    return null;
  }
  return data.id as string;
}

/** Whether this grant exists and belongs to this user. */
async function hasPremiumGrant(client: SupabaseClient, userId: string, grant: string | undefined): Promise<boolean> {
  if (!isGrantId(grant)) return false;
  const { data, error } = await client
    .from("premium_sheet_grants")
    .select("id")
    .eq("id", grant)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) log("premium_grant_check_failed", { userId, err: error });
  return !error && !!data;
}

/** Deck size by the sheet's Length setting, as the sheet prompt used to ask. */
const CARDS_BY_LENGTH: Record<string, number> = { Concise: 3, Moderate: 4, Detailed: 5 };

/** A whole non-streaming completion from OpenRouter, or null. */
async function openRouterComplete(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[]
): Promise<string | null> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://studybuddy.app",
      "X-Title": "StudyBuddy",
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 2048,
      messages,
      provider: model.startsWith("openai/gpt-oss")
        ? { order: ["Cerebras", "Groq"], allow_fallbacks: true }
        : { order: ["Anthropic"], allow_fallbacks: true },
    }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content;
  return typeof text === "string" && text.trim() ? text : null;
}

/** The same, from Corti. Null on any failure so the caller can fall back. */
async function cortiComplete(
  model: CortiModel,
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): Promise<string | null> {
  try {
    const res = await cortiChatCompletion(cortiConfigFromEnv(), {
      model,
      messages,
      stream: false,
      temperature: 0.3,
      maxTokens: 2048,
    });
    if (!res.ok) return null;
    const body = await res.json();
    const text = body?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text : null;
  } catch {
    return null;
  }
}

/** POSTs a streaming chat completion to OpenRouter. */
function openRouterStream(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  maxTokens = 8192
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
      max_tokens: maxTokens,
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
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  maxTokens = 8192
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
      maxTokens,
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
    return new Response(null, { headers: buildCorsHeaders(req) });
  }

  const startedAt = Date.now();

  try {
    // ── JWT verification ───────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json(req, { error: "invalid_token" }, 401);

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) return json(req, { error: "invalid_token" }, 401);

    // ── Burst rate limit (best-effort, per-instance) ────────────────────────
    if (!checkBurstLimit(user.id, Date.now())) {
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { ...buildCorsHeaders(req), "Content-Type": "application/json", "Retry-After": "60" },
      });
    }
    const authMs = since(startedAt);

    // ── Request body size guard ────────────────────────────────────────────
    // Reject oversized requests before any expensive work. Prefer the declared
    // Content-Length header when present; always enforce on the actual bytes read.
    const declaredLength = Number(req.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      log("body_too_large", { declaredLength, userId: user.id });
      return json(req, { error: { code: "INVALID_INPUT", message: "Request body too large" } }, 400);
    }

    const rawBytes = await req.arrayBuffer();
    if (rawBytes.byteLength > MAX_BODY_BYTES) {
      log("body_too_large", { actualBytes: rawBytes.byteLength, userId: user.id });
      return json(req, { error: { code: "INVALID_INPUT", message: "Request body too large" } }, 400);
    }

    // Safe JSON parse — never expose parse errors to the caller.
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(rawBytes));
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new TypeError("body must be a JSON object");
      }
    } catch {
      log("invalid_json", { userId: user.id });
      return json(req, { error: { code: "INVALID_INPUT", message: "Request body must be valid JSON" } }, 400);
    }
    const { notes, cardsOnly, explainMode, enhanceMode, useGrounding, topK, threshold, useMemory } = body;

    // Entitlement fields in the body (userId / isAnonymous / isPro /
    // preferredModel) are ignored: identity and entitlement come from the
    // verified JWT and the profiles row only.

    if (!notes || typeof notes !== "string" || !notes.trim()) {
      return json(req, { error: "Notes are required" }, 400);
    }

    if (notes.length > MAX_NOTES_LENGTH) {
      log("notes_too_long", { notesLength: notes.length, userId: user.id });
      return json(req, { error: { code: "INVALID_INPUT", message: "Notes too long" } }, 400);
    }

    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");

    // An AI action on the student's own sheet: Pro (or a premium sheet's
    // grant), uncapped, and nothing else a request does — no grounding, no
    // memory, no quota, no premium hook. See _shared/personalize.ts.
    const personalize = body.personalize == null ? null : parsePersonalizeRequest(body.personalize);
    if (body.personalize != null && !personalize) {
      return json(req, { error: "invalid_personalize_request" }, 400);
    }
    const isPersonalize = personalize !== null;

    const isAnonymous =
      user.is_anonymous === true || decodeJwtPayload(token).is_anonymous === true;
    const quotaEligible = !explainMode && !enhanceMode && !isPersonalize;
    const usageKind = cardsOnly ? "cards" : "sheet";
    // A sectioned JSON document, as opposed to a card deck or a prose reply.
    const isSheetMode = !cardsOnly && !explainMode && !enhanceMode && !isPersonalize;

    // ── Pre-model work, concurrently ────────────────────────────────────────
    // Grounding: sheet/cards only; explain/enhance/personalize are single-item follow-ups.
    const groundingEligible = !enhanceMode && !explainMode && !isPersonalize;
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

    // Archetype: what kind of thing this is, which decides the sheet's
    // sections. Classified by Corti for every tier. Runs beside retrieval
    // rather than before it, so it costs no wall-clock time — retrieval is far
    // slower — and fails open to the condition archetype, the shape a sheet
    // has always had.
    const archetypePromise = isSheetMode
      ? classifyArchetype(notes)
      : Promise.resolve({ archetype: null, ms: 0, error: null });

    // Memory: the shared 10-turn window. enhance reads but never writes;
    // personalize neither reads nor writes — it is about one line, not a turn.
    const useMemoryFlag = !isPersonalize && (typeof useMemory === "boolean" ? useMemory : true);
    const memoryWritable = useMemoryFlag && !enhanceMode;
    const memoryStartedAt = Date.now();
    const memoryPromise = (async () => {
      if (!useMemoryFlag) return { window: null, turns: [] as MemoryTurn[], ms: 0 };
      const window = await openMemoryWindow(authClient, user.id);
      const turns = window ? await readMemoryTurns(authClient, user.id, window.windowId) : [];
      return { window, turns, ms: since(memoryStartedAt) };
    })();

    // Entitlement → tier, then premium hook and quota side by side.
    const corsHeaders = buildCorsHeaders(req);
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

      // A personalize action always runs on the premium writer, whatever a
      // Pro user picked for their sheets. Without Pro it needs the grant the
      // server recorded for a premium sheet; it never spends the hook.
      const hookPromise: Promise<boolean> = isPersonalize
        ? isProUser
          ? Promise.resolve(true)
          : hasPremiumGrant(authClient, user.id, personalize!.grant)
        : isProUser
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

    // Each of these is awaited below, but a request can end before some of them
    // are — a quota refusal, an early error. Marked handled here so a late
    // failure can't surface as an unhandled rejection after the response has
    // gone; awaiting the promise itself still sees the failure.
    for (const p of [retrievalPromise, archetypePromise, memoryPromise, routingPromise]) {
      p.catch(() => {});
    }

// ── Quota, on its own ───────────────────────────────────────────────────
    // It decides whether there is a response at all, and it answers in a
    // fraction of the time retrieval and the classifier take — so it is
    // settled first, and a sheet can open its stream while they still run.
    const routing = await routingPromise;
    if (routing.quota === "error") return json(req, { error: "quota_check_failed" }, 500);
    if (routing.quota === "exceeded") return json(req, { error: "quota_exceeded" }, 429);
    if (isPersonalize && !routing.isPremium) return json(req, { error: "pro_required" }, 403);
    const quotaConsumed = routing.quota === "ok";
    let refunded = false;
    const refund = async () => {
      if (!quotaConsumed || refunded) return;
      refunded = true;
      try {
        await authClient.rpc("refund_usage", { p_user: user.id, p_kind: usageKind });
      } catch { /* best effort */ }
    };

    /**
     * Everything between the quota check and the writer's first byte.
     *
     * A sheet streams its preparation while this runs: `emit` sends each piece
     * the moment it is ready — the plan when the classifier answers, the
     * passages when retrieval does, whichever comes first. The other modes
     * pass a no-op and await it whole, exactly as before.
     */
    const prepare = async (emit: (meta: Record<string, unknown>) => void) => {
      const planned = archetypePromise.then((archetype) => {
        // The sections this sheet gets: archetype chooses the spine, exam mode
        // and difficulty add to it, length sets the counts.
        const sheetPlan = isSheetMode
          ? resolveSheetPlan({
              archetype: archetype.archetype,
              examMode: body.examMode,
              difficulty: body.difficulty,
              length: body.length,
            })
          : [];
        if (isSheetMode) {
          emit({ plan: toWirePlan(sheetPlan), archetype: archetype.archetype ?? DEFAULT_ARCHETYPE });
        }
        return { archetype, sheetPlan };
      });
      const retrieved = retrievalPromise.then((retrieval) => {
        // Emitted only when grounding was attempted, so a no-grounding sheet
        // renders as before.
        if (isSheetMode && groundingAttempted) {
          emit({ retrievedChunks: retrieval.chunks.length, sources: retrieval.chunks });
        }
        return retrieval;
      });
      const [{ archetype, sheetPlan }, retrieval, memory] = await Promise.all([
        planned,
        retrieved,
        memoryPromise,
      ]);

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

      // Source labels: cheap formatting side call, started now and raced at
      // the end of the stream so it never delays the first byte.
      const sourceLabelsPromise: Promise<RawSourceLabel[]> = grounded
        ? requestSourceLabels(OPENROUTER_API_KEY, SOURCE_LABEL_MODEL, ragChunks)
        : Promise.resolve([]);
      sourceLabelsPromise.catch(() => {});

      const memoryTurns = memory.turns;
      const memoryWindow = memory.window;

      // Claim this turn before the model call so a concurrent request can never
      // reuse the turn number.
      let memoryClaim: { rowId: string; turnNumber: number; windowId: string } | null = null;
      if (memoryWritable && memoryWindow) {
        memoryClaim = await writeUserTurn(authClient, user.id, memoryWindow.windowId, memoryWindow.turnCount, notes);
      }

      // ── Prompts and writer ────────────────────────────────────────────────
      const promptBase: Omit<NotesPromptInput, "family"> = {
        ...body,
        groundingAttempted,
        ragChunks,
        hasMemory: memoryTurns.length > 0,
        plan: sheetPlan,
        // The validated request, never the raw body field.
        personalize,
      };
      // A personalize reply is a line or a card, not a document.
      const maxTokens = isPersonalize ? PERSONALIZE_MAX_TOKENS : 8192;
      const messagesFor = (p: { systemPrompt: string; userContent: string }) => [
        { role: "system" as const, content: p.systemPrompt },
        ...memoryTurns,
        { role: "user" as const, content: p.userContent },
      ];

      const premiumModel = asCortiModel(Deno.env.get("CORTI_NOTES_MODEL"), DEFAULT_PREMIUM_MODEL);
      // Tuned prompts won on both tiers in the round-3 eval; NOTES_PROMPTS=original reverts.
      const useTunedPrompts = Deno.env.get("NOTES_PROMPTS") !== "original";
      const notesPrompts = useTunedPrompts ? buildCortiNotesPrompts : buildNotesPrompts;

      /**
       * The deck, written beside the sheet instead of after it.
       *
       * Measured on a live sheet, the cards were the single largest block of
       * wall-clock — 7.2s of 32.9s, and 7.7s of 35.9s — and they were last, so
       * the reader waited for the one section they would read last before the
       * document was finished. They are not a planned section (the deck is its
       * own contract, feeding the spaced-repetition library), so nothing about
       * the sheet depends on them.
       *
       * Started here, it runs concurrently with the sheet's own stream and is
       * collected at the end of it, by which time it is long finished. It is the
       * same tier, prompt set and retrieved context the sheet gets, so the cards
       * are what they always were.
       *
       * Fails soft: on any error the frame is simply not sent and the sheet
       * renders without a deck, exactly as it does when the model writes none.
       */
      const cardsForLength = CARDS_BY_LENGTH[String(body.length)] ?? CARDS_BY_LENGTH.Concise;
      const flashcardsStartedAt = Date.now();
      const flashcardsPromise: Promise<string | null> = !isSheetMode
        ? Promise.resolve(null)
        : (async () => {
            const cardsInput: NotesPromptInput = {
              ...promptBase,
              cardsOnly: true,
              cardCount: cardsForLength,
              // The deck stands alone; prior turns would pull it off topic.
              hasMemory: false,
              family: routing.isPremium ? "haiku" : "gptOss",
            };
            const prompts = notesPrompts(cardsInput);
            const messages = [
              { role: "system" as const, content: prompts.systemPrompt },
              { role: "user" as const, content: prompts.userContent },
            ];
            try {
              if (routing.isPremium) {
                const text = await cortiComplete(premiumModel, messages);
                if (text) return text;
              }
              return await openRouterComplete(
                OPENROUTER_API_KEY,
                routing.isPremium ? FALLBACK_MODEL : STANDARD_MODEL,
                messages
              );
            } catch (err: unknown) {
              log("flashcards_failed", { err: err instanceof Error ? err.message : String(err) });
              return null;
            }
          })();

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
            : await cortiStream(premiumModel, messagesFor(cortiPrompts), maxTokens);
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
              messagesFor(buildNotesPrompts({ ...promptBase, family: "haiku" })),
              maxTokens
            );
          }
        } else {
          modelUsed = `openrouter/${STANDARD_MODEL}`;
          response = await openRouterStream(
            OPENROUTER_API_KEY,
            STANDARD_MODEL,
            messagesFor(notesPrompts({ ...promptBase, family: "gptOss" })),
            maxTokens
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
        // The action and style only — never the student's text.
        personalize: personalize ? `${personalize.action}${personalize.style ? `:${personalize.style}` : ""}` : null,
        archetype: archetype.archetype ?? (isSheetMode ? DEFAULT_ARCHETYPE : null),
        archetypeFallback: isSheetMode && archetype.archetype === null,
        archetypeError: archetype.error,
        archetypeMs: archetype.ms,
        sections: sheetPlan.map((s) => s.key),
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

      return {
        ragChunks,
        retrievedChunks,
        sourceLabelsPromise,
        memoryClaim,
        flashcardsPromise,
        flashcardsStartedAt,
        preModelMs,
        callStartedAt,
        response,
        modelUsed,
        fallbackReason,
      };
    };
    type Prepared = Awaited<ReturnType<typeof prepare>>;

    /** The writer's upstream failed before streaming: logs it, returns what to tell the client. */
    const upstreamFailure = async (ctx: Prepared) => {
      await refund();
const t = ctx.response ? await ctx.response.text().catch(() => "") : "";
      const status = ctx.response?.status ?? 0;
      log("upstream_error", { model: ctx.modelUsed, status, body: t.slice(0, 300) });
      return status === 429
        ? { status: 429, error: "Rate limit exceeded. Please try again in a moment." }
        : { status: status === 400 ? 400 : 500, error: "AI service error" };
    };

    // ── Relay ───────────────────────────────────────────────────────────────
    /**
     * Relays the writer's stream: each content delta re-framed on its own, so
     * no provider-specific field (Corti's `reasoning`, OpenRouter's metadata)
     * reaches the client; then the book labels and the deck; then [DONE] and
     * the turn's memory.
     *
     * `leadingFrames` sends the passages ahead of the text, for the modes that
     * haven't streamed them already. `reportThinking` tells a sheet's page,
     * once, that the writer is reasoning before it writes — a reasoning model
     * can spend seconds there, and the page shouldn't look stalled.
     */
    const makeRelay = (ctx: Prepared, opts: { leadingFrames: boolean; reportThinking: boolean }) => {
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
      let assistantText = "";
      let ttfcMs: number | null = null;
      let thinkingReported = false;
      const frame = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

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

      return new TransformStream<Uint8Array, Uint8Array>({
        start(controller) {
          // Retrieval count/sources go out before any model bytes. Emitted only
          // when grounding was attempted, so an ungrounded response is as before.
          if (!opts.leadingFrames || !groundingAttempted) return;
          controller.enqueue(frame({ __meta: { retrievedChunks: ctx.retrievedChunks, sources: ctx.ragChunks } }));
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
              const delta = JSON.parse(payload)?.choices?.[0]?.delta;
              const text = delta?.content;
              if (typeof text !== "string" || text.length === 0) {
                if (
                  opts.reportThinking &&
                  !thinkingReported &&
                  ttfcMs === null &&
                  (delta?.reasoning || delta?.reasoning_content)
                ) {
                  thinkingReported = true;
                  controller.enqueue(frame({ __meta: { stage: "thinking" } }));
                }
                continue;
              }
              if (ttfcMs === null) ttfcMs = since(ctx.callStartedAt);
              assistantText += text;
              controller.enqueue(frame({ choices: [{ index: 0, delta: { content: text } }] }));
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
                ctx.sourceLabelsPromise,
                new Promise<RawSourceLabel[]>((resolve) => setTimeout(() => resolve([]), 2500)),
              ]);
              if (labels.length > 0) {
                controller.enqueue(frame({ __meta: { sourceLabels: labels } }));
              }
            } catch (labelErr: unknown) {
              log("source_labels_failed", { err: labelErr instanceof Error ? labelErr.message : String(labelErr) });
            }
          }

          // The deck, which has been writing alongside the sheet and is almost
          // always finished well before it. The timeout is the backstop for a
          // stalled card call, not the expected path — it must never hold the
          // document open, since the sheet is complete without it.
          let flashcardsMs: number | null = null;
          if (isSheetMode) {
            try {
              const cards = await Promise.race([
                ctx.flashcardsPromise,
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
              ]);
              flashcardsMs = since(ctx.flashcardsStartedAt);
              if (cards) {
                controller.enqueue(frame({ __meta: { flashcards: cards } }));
              }
            } catch (cardsErr: unknown) {
              log("flashcards_frame_failed", {
                err: cardsErr instanceof Error ? cardsErr.message : String(cardsErr),
              });
            }
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          log("generation_stream_end", {
            flashcardsMs,
            userId: user.id,
            model: ctx.modelUsed,
            isPremium: routing.isPremium,
            fallback: ctx.fallbackReason !== null,
            preModelMs: ctx.preModelMs,
            ttfcMs,
            writerMs: since(ctx.callStartedAt),
            elapsedMs: since(startedAt),
          });

          // Awaited: the isolate can be torn down the instant the response completes.
          if (ctx.memoryClaim) {
            const summary = trim500(buildMemorySummary()) || trim500(notes) || "(no answer)";
            await completeTurn(authClient, ctx.memoryClaim.rowId, summary);
          }
        },
      });
    };

    // ── Cards, explain, enhance: the response starts at the writer's first byte ──
    if (!isSheetMode) {
      const ctx = await prepare(() => {});
      if (!ctx.response || !ctx.response.ok || !ctx.response.body) {
        const failure = await upstreamFailure(ctx);
        return json(req, { error: failure.error }, failure.status);
      }
      const headers: Record<string, string> = {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-Model-Used": ctx.modelUsed,
        "X-Is-Premium": routing.isPremium ? "true" : "false",
        "X-Retrieved-Chunks": String(ctx.retrievedChunks),
      };
      if (ctx.fallbackReason !== null) headers["X-Model-Fallback"] = "corti_unavailable";
      return new Response(
        ctx.response.body.pipeThrough(makeRelay(ctx, { leadingFrames: true, reportThinking: false })),
        { headers }
      );
    }

    // ── A sheet streams from here ───────────────────────────────────────────
    // The response opens now, while retrieval and the classifier are still
    // running, and each piece of the sheet's preparation goes out the moment it
    // is ready: the plan, the passages, which model is writing, whether it is
    // thinking. They used to wait for the writer's first byte and arrive
    // together, so the page sat on its first step through the whole
    // preparation. Which model writes isn't known yet, so it travels as a frame
    // rather than the X-Model-Used header; and anything that fails from here on
    // is told in the stream, since the status line has already gone out as 200.
    const encoder = new TextEncoder();
    let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let clientOpen = true;
    const sheetStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (bytes: Uint8Array) => {
          if (!clientOpen) return;
          try {
            controller.enqueue(bytes);
          } catch {
            clientOpen = false; // the reader went away
          }
        };
        const emit = (meta: Record<string, unknown>) =>
          send(encoder.encode(`data: ${JSON.stringify({ __meta: meta })}\n\n`));
        const close = () => {
          if (!clientOpen) return;
          clientOpen = false;
          try {
            controller.close();
          } catch { /* already closed */ }
        };
        const fail = (error: string) => {
          emit({ error });
          send(encoder.encode("data: [DONE]\n\n"));
          close();
        };

        let relayed = false;
        // A premium sheet without Pro is personalizable like a Pro one. The
        // grant proving it is written beside the preparation — an insert
        // settles long before retrieval does — and sent before any content.
        // Never fails the sheet: without it the sheet simply isn't personalizable.
        const grantSent =
          routing.isPremium && !routing.isProUser
            ? recordPremiumGrant(authClient, user.id)
                .then((grant) => {
                  if (grant) emit({ premiumGrant: grant });
                })
                .catch(() => {})
            : Promise.resolve();
        try {
          const ctx = await prepare(emit);
          await grantSent;
          // The student left while the sheet was being prepared. `cancel`
          // below only reaches a writer that is already being read, so the
          // one just started would otherwise be read to the end — a whole
          // sheet written and paid for with nobody there.
          if (!clientOpen) {
            ctx.response?.body?.cancel().catch(() => {});
            return;
          }
          emit({ model: { used: ctx.modelUsed, fallback: ctx.fallbackReason !== null } });
          if (!ctx.response || !ctx.response.ok || !ctx.response.body) {
            fail((await upstreamFailure(ctx)).error);
            return;
          }
          upstreamReader = ctx.response.body
            .pipeThrough(makeRelay(ctx, { leadingFrames: false, reportThinking: true }))
            .getReader();
          while (true) {
            const { done, value } = await upstreamReader.read();
            if (done) break;
            relayed = true;
            send(value);
          }
          close();
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          log("error", { error: message, elapsedMs: since(startedAt) });
          // Nothing reached the student: the day's sheet goes back.
          if (!relayed) await refund();
          fail("Something went wrong writing this sheet. Please try again.");
        }
      },
      cancel() {
        // The student left: stop reading the writer rather than pay for a
        // sheet nobody will see.
        clientOpen = false;
        upstreamReader?.cancel().catch(() => {});
      },
    });

return new Response(sheetStream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-Is-Premium": routing.isPremium ? "true" : "false",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log("error", { error: message, elapsedMs: since(startedAt) });
    // Do NOT expose internal error details to the caller.
    return json(req, { error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
  }
}
