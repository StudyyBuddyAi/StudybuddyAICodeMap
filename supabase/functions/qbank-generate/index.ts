import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import {
  cortiConfigFromEnv,
  cortiChatCompletion,
  cortiComplete,
} from "../_shared/corti.ts";
import {
  QBANK_SYSTEM_PROMPT,
  SYSTEM_ROUTER_PROMPT,
  SYSTEM_NAMES,
  SYSTEM_KEYS,
  buildBatchPlan,
  buildUserMessage,
  type BatchPlan,
  type SystemKey,
} from "../_shared/qbank-prompt.ts";
import { prepareBatch, parseBatchContent, persistBatch } from "../_shared/qbank-persist.ts";
import { verifyBatch, type VerificationResult } from "../_shared/qbank-verify.ts";

/**
 * On-demand QBank generation.
 *
 * Takes a free-text topic, resolves it to one of the thirteen USMLE systems,
 * generates a batch of items with Corti, and persists them so the existing
 * session engine can play them. The client gets the generation as an SSE
 * stream so it can show progress as questions finish rather than showing a
 * spinner for the ninety seconds a batch takes.
 *
 * Shaped on medical-notes: same JWT verification, same SSE relay, same
 * out-of-band `__meta` frames carrying what the model itself never sends.
 * The differences are all downstream of Corti not being OpenRouter — OAuth
 * instead of a static key (see _shared/corti.ts), and no provider fallback.
 *
 * The rows are written is_active = false with origin = 'generated', which the
 * random-sampling branch of start_qbank_session already excludes, so nothing
 * here can leak into the curated bank. The final __meta frame carries the ids
 * the client then hands to start_qbank_session, along with the quality gate's
 * findings and the cold-answering pass's verdict for each item.
 *
 * Three things happen after the model stops talking, and all three are new:
 * the answers are moved onto their planned letters, the gate runs here rather
 * than in the browser so its findings can be stored, and a second model answers
 * every item blind to catch a wrong key. See _shared/qbank-persist.ts and
 * _shared/qbank-verify.ts.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Metadata only — never log topic content, model output, tokens or keys. */
const log = (event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ fn: "qbank-generate", event, ...fields }));
};

/**
 * Ceiling on one request.
 *
 * Was 40, which described a batch that could not physically complete. Measured
 * against a real run: an item costs ~990 completion tokens and ~17.6 seconds, so
 * forty of them need ~39,500 tokens against the 32,768 ceiling below, and about
 * twelve minutes of wall clock. Fifteen fits inside both with room to spare.
 * Anything larger has to be chunked into separate calls, not asked for at once.
 */
const MAX_COUNT = 15;
const DEFAULT_COUNT = 5;

/**
 * Output ceiling for one batch. Well clear of the ~5k a five-item batch uses
 * and of the ~15k the new MAX_COUNT could, so a long batch is not silently
 * truncated mid-question.
 */
const MAX_OUTPUT_TOKENS = 32768;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Resolves a free-text topic onto one system.
 *
 * A separate cheap call rather than a field the writer chooses, because the
 * System Brief has to be picked before the writing prompt is assembled — the
 * wrong system means the wrong Step 2 CK drift traps and the wrong overlap
 * rules for the entire batch. Falls back to cardiovascular on any failure:
 * a slightly mismatched brief is a far better outcome than a failed request,
 * and the model still writes to the topic it was given.
 */
