import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { asCortiModel, cortiChatCompletion, cortiConfigFromEnv, type CortiModel } from "../_shared/corti.ts";
import {
  EXPLAIN_PROMPT_VERSION,
  EXPLAIN_SYSTEM_PROMPT,
  explainUserContent,
  parseExplainReply,
  type ExplainableQuestion,
} from "../_shared/qbank-explain.ts";

/**
 * The full explanation of one QBank question (_shared/qbank-explain.ts).
 *
 * Written once per question and cached in question_explanations, so the cost
 * is bounded by the questions that exist, not by how often they are opened.
 * Served only to a student who has answered the question, or sat it in a set
 * they finished: it names the key, which must never reach a student before
 * grading. The cache table has no read policy for the same reason; this
 * function is its only reader.
 *
 * Quota-exempt, like the QBank's other after-grading reads: what it costs was
 * already bounded when the question was written.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ fn: "qbank-explain", event, ...fields }));
};

/** The QBank's own writer: the depth is the point. CORTI_EXPLAIN_MODEL overrides. */
const DEFAULT_MODEL: CortiModel = "corti-s1-instant";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "invalid_token" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ error: "invalid_token" }, 401);

    const { questionId } = await req.json().catch(() => ({}));
    if (typeof questionId !== "string" || !UUID_RE.test(questionId)) return json({ error: "invalid_question" }, 400);

    // Answered, or in a set the student finished (an omitted question is
    // graded too). Anything else would hand out a key before grading.
    const [{ data: attempts }, { data: sessions }] = await Promise.all([
      admin.from("user_attempts").select("id").eq("user_id", user.id).eq("question_id", questionId).limit(1),
      admin
        .from("qbank_sessions")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "completed")
        .contains("question_ids", [questionId])
        .limit(1),
    ]);
    if (!attempts?.length && !sessions?.length) return json({ error: "not_graded" }, 403);

    const [cached, { data: question, error: questionError }] = await Promise.all([
      admin.from("question_explanations").select("status, content").eq("question_id", questionId).maybeSingle(),
      admin
        .from("questions")
        .select(
          "question_text, option_a, option_b, option_c, option_d, option_e, correct_option, explanation, teaching_point, distractor_explanations, subject, topic, held:generation_meta->held"
        )
        .eq("id", questionId)
        .maybeSingle(),
    ]);
    if (questionError || !question) return json({ error: "question_not_found" }, 404);

    // Withdrawn after it was served (20261103000000_qbank_held_questions.sql):
    // no deeper teaching of a key that is in doubt, even one already written.
    if (question.held) {
      log("held", { elapsedMs: Date.now() - startedAt });
      return json({ status: "held" });
    }
    if (cached.data) {
      log("cache_hit", { elapsedMs: Date.now() - startedAt });
      return cached.data.status === "explained"
        ? json({ status: "explained", explanation: cached.data.content })
        : json({ status: "held" });
    }

    const model = asCortiModel(Deno.env.get("CORTI_EXPLAIN_MODEL"), DEFAULT_MODEL);
    const upstream = await cortiChatCompletion(cortiConfigFromEnv(), {
      model,
      stream: false,
      json: true,
      temperature: 0.2,
      maxTokens: 3000,
      messages: [
        { role: "system", content: EXPLAIN_SYSTEM_PROMPT },
        { role: "user", content: explainUserContent(question as ExplainableQuestion) },
      ],
    });
    if (!upstream.ok) {
      log("upstream_failed", { status: upstream.status });
      return json({ error: "upstream_failed" }, 502);
    }
    const body = await upstream.json();
    const result = parseExplainReply(body?.choices?.[0]?.message?.content ?? "");
    if (!result) {
      log("unusable_reply", { model });
      return json({ error: "unusable_reply" }, 502);
    }

    // Best effort, and first writer wins: two readers racing on one question
    // both get an answer, and the table keeps one.
    const stored = await admin.from("question_explanations").upsert(
      {
        question_id: questionId,
        status: result.kind,
        content: result.kind === "explained" ? result.explanation : null,
        dispute_reason: result.kind === "disputed" ? result.reason : null,
        model,
        prompt_version: EXPLAIN_PROMPT_VERSION,
      },
      { onConflict: "question_id", ignoreDuplicates: true }
    );
    if (stored.error) log("cache_write_failed", { error: stored.error.message });

    // A writer that doubts the key withholds more than its explanation: the
    // question leaves the review queue and the decks built from answered sets.
    // Best effort; the explanation is held either way.
    if (result.kind === "disputed") {
      const held = await admin.rpc("hold_generated_question", {
        p_question: questionId,
        p_reason: result.reason,
        p_source: "explain-dispute",
      });
      if (held.error) log("hold_failed", { error: held.error.message });
    }

    log(result.kind, { model, elapsedMs: Date.now() - startedAt });
    return result.kind === "explained"
      ? json({ status: "explained", explanation: result.explanation })
      : json({ status: "held" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log("error", { error: message, elapsedMs: Date.now() - startedAt });
    return json({ error: "explain_failed" }, 500);
  }
});
