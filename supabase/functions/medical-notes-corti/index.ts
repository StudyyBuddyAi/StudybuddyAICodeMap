/**
 * medical-notes, with Corti as the writer. A spike, deployed beside the real
 * function rather than instead of it: nothing in production calls this — only
 * a dev client built with VITE_MEDICAL_NOTES_FN=medical-notes-corti does.
 *
 * The request contract, auth, entitlement, quota, memory, retrieval and SSE
 * framing are the same as medical-notes, so the client cannot tell the two
 * apart except by the X-Model-Used header. What changes:
 *
 *   - The writer call goes to Corti (_shared/corti.ts) instead of OpenRouter.
 *     The premium route (where medical-notes picks Claude Haiku 4.5) and the
 *     standard route (GPT-OSS 20B) map onto two Corti models, each an env
 *     override: CORTI_NOTES_PREMIUM_MODEL / CORTI_NOTES_STANDARD_MODEL.
 *   - Prompts come from the variant adjusted for Corti in
 *     _shared/medical-notes-prompts-corti.ts, or with CORTI_NOTES_PROMPTS=original
 *     from _shared/medical-notes-prompts.ts (a verbatim lift of medical-notes' own).
 *   - Only `delta.content` is relayed, re-framed minimally. Corti's reasoning
 *     models stream a separate `reasoning` field that must never reach the
 *     client's text accumulator.
 *
 * Untouched on purpose: embeddings, retrieval and the source-label side call
 * still run through OpenRouter exactly as medical-notes runs them.
 *
 * EVAL MODE. A request from a user on EVAL_USER_IDS may name the provider,
 * model and prompt set in `body.eval`, which is how the comparison harness
 * (scripts/notes-eval) runs the current OpenRouter models and the Corti
 * candidates through one identical pipeline, with this function's own secrets.
 * The credential is that user's session, held by the harness outside the repo
 * (scripts/notes-eval/session.ts). Eval mode is side-effect free: no profile
 * lookup, premium hook, quota, memory or rag_logs writes, and no source labels.
 * Its stream ends with a __meta.eval frame carrying timings and token usage.
 * For any other user, `body.eval` is ignored and the request runs normally.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { makeEmbeddings, embedQuery, retrieveChunks, type RagChunk } from "../_shared/rag.ts";
import { requestSourceLabels, type RawSourceLabel } from "../_shared/source-labels.ts";
import {
  openMemoryWindow,
  readMemoryTurns,
  writeUserTurn,
  completeTurn,
  trim500,
  type MemoryTurn,
} from "../_shared/memory.ts";
import { buildNotesPrompts, type NotesPromptInput, type PromptFamily } from "../_shared/medical-notes-prompts.ts";
import { buildCortiNotesPrompts } from "../_shared/medical-notes-prompts-corti.ts";
import {
  asCortiModel,
  cortiChatCompletion,
  cortiConfigFromEnv,
  CORTI_MODELS,
  type CortiModel,
} from "../_shared/corti.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-model-used, x-is-premium, x-retrieved-chunks",
};

const log = (event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ fn: "medical-notes-corti", event, ...fields }));
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const DEFAULT_PREMIUM_MODEL: CortiModel = "corti-s1-instant";
const DEFAULT_STANDARD_MODEL: CortiModel = "corti-s1-mini-instant";

/** The OpenRouter models eval mode may run — exactly the two medical-notes uses. */
const OPENROUTER_EVAL_MODELS = ["anthropic/claude-haiku-4.5", "openai/gpt-oss-20b"];

type PromptSet = "original" | "tuned";

interface EvalRequest {
  provider: "openrouter" | "corti";
  model: string;
  family: PromptFamily;
  prompts: PromptSet;
  /** Sampling temperature, 0–1. Production uses 0.7. */
  temperature: number;
}

function sanitizeJsonOutput(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return cleaned;
}

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

/** The harness's anonymous user (scripts/notes-eval/session.ts). */
const EVAL_USER_IDS = ["5c9c6e25-92f0-4422-883c-4de07eb16246"];