async function resolveSystem(
  config: ReturnType<typeof cortiConfigFromEnv>,
  topic: string
): Promise<{ system: SystemKey; confidence: number | null }> {
  try {
    const raw = await cortiComplete(config, {
      model: "corti-s1-mini-instant",
      temperature: 0,
      maxTokens: 200,
      json: true,
      messages: [
        { role: "system", content: SYSTEM_ROUTER_PROMPT },
        { role: "user", content: topic },
      ],
    });

    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim());
    if (SYSTEM_KEYS.includes(parsed?.system)) {
      const confidence = typeof parsed.confidence === "number" ? parsed.confidence : null;
      return { system: parsed.system as SystemKey, confidence };
    }
  } catch (err) {
    log("router_failed", { message: err instanceof Error ? err.message : String(err) });
  }
  return { system: "cardiovascular", confidence: null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    // ── JWT verification ─────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "invalid_token" }, 401);

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) return json({ error: "invalid_token" }, 401);

    const { topic, count } = await req.json();
    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return json({ error: "Topic is required" }, 400);
    }

    const requested = Number(count) || DEFAULT_COUNT;
    const questionCount = Math.min(Math.max(1, Math.round(requested)), MAX_COUNT);
    const cleanTopic = topic.trim().slice(0, 300);

    // Configuration failures must surface by name. The Models gateway answers
    // an unusable credential with an empty 400, so an unnamed failure here
    // would be untraceable.
    let config: ReturnType<typeof cortiConfigFromEnv>;
    try {
      config = cortiConfigFromEnv();
    } catch (err) {
      log("config_missing", { message: err instanceof Error ? err.message : String(err) });
      return json({ error: "Question generation is not configured" }, 500);
    }

    const { system, confidence } = await resolveSystem(config, cleanTopic);
    const plan: BatchPlan = buildBatchPlan(system, questionCount);
    log("generating", {
      system,
      confidence,
      count: questionCount,
      model: config.model,
      topicLength: cleanTopic.length,
    });

    const startGeneration = () =>
      cortiChatCompletion(config, {
        stream: true,
        temperature: 0.7,
        maxTokens: MAX_OUTPUT_TOKENS,
        json: true,
        messages: [
          { role: "system", content: QBANK_SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage({ topic: cleanTopic, plan }) },
        ],
      });

    let upstream: Response;
    try {
      upstream = await startGeneration();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("upstream_failed", { message });
      // corti_auth_failed comes from the token exchange, which names its own
      // reason — worth separating from a model-side failure in the response.
      const isAuth = message.startsWith("corti_auth_failed");
      return json(
        { error: isAuth ? "Question generation is not configured" : "AI service unreachable" },
        isAuth ? 500 : 502
      );
    }

    if (!upstream.ok || !upstream.body) {
      const body = await upstream.text().catch(() => "");
      log("upstream_status", { status: upstream.status, bodyLength: body.length });
      if (upstream.status === 429) {
        return json({ error: "Rate limit exceeded. Please try again in a moment." }, 429);
      }
      return json({ error: "AI service error" }, 502);
    }

    // ── Relay ────────────────────────────────────────────────────────────────
    // Corti's SSE frames pass through untouched so the client parses exactly
    // what the model sent. Everything the model never sends is added out-of-band
    // as `__meta` frames, the same convention medical-notes uses: the batch plan
    // up front, a restart signal if the stream had to be re-run, and the ids,
    // findings and verification at the end.
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const frame = (payload: unknown) =>
      encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

    let content = "";

    /**
     * Forwards one upstream body to the client while accumulating the model's
     * content. Throws if the connection drops mid-stream, which is the case the
     * retry below exists for.
     */
    const relay = async (
      body: ReadableStream<Uint8Array>,
      controller: ReadableStreamDefaultController<Uint8Array>
    ) => {
      const reader = body.getReader();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        // Forward first, accumulate second: the client's progress should never
        // wait on our bookkeeping.
        controller.enqueue(value);

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";

        for (const event of events) {
          const dataLine = event.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const data = dataLine.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            // `reasoning` deltas are deliberately not accumulated — they bill
            // as output but are the model's scratch work, never part of the
            // JSON payload.
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") content += delta;
          } catch {
            // A frame we cannot parse is the client's problem to tolerate, not
            // a reason to break the relay.
          }
        }
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(
          frame({
            __meta: {
              system,
              systemName: SYSTEM_NAMES[system],
              model: config.model,
              plan: plan.questions,
            },
          })
        );

        // ── Generation, with one retry on a mid-stream death ────────────────
        // Measured: one batch in ten aborted with a bare `terminated` after the
        // student had already waited, and the identical request succeeded on
        // re-run. The retry is deliberately narrow — it only fires when nothing
        // survived, because a stream that died after three complete questions
        // has produced something worth keeping, and restarting would throw it
        // away and charge for it twice.
        let response = upstream;
        let attempts = 1;
        let streamError: string | null = null;

        for (;;) {
          try {
            await relay(response.body!, controller);
            streamError = null;
            break;
          } catch (err) {
            streamError = err instanceof Error ? err.message : String(err);
            const salvaged = parseBatchContent(content).length;
            log("stream_aborted", { message: streamError, attempts, salvaged });

            if (attempts > 1 || salvaged > 0) break;

            let retried: Response | null = null;
            try {
              retried = await startGeneration();
            } catch (retryErr) {
              log("retry_failed", {
                message: retryErr instanceof Error ? retryErr.message : String(retryErr),
              });
            }

            if (!retried?.ok || !retried.body) break;

            // The client has already been handed a partial JSON document, so it
            // has to be told to throw it away before the replacement arrives.
            attempts++;
            content = "";
            controller.enqueue(frame({ __meta: { restart: true } }));
            response = retried;
          }
        }

        // ── Gate, verify, persist ──────────────────────────────────────────
        // A question is only worth storing once it is whole, and the client
        // cannot start a session until it has ids anyway, so all of this
        // happens after the stream rather than per question.
        let questionIds: string[] = [];
        let verification: VerificationResult[] = [];
        let persistError: string | null = null;

        const prepared = prepareBatch(content, plan);

        if (prepared.questions.length > 0) {
          // Verification runs before the insert, not alongside it, so its
          // verdict can be stored on the row it is about. The whole batch is
          // answered in parallel and lands in about a second — see verifyBatch —
          // against the ninety the generation itself took.
          verification = await verifyBatch(config, prepared.questions);

          questionIds = await persistBatch(
            authClient,
            user.id,
            { content, system, plan, topic: cleanTopic, model: config.model },
            prepared,
            verification
          ).catch((err: unknown) => {
            persistError = err instanceof Error ? err.message : String(err);
            log("persist_failed", { message: persistError });
            return [] as string[];
          });
        }

        const blocked = prepared.qa.filter((r) => r.blocked).length;
        const disputed = verification.filter((v) => !v.agreed).length;

        log("complete", {
          ms: Date.now() - startedAt,
          persisted: questionIds.length,
          requested: questionCount,
          contentChars: content.length,
          attempts,
          streamError,
          blocked,
          disputed,
          verifierErrors: verification.filter((v) => v.error).length,
          persistError,
        });

        controller.enqueue(
          frame({
            __meta: {
              questionIds,
              persistError,
              streamError,
              // The gate's findings and the blind answer, so the client shows
              // the same verdict the row was stored with rather than a second
              // opinion computed from its own parse of the stream.
              qa: prepared.qa,
              verification,
            },
          })
        );

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    log("unhandled", {
      ms: Date.now() - startedAt,
      message: err instanceof Error ? err.message : String(err),
    });
    return json({ error: "Internal error" }, 500);
  }
});
