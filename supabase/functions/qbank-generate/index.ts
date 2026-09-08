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
import { prepareBatch, persistOne, type PersistInput } from "../_shared/qbank-persist.ts";
import { verifyOne, type VerificationResult } from "../_shared/qbank-verify.ts";
import type { QaResult } from "../_shared/qbank-qa.ts";

/**
 * On-demand QBank generation — one wave of a set.
 *
 * Takes a free-text topic, resolves it to one of the thirteen USMLE systems,
 * generates items with Corti, and persists them so the existing session engine
 * can play them. The client gets the generation as an SSE stream.
 *
 * Shaped on medical-notes: same JWT verification, same SSE relay, same
 * out-of-band `__meta` frames carrying what the model itself never sends.
 * The differences are all downstream of Corti not being OpenRouter — OAuth
 * instead of a static key (see _shared/corti.ts), and no provider fallback.
 *
 * ── What changed, and why ───────────────────────────────────────────────────
 *
 * This function used to write the whole batch in one insert after the model
 * stopped talking, which meant no question id existed until the last one was
 * finished. That was the entire ninety-second wait: not the generation, the
 * all-or-nothing persist at the end of it. Two things follow from removing it.
 *
 * First, a question is now gated, verified and inserted the moment it closes
 * mid-stream, and its id is announced in a `questionReady` frame. The client
 * starts the session on the first one, so the student waits for one item —
 * about twenty seconds — rather than for the whole set.
 *
 * Second, a request is now one WAVE of a set rather than the whole thing.
 * Twenty items at the measured ~17.6s each is around six minutes of wall clock,
 * which is not a request any edge runtime should be asked to hold. The client
 * issues several sequential waves instead, passing `system` so every wave is
 * written against the same brief, `startIndex` so the set stays in order, and
 * `avoidSubtopics` so wave three does not rewrite wave one. Each wave is the
 * ~90s shape that is already proven in production here.
 *
 * The rows are written is_active = false with origin = 'generated', which the
 * random-sampling branch of start_qbank_session already excludes, so nothing
 * here can leak into the curated bank.
 *
 * ── Failure posture ─────────────────────────────────────────────────────────
 *
 * The stream is a latency optimisation, not the contract. Every row carries the
 * client's `generationId`, and claim_generated_questions reconciles a session
 * against the table by that id. So a `questionReady` frame is a hint to go and
 * claim, never the only record that a question exists: if the connection drops,
 * the tab is closed, or this isolate is killed by the wall clock after an insert
 * commits, the row is still found and still played. That is why the insert
 * happens BEFORE the frame is enqueued, and why a failed enqueue is swallowed —
 * a client that has gone away must not cost us a question it already paid for.
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
 * Ceiling on ONE WAVE, which is no longer the ceiling on a set.
 *
 * Measured against a real run: an item costs ~990 completion tokens and ~17.6
 * seconds. Eight is ~141 seconds and ~7,900 tokens — comfortably inside both the
 * output ceiling below and any sane wall clock, with the client's default wave
 * of five sitting at the ~90s shape this function has already been running at.
 * A larger set is more waves, never a longer request: that was the mistake the
 * old MAX_COUNT of 40 encoded, describing a batch that could not physically
 * complete.
 */
const MAX_WAVE_COUNT = 8;
const DEFAULT_COUNT = 5;