/** Validates body.eval against the allowlists; null when it names nothing runnable. */
function parseEvalRequest(raw: unknown): EvalRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const family: PromptFamily = r.family === "gptOss" ? "gptOss" : "haiku";
  const prompts: PromptSet = r.prompts === "tuned" ? "tuned" : "original";
  const temperature =
    typeof r.temperature === "number" && r.temperature >= 0 && r.temperature <= 1 ? r.temperature : 0.7;
  if (r.provider === "openrouter" && OPENROUTER_EVAL_MODELS.includes(r.model as string)) {
    return { provider: "openrouter", model: r.model as string, family, prompts, temperature };
  }
  if (r.provider === "corti" && (CORTI_MODELS as readonly string[]).includes(r.model as string)) {
    return { provider: "corti", model: r.model as string, family, prompts, temperature };
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "invalid_token" }, 401);

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) return json({ error: "invalid_token" }, 401);

    const body = await req.json();
    const { notes, cardsOnly, explainMode, enhanceMode, useGrounding, topK, threshold, useMemory } = body;

    if (!notes || typeof notes !== "string" || !notes.trim()) {
      return json({ error: "Notes are required" }, 400);
    }

    // ── EVAL GATE ──────────────────────────────────────────────────────────
    const evalAuthorized = EVAL_USER_IDS.includes(user.id) && body.eval != null;
    const evalReq = evalAuthorized ? parseEvalRequest(body.eval) : null;
    if (evalAuthorized && !evalReq) return json({ error: "invalid_eval_request" }, 400);
    const isEval = evalReq !== null;

    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");
    const cortiConfig = cortiConfigFromEnv();

    // ── GROUNDING (unchanged from medical-notes) ────────────────────────────
    const groundingEligible = !enhanceMode && !explainMode;
    const useGroundingFlag = typeof useGrounding === "boolean" ? useGrounding : true;
    const groundingAttempted = groundingEligible && useGroundingFlag;
    const rawTopK = typeof topK === "number" ? topK : 8;
    const rawThreshold = typeof threshold === "number" ? threshold : 0.60;
    const groundingTopK = Math.min(Math.max(Math.round(rawTopK), 1), 10);
    const groundingThreshold = Math.min(Math.max(rawThreshold, 0.40), 0.90);
    const searchString = notes.trim();

    // Eval requests may carry a retrieval result fetched once by the harness
    // (eval.retrieveOnly), so every arm of a comparison sees the same context.
    // Retrieval is fail-open and was measured returning 0 chunks on one call
    // and 6 on the next for the same query, which would otherwise hand arms
    // different prompts.
    const suppliedChunks: RagChunk[] | null =
      isEval && Array.isArray(body.eval.chunks) ? body.eval.chunks : null;

    let ragChunks: RagChunk[] = [];
    let retrievalError: string | null = null;
    if (groundingAttempted && suppliedChunks) {
      ragChunks = suppliedChunks;
    } else if (groundingAttempted) {
      try {
        const embeddings = makeEmbeddings(OPENROUTER_API_KEY);
        const queryEmbedding = await embedQuery(embeddings, searchString);
        const result = await retrieveChunks(authClient, queryEmbedding, groundingTopK, groundingThreshold);
        ragChunks = result.chunks;
      } catch (retrievalErr: unknown) {
        retrievalError = retrievalErr instanceof Error ? retrievalErr.message : String(retrievalErr);
        log("retrieval_failed", { err: retrievalError });
        ragChunks = [];
      }

      if (isEval && body.eval.retrieveOnly === true) {
        return json({ chunks: ragChunks, error: retrievalError }, 200);
      }

      if (!isEval) {
        authClient
          .from("rag_logs")
          .insert({
            user_id: user.id,
            feature: cardsOnly ? "cards" : "sheet",
            query: searchString,
            grounded: ragChunks.length > 0,
            source_ids: ragChunks.map((c) => c.id),
          })
          .then(({ error: logErr }: { error: unknown }) => {
            if (logErr) log("rag_log_failed", { err: logErr });
          });
      }
    }
    const retrievedChunks = ragChunks.length;
    const grounded = retrievedChunks > 0;

    const sourceLabelsPromise: Promise<RawSourceLabel[]> = grounded && !isEval
      ? requestSourceLabels(OPENROUTER_API_KEY, "openai/gpt-oss-20b", ragChunks)
      : Promise.resolve([]);

    // ── MEMORY (unchanged; skipped entirely in eval mode) ───────────────────
    const useMemoryFlag = !isEval && (typeof useMemory === "boolean" ? useMemory : true);
    const memoryWritable = useMemoryFlag && !enhanceMode;
    let memoryTurns: MemoryTurn[] = [];
    let memoryWindow: { windowId: string; turnCount: number } | null = null;
    if (useMemoryFlag) {
      memoryWindow = await openMemoryWindow(authClient, user.id);
      if (memoryWindow) {
        memoryTurns = await readMemoryTurns(authClient, user.id, memoryWindow.windowId);
      }
    }

    // ── ROUTING ─────────────────────────────────────────────────────────────
    // Same entitlement decisions as medical-notes; only the model each route
    // lands on differs. In eval mode the request names the model instead.
    const isAnonymous =
      user.is_anonymous === true || decodeJwtPayload(token).is_anonymous === true;
    const premiumModel = asCortiModel(Deno.env.get("CORTI_NOTES_PREMIUM_MODEL"), DEFAULT_PREMIUM_MODEL);
    const standardModel = asCortiModel(Deno.env.get("CORTI_NOTES_STANDARD_MODEL"), DEFAULT_STANDARD_MODEL);
    // Tuned by default: it scored higher than the originals on every Corti
    // model in the comparison (docs/corti-provider-spike.md, Phase 2).
    const envPromptSet: PromptSet = Deno.env.get("CORTI_NOTES_PROMPTS") === "original" ? "original" : "tuned";

    let isProUser = false;
    let isPremiumGeneration = false;

    if (!isEval) {
      const { data: profile } = await authClient
        .from("profiles")
        .select("is_pro, pro_expires_at, preferred_model")
        .eq("id", user.id)
        .maybeSingle();
      isProUser =
        profile?.is_pro === true &&
        (profile.pro_expires_at === null || new Date(profile.pro_expires_at) > new Date());
      const preferredModel = profile?.preferred_model ?? "gpt-oss";

      if (enhanceMode) {
        isPremiumGeneration = isProUser;
      } else if (isProUser) {
        isPremiumGeneration = preferredModel === "claude";
      } else {
        const { data: hookResult, error: hookError } = await authClient.rpc("consume_premium_hook", {
          p_user: user.id,
          p_limit: isAnonymous ? 1 : 3,
        });
        if (hookError) console.error("consume_premium_hook failed:", hookError);
        isPremiumGeneration = !hookError && hookResult?.allowed === true;
      }
    }

    const provider = evalReq ? evalReq.provider : "corti";
    const model = evalReq ? evalReq.model : isPremiumGeneration ? premiumModel : standardModel;
    const family: PromptFamily = evalReq ? evalReq.family : isPremiumGeneration ? "haiku" : "gptOss";
    const promptSet: PromptSet = evalReq ? evalReq.prompts : envPromptSet;

    const promptInput: NotesPromptInput = {
      ...body,
      groundingAttempted,
      ragChunks,
      hasMemory: memoryTurns.length > 0,
      family,
    };
    const { systemPrompt, userContent } =
      promptSet === "tuned" ? buildCortiNotesPrompts(promptInput) : buildNotesPrompts(promptInput);

    const quotaEligible = !explainMode && !enhanceMode && !isEval;

    log("generation_start", {
      userId: user.id,
      isEval,
      isAnonymous,
      isProUser,
      provider,
      model,
      family,
      promptSet,
      isPremium: isPremiumGeneration,
      cardsOnly: !!cardsOnly,
      explainMode: !!explainMode,
      enhanceMode: enhanceMode ?? null,
      groundingAttempted,
      retrievedChunks,
      memoryTurnsInPrompt: memoryTurns.length / 2,
    });

    // ── QUOTA (unchanged) ───────────────────────────────────────────────────
    const usageKind = cardsOnly ? "cards" : "sheet";
    let quotaConsumed = false;
    if (quotaEligible && !isProUser) {
      const { data: consumeResult, error: consumeError } = await authClient.rpc("consume_usage", {
        p_user: user.id,
        p_kind: usageKind,
        p_cap: 5,
      });
      if (consumeError) {
        console.error("consume_usage failed:", consumeError);
        return json({ error: "quota_check_failed" }, 500);
      }
      if (!consumeResult?.allowed) return json({ error: "quota_exceeded" }, 429);
      quotaConsumed = true;
    }
    const refund = async () => {
      if (!quotaConsumed) return;
      try {
        await authClient.rpc("refund_usage", { p_user: user.id, p_kind: usageKind });
      } catch { /* best effort */ }
    };

    let memoryClaim: { rowId: string; turnNumber: number; windowId: string } | null = null;
    if (memoryWritable && memoryWindow) {
      memoryClaim = await writeUserTurn(authClient, user.id, memoryWindow.windowId, memoryWindow.turnCount, notes);
    }

    // ── WRITER CALL ─────────────────────────────────────────────────────────
    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...memoryTurns,
      { role: "user" as const, content: userContent },
    ];
    const callStartedAt = Date.now();
    const temperature = evalReq ? evalReq.temperature : 0.7;

    let response: Response;
    try {
      response = provider === "corti"
        ? await cortiChatCompletion(cortiConfig, {
            model: model as CortiModel,
            messages,
            stream: true,
            streamUsage: true,
            temperature,
            maxTokens: 8192,
          })
        : await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
              "HTTP-Referer": "https://studybuddy.app",
              "X-Title": "StudyBuddy",
            },
            body: JSON.stringify({
              model,
              stream: true,
              temperature,
              max_tokens: 8192,
              messages,
              usage: { include: true },
              provider: model.startsWith("openai/gpt-oss")
                ? { order: ["Cerebras", "Groq"], allow_fallbacks: true }
                : { order: ["Anthropic"], allow_fallbacks: true },
            }),
          });
    } catch (fetchErr) {
      await refund();
      throw fetchErr;
    }

    if (!response.ok) {
      await refund();
      const t = await response.text().catch(() => "");
      log("upstream_error", { provider, model, status: response.status, body: t.slice(0, 400) });
      if (response.status === 429) {
        return json({ error: "Rate limit exceeded. Please try again in a moment." }, 429);
      }
      return json({ error: isEval ? `upstream_${response.status}: ${t.slice(0, 300)}` : "AI service error" }, isEval ? 502 : 500);
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    let assistantText = "";
    let reasoningChars = 0;
    let usage: unknown = null;
    let finishReason: string | null = null;
    let ttfbMs: number | null = null;
    let ttfcMs: number | null = null;

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
        if (!groundingAttempted) return;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ __meta: { retrievedChunks, sources: ragChunks } })}\n\n`)
        );
      },
      transform(chunk, controller) {
        if (ttfbMs === null) ttfbMs = Date.now() - callStartedAt;
        buffer += decoder.decode(chunk, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";

        for (const event of events) {
          const dataLine = event.trim().split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload || payload.includes("[DONE]")) continue;

          try {
            const parsed = JSON.parse(payload);
            if (parsed?.usage) usage = parsed.usage;
            const choice = parsed?.choices?.[0];
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            const reasoning = choice?.delta?.reasoning ?? choice?.delta?.reasoning_content;
            if (typeof reasoning === "string") reasoningChars += reasoning.length;
            const text = choice?.delta?.content;
            if (typeof text !== "string" || text.length === 0) continue;
            if (ttfcMs === null) ttfcMs = Date.now() - callStartedAt;
            assistantText += text;
            // Re-framed rather than forwarded, so no provider-specific field
            // (Corti's `reasoning`, OpenRouter's provider metadata) reaches the
            // client. The client reads choices[0].delta.content and nothing else.
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`)
            );
          } catch {
            // skip unparseable chunks silently
          }
        }
      },
      async flush(controller) {
        if (groundingAttempted && !isEval) {
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

        const stats = {
          provider,
          model,
          family,
          promptSet,
          temperature,
          ttfbMs,
          ttfcMs,
          totalMs: Date.now() - callStartedAt,
          outputChars: assistantText.length,
          reasoningChars,
          finishReason,
          usage,
          retrievedChunks,
        };
        if (isEval) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ __meta: { eval: stats } })}\n\n`));
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        log("generation_stream_end", { userId: user.id, ...stats, usage: undefined, elapsedMs: Date.now() - startedAt });

        if (memoryClaim) {
          const summary = trim500(buildMemorySummary()) || trim500(notes) || "(no answer)";
          await completeTurn(authClient, memoryClaim.rowId, summary);
        }
      },
    });

    return new Response(response.body!.pipeThrough(transform), {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-Model-Used": `${provider}/${model}`,
        "X-Is-Premium": isPremiumGeneration ? "true" : "false",
        "X-Retrieved-Chunks": String(retrievedChunks),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log("error", { error: message, elapsedMs: Date.now() - startedAt });
    return json({ error: message }, 500);
  }
});
