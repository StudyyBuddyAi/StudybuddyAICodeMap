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
  type SystemKey,
} from "../_shared/qbank-prompt.ts";
import { persistBatch } from "../_shared/qbank-persist.ts";

/**
 * On-demand QBank generation.
 *
 * Takes a free-text topic, resolves it to one of the thirteen USMLE systems,
 * generates a batch of items with Corti, and persists them so the existing
 * session engine can play them. The client gets the generation as an SSE
 * stream so it can reveal questions as they finish rather than showing a
 * spinner for the ninety seconds a batch takes.
 *
 * Shaped on medical-notes: same JWT verification, same TransformStream relay,
 * same out-of-band `__meta` frames carrying what the model itself never sends.
 * The differences are all downstream of Corti not being OpenRouter — OAuth
 * instead of a static key (see _shared/corti.ts), and no provider fallback.
 *
 * The rows are written is_active = false with origin = 'generated', which the
 * random-sampling branch of start_qbank_session already excludes, so nothing
 * here can leak into the curated bank. The final __meta frame carries the ids
 * the client then hands to start_qbank_session.
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

/** Matches MAX_SESSION_CAP on the client and the cap inside start_qbank_session. */
const MAX_COUNT = 40;
const DEFAULT_COUNT = 5;

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
    const plan = buildBatchPlan(system, questionCount);
    log("generating", {
      system,
      confidence,
      count: questionCount,
      model: config.model,
      topicLength: cleanTopic.length,
    });

    let upstream: Response;
    try {
      upstream = await cortiChatCompletion(config, {
        stream: true,
        temperature: 0.7,
        // Well clear of the ~4.5k a five-item batch actually uses, so a longer
        // batch is not silently truncated mid-question.
        maxTokens: 32768,
        json: true,
        messages: [
          { role: "system", content: QBANK_SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage({ topic: cleanTopic, plan }) },
        ],
      });
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
    // what the model sent. Two things the model never sends are added
    // out-of-band as `__meta` frames, the same convention medical-notes uses:
    // the batch plan up front (so the preview can show what was asked for
    // before any content arrives), and the persisted question ids at the end.
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              __meta: {
                system,
                systemName: SYSTEM_NAMES[system],
                model: config.model,
                plan: plan.questions,
              },
            })}\n\n`
          )
        );
      },

      transform(chunk, controller) {
        // Forward first, accumulate second: the client's reveal should never
        // wait on our bookkeeping.
        controller.enqueue(chunk);

        buffer += decoder.decode(chunk, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";

        for (const event of events) {
          const dataLine = event
            .split("\n")
            .find((line) => line.startsWith("data:"));
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
      },

      async flush(controller) {
        // Persistence happens here rather than per-question: a question is only
        // worth storing once it is whole, and the client cannot start a session
        // until it has ids for all of them anyway.
        let questionIds: string[] = [];
        let persistError: string | null = null;

        try {
          questionIds = await persistBatch(authClient, user.id, {
            content,
            system,
            plan,
            topic: cleanTopic,
            model: config.model,
          });
        } catch (err) {
          persistError = err instanceof Error ? err.message : String(err);
          log("persist_failed", { message: persistError });
        }

        log("complete", {
          ms: Date.now() - startedAt,
          persisted: questionIds.length,
          requested: questionCount,
          contentChars: content.length,
          persistError,
        });

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              __meta: { questionIds, persistError },
            })}\n\n`
          )
        );
      },
    });

    return new Response(upstream.body.pipeThrough(transform), {
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