/**
 * Output ceiling for one wave. Far above the ~7.9k a full wave uses, so a wave
 * is never silently truncated mid-question.
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
 *
 * Waves after the first skip this entirely by passing the resolved system back,
 * which saves a round trip and — more importantly — guarantees every wave of a
 * set is written against the same brief. A router that answered "renal" on wave
 * one and "endocrine" on wave three would hand the student two half-sets.
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

    const body = await req.json();
    const topic = body?.topic;
    const generationId = body?.generationId;
    const requestedSystem = body?.system;

    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return json({ error: "Topic is required" }, 400);
    }
    // The generation id is the client's, and it is the only thread tying a row
    // back to the set it belongs to. Without one a question could be written and
    // then be unreachable, which is the exact failure this design exists to
    // remove — so it is required rather than defaulted.
    if (!generationId || typeof generationId !== "string") {
      return json({ error: "generationId is required" }, 400);
    }

    const requested = Number(body?.count) || DEFAULT_COUNT;
    const waveCount = Math.min(Math.max(1, Math.round(requested)), MAX_WAVE_COUNT);
    const cleanTopic = topic.trim().slice(0, 300);
    const waveStart = Math.max(1, Math.round(Number(body?.startIndex) || 1));

    // Capped and de-duplicated: this goes into the prompt, and a set that has
    // already written fifteen subtopics must not spend its remaining budget
    // reciting them back to the model.
    const rawAvoid = body?.avoidSubtopics;
    const avoid: string[] = Array.isArray(rawAvoid)
      ? [
          ...new Set(
            rawAvoid
              .filter((s: unknown): s is string => typeof s === "string" && !!s.trim())
              .map((s: string) => s.trim().slice(0, 120))
          ),
        ].slice(0, 40)
      : [];

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

    const routed = SYSTEM_KEYS.includes(requestedSystem)
      ? { system: requestedSystem as SystemKey, confidence: null }
      : await resolveSystem(config, cleanTopic);
    const system = routed.system;

    const plan: BatchPlan = buildBatchPlan(system, waveCount, Math.random, waveStart);
    log("generating", {
      system,
      confidence: routed.confidence,
      count: waveCount,
      startIndex: waveStart,
      avoidCount: avoid.length,
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
          {
            role: "user",
            content: buildUserMessage({ topic: cleanTopic, plan, avoidSubtopics: avoid }),
          },
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
      const text = await upstream.text().catch(() => "");
      log("upstream_status", { status: upstream.status, bodyLength: text.length });
      if (upstream.status === 429) {
        return json({ error: "Rate limit exceeded. Please try again in a moment." }, 429);
      }
      return json({ error: "AI service error" }, 502);
    }

    // ── Relay ────────────────────────────────────────────────────────────────
    // Corti's SSE frames pass through untouched so the client parses exactly
    // what the model sent. Everything the model never sends is added out-of-band
    // as `__meta` frames, the same convention medical-notes uses: the batch plan
    // up front, a `questionReady` per finished item, a restart signal if the
    // wave had to be re-run, and the wave's summary at the end.
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const frame = (payload: unknown) =>
      encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

    let content = "";

    // Per-wave accumulators. Reset together on a restart, since a restart throws
    // away the content they were derived from.
    let dispatched = 0;
    let writes: Promise<void>[] = [];
    let persistedIds: string[] = [];
    let qaResults: QaResult[] = [];
    let verifications: VerificationResult[] = [];
    let subtopics: string[] = [];
    let insertFailures = 0;

    const persistInput = (): PersistInput => ({
      content,
      system,
      plan,
      topic: cleanTopic,
      model: config.model,
      generationId,
    });

    /**
     * Hands every question that has closed since the last call to the writer.
     *
     * prepareBatch is safe on a prefix: it tries the whole document first and
     * falls back to scanning for array elements that closed on their own, and
     * that scan is prefix-stable — a question that appears once keeps appearing
     * with identical content. So everything before `dispatched` is settled and
     * only the new tail needs work.
     *
     * The work itself is deliberately NOT awaited here. This runs inside the
     * read loop, and blocking that on a verifier round trip and an insert would
     * stall the byte relay the client renders its progress from. The promises
     * are collected and awaited once, before the stream closes.
     */
    const dispatchReady = (controller: ReadableStreamDefaultController<Uint8Array>) => {
      const prepared = prepareBatch(content, plan);
      if (prepared.questions.length <= dispatched) return;

      for (let i = dispatched; i < prepared.questions.length; i++) {
        const question = prepared.questions[i];
        const qaResult = prepared.qa[i];

        // Renumbered positionally rather than trusted from the model. A wave
        // starting at eleven is asked for "Question 11", but models routinely
        // renumber from one, and this index is what claim_generated_questions
        // orders the student's set by — so a renumbered wave would shuffle it.
        question.index = plan.questions[i]?.index ?? waveStart + i;

        qaResults[i] = qaResult;
        if (question.subtopic) subtopics.push(question.subtopic);

        writes.push(
          (async () => {
            // Verified before the insert, not after, so the row stores the
            // verdict it was written with rather than one bolted on later.
            // Fails open — see qbank-verify.
            const verdict = await verifyOne(config, question);
            verifications.push(verdict);

            const id = await persistOne(
              authClient,
              user.id,
              persistInput(),
              question,
              qaResult,
              [verdict]
            );

            if (id) persistedIds.push(id);
            else insertFailures++;

            // Announced only once it is committed, and never allowed to fail the
            // write: if the client has disconnected this throws, and the question
            // is still safely claimable by generation id.
            try {
              controller.enqueue(
                frame({
                  __meta: {
                    questionReady: {
                      id,
                      index: question.index,
                      blocked: qaResult?.blocked ?? false,
                      // The rule that held it back, carried per question rather
                      // than left to be dug out of the wave's qa array later.
                      // That array is indexed by the model's own numbering,
                      // which a wave starting at eleven does not share — so
                      // matching them up after the fact would mislabel exactly
                      // the questions the student is being told about.
                      blockRule:
                        qaResult?.findings?.find((f) => f.severity === "block")?.rule ?? null,
                      difficulty: question.difficulty,
                      reasoningOrder: question.reasoningOrder,
                      agreed: verdict.agreed,
                    },
                  },
                })
              );
            } catch {
              // Client gone. The row survives; claim will find it.
            }
          })()
        );
      }

      dispatched = prepared.questions.length;
    };

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

        let sawClose = false;
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
            if (typeof delta === "string") {
              content += delta;
              if (delta.includes("}")) sawClose = true;
            }
          } catch {
            // A frame we cannot parse is the client's problem to tolerate, not
            // a reason to break the relay.
          }
        }

        // Re-parsing costs a scan of everything written so far, so it is gated
        // on a chunk that could actually have closed an element. Without the
        // guard this runs on every few-token delta for no possible gain.
        if (sawClose) dispatchReady(controller);
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
              startIndex: waveStart,
            },
          })
        );

        // ── Generation, with one retry on a mid-stream death ────────────────
        // Measured: one batch in ten aborted with a bare `terminated` after the
        // student had already waited, and the identical request succeeded on
        // re-run. The retry is deliberately narrow — it only fires when nothing
        // was persisted, because a wave that died after three committed
        // questions has produced something worth keeping, and restarting would
        // throw it away and charge for it twice. A wave that ends short simply
        // ends short: the client's wave loop makes the shortfall up with another
        // wave, which is a cheaper and more honest recovery than trying to
        // rescue a broken stream.
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
            // Settle the writes already in flight before counting them, or the
            // salvage test races the inserts it is asking about.
            await Promise.allSettled(writes);
            log("stream_aborted", {
              message: streamError,
              attempts,
              salvaged: persistedIds.length,
            });

            if (attempts > 1 || persistedIds.length > 0) break;

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
            dispatched = 0;
            writes = [];
            persistedIds = [];
            qaResults = [];
            verifications = [];
            subtopics = [];
            insertFailures = 0;
            controller.enqueue(frame({ __meta: { restart: true } }));
            response = retried;
          }
        }

        // The final element closes only when the document's trailing `]}`
        // arrives, which can land in the same chunk that ends the stream — so
        // one last pass, then wait for every write to settle. Awaited rather
        // than fired and forgotten: the Deno isolate can be torn down the
        // instant the response completes, and an unawaited insert here would
        // silently lose the last question of the wave.
        dispatchReady(controller);
        await Promise.allSettled(writes);

        const blocked = qaResults.filter((r) => r?.blocked).length;
        const disputed = verifications.filter((v) => !v.agreed).length;

        log("wave_complete", {
          ms: Date.now() - startedAt,
          persisted: persistedIds.length,
          requested: waveCount,
          startIndex: waveStart,
          contentChars: content.length,
          attempts,
          streamError,
          blocked,
          disputed,
          insertFailures,
          verifierErrors: verifications.filter((v) => v.error).length,
        });

        controller.enqueue(
          frame({
            __meta: {
              // The wave's own summary. `subtopics` feeds the next wave's
              // duplication guard and `persisted` is what the client's loop
              // counts against its target, so the client never has to infer how
              // much of the wave survived.
              waveComplete: {
                requested: waveCount,
                persisted: persistedIds.length,
                blocked,
                disputed,
                insertFailures,
                startIndex: waveStart,
                // Advanced by what was ASKED for, not by what landed, so a wave
                // that came up short cannot let the next one reuse its numbers.
                // The client applies the same rule; this is here so a log line
                // and the client agree about where the set is.
                nextIndex: waveStart + waveCount,
                system,
                systemName: SYSTEM_NAMES[system],
                subtopics,
                streamError,
              },
              questionIds: persistedIds,
              qa: qaResults,
              verification: verifications,
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
