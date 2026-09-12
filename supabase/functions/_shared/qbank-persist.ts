import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import {
  SYSTEM_NAMES,
  TRACK_ENUMS,
  EXAM_TRACKS,
  PROMPT_VERSION,
  permuteToPlannedLetter,
  buildDistractorExplanations,
  type BatchPlan,
  type ExamTrack,
  type OptionLetter,
  type SystemKey,
} from "./qbank-prompt.ts";
import { checkBatch, type QaResult } from "./qbank-qa.ts";
import type { VerificationResult } from "./qbank-verify.ts";

/**
 * Parsing and persisting a generated batch, server-side.
 *
 * Deliberately narrower than src/lib/parse-partial-questions.ts, which does the
 * other half of the job: that one parses an in-flight stream at element grain
 * so the preview can reveal questions as they finish, and it runs in the
 * browser. This one sees the finished text and has a different obligation — it
 * decides what is safe to write into a table the grading RPC will later trust.
 *
 * The QA gate now runs here, before the insert. It used to run only in the
 * browser, after the rows were already written, and its findings were discarded
 * when the page unmounted — across a measured 50-item run it produced eighteen
 * findings that reached nobody and were stored nowhere, so there was no way to
 * see quality move. Running it here means the findings go onto the row and come
 * back with the batch, and the ids and the findings are computed from one parse
 * rather than from two parses in two runtimes that could disagree about how many
 * questions there were.
 *
 * Everything that parses is still persisted. The client decides which ids to
 * hand to start_qbank_session — the RPC re-checks ownership regardless, so a
 * blocked item that is never requested is simply an unused row.
 */

const OPTION_KEYS: OptionLetter[] = ["a", "b", "c", "d", "e"];
const DIFFICULTIES = ["Easy", "Medium", "Hard"];
const REASONING_ORDERS = ["1st", "2nd", "3rd"];

// The domain and competency enums are NOT restated here. This file used to
// carry its own copy of DOMAINS, which meant a change to the prompt's enum had
// no effect on persistence: every value the copy did not know was coerced to
// "Pathology" with no flag. The prompt module's TRACK_ENUMS is the one source,
// and the fallback is chosen by the track the item was written on.

export interface ParsedQuestion {
  index: number;
  /**
   * The exam the item was written on, from the batch plan — never from the
   * model. Set in prepareBatch once the question is matched to its plan row;
   * a bare parse defaults it to step1.
   */
  examTrack: ExamTrack;
  /**
   * What the model said its track was, when the contract asked it to say
   * (mixed mode only). A self-report, stored beside the plan's value as a free
   * "did the track instruction take?" metric.
   */
  examTrackReported: ExamTrack | null;
  domain: string;
  subtopic: string;
  competency: string;
  difficulty: string;
  reasoningOrder: string;
  reasoningChain: string;
  vignette: string;
  leadIn: string;
  options: Record<OptionLetter, string>;
  correctOption: OptionLetter;
  explanation: string;
  distractorExplanations: Partial<Record<OptionLetter, string>>;
  teachingPoint: string;
  suggestedImage: unknown;
  selfCheck: unknown;
  reviewerFlag: string;
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Scans a `"questions": [ … ]` array and returns every element that closed.
 *
 * The fallback when the whole object will not parse — a batch truncated by a
 * dropped connection still contains complete questions, and throwing them away
 * because the closing brace never arrived would waste a generation the user
 * already waited ninety seconds for.
 */
function completedElements(text: string): string[] {
  const opener = /"questions"\s*:\s*\[/.exec(text);
  if (!opener) return [];

  const out: string[] = [];
  let depth = 0;
  let elementStart = -1;
  let inString = false;
  let escaped = false;

  for (let i = opener.index + opener[0].length; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") {
      if (depth === 0 && ch === "{") elementStart = i;
      depth++;
    } else if (ch === "}" || ch === "]") {
      if (depth === 0) break;
      depth--;
      if (depth === 0 && elementStart >= 0) {
        out.push(text.slice(elementStart, i + 1));
        elementStart = -1;
      }
    }
  }
  return out;
}

/**
 * Validates one raw element into a question, or null.
 *
 * Strict on everything a student would see or the grader would compare against
 * — five non-empty options and a key naming one of them — because a row that
 * fails here becomes an unanswerable question inside a real session. Forgiving
 * on the rest: a missing teaching point is a slightly poorer item, not a broken
 * one, and out-of-enum values are coerced rather than rejected so a single odd
 * label cannot cost the user the whole question.
 *
 * Domain and competency leave here as the model wrote them. Which enum they
 * are held to depends on the item's track, and the track is only known once
 * the question is matched to its plan row — see withTrackEnums.
 */
function toQuestion(raw: Record<string, unknown>, fallbackIndex: number): ParsedQuestion | null {
  const rawOptions = raw.options;
  if (!rawOptions || typeof rawOptions !== "object" || Array.isArray(rawOptions)) return null;

  const options = {} as Record<OptionLetter, string>;
  for (const key of OPTION_KEYS) {
    const value = (rawOptions as Record<string, unknown>)[key];
    if (typeof value !== "string" || !value.trim()) return null;
    options[key] = value.trim();
  }

  const correct = asString(raw.correctOption).toLowerCase();
  if (!OPTION_KEYS.includes(correct as OptionLetter)) return null;

  const vignette = asString(raw.vignette);
  const leadIn = asString(raw.leadIn);
  if (!vignette || !leadIn) return null;

  const distractorExplanations: Partial<Record<OptionLetter, string>> = {};
  const rawDistractors = raw.distractorExplanations;
  if (rawDistractors && typeof rawDistractors === "object" && !Array.isArray(rawDistractors)) {
    for (const key of OPTION_KEYS) {
      const value = (rawDistractors as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) distractorExplanations[key] = value.trim();
    }
  }

  const difficulty = asString(raw.difficulty);
  const reasoningOrder = asString(raw.reasoningOrder);
  const reportedTrack = asString(raw.examTrack);

  return {
    index: typeof raw.index === "number" ? raw.index : fallbackIndex,
    examTrack: "step1",
    examTrackReported: EXAM_TRACKS.includes(reportedTrack as ExamTrack)
      ? (reportedTrack as ExamTrack)
      : null,
    domain: asString(raw.domain),
    subtopic: asString(raw.subtopic) || "Untitled",
    competency: asString(raw.competency),
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : "Medium",
    reasoningOrder: REASONING_ORDERS.includes(reasoningOrder) ? reasoningOrder : "2nd",
    reasoningChain: asString(raw.reasoningChain),
    vignette,
    leadIn,
    options,
    correctOption: correct as OptionLetter,
    explanation: asString(raw.explanation),
    distractorExplanations,
    teachingPoint: asString(raw.teachingPoint),
    suggestedImage: raw.suggestedImage ?? null,
    selfCheck: raw.selfCheck ?? null,
    reviewerFlag: asString(raw.reviewerFlag) || "None.",
  };
}

/**
 * Pins a question to its track and holds its enums to that track's lists.
 *
 * `competency` used to be stored unvalidated, asymmetric with `domain`; both
 * now coerce the same way, with a fallback that belongs to the track rather
 * than a Step 1 value stamped on a Step 2 CK item.
 */
function withTrackEnums(question: ParsedQuestion, track: ExamTrack): ParsedQuestion {
  const enums = TRACK_ENUMS[track];
  return {
    ...question,
    examTrack: track,
    domain: enums.domains.includes(question.domain) ? question.domain : enums.defaultDomain,
    competency: enums.competencies.includes(question.competency)
      ? question.competency
      : enums.defaultCompetency,
  };
}

/** The model's questions as written, before any track is applied. */
function parseRaw(content: string): ParsedQuestion[] {
  const text = stripFences(content);

  try {
    const parsed = JSON.parse(text);
    const list = (parsed as Record<string, unknown>)?.questions;
    if (Array.isArray(list)) {
      return list
        .map((item, i) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? toQuestion(item as Record<string, unknown>, i + 1)
            : null
        )
        .filter((q): q is ParsedQuestion => q !== null);
    }
  } catch {
    // Truncated or malformed — fall through to the element scan.
  }

  return completedElements(text)
    .map((element, i) => {
      try {
        const parsed = JSON.parse(element);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        return toQuestion(parsed as Record<string, unknown>, i + 1);
      } catch {
        return null;
      }
    })
    .filter((q): q is ParsedQuestion => q !== null);
}

/**
 * Parses the finished response, salvaging what it can from a damaged tail.
 * Every question is held to one track; a batch that mixes tracks goes through
 * prepareBatch, which reads the track per plan row.
 */
export function parseBatchContent(content: string, track: ExamTrack = "step1"): ParsedQuestion[] {
  return parseRaw(content).map((q) => withTrackEnums(q, track));
}

export interface PersistInput {
  content: string;
  system: SystemKey;
  plan: BatchPlan;
  topic: string;
  model: string;
  /**
   * Ties every row of one generation together, across the several waves a large
   * set takes. It is what claim_generated_questions looks rows up by, which is
   * how a question that was written but never acknowledged by the client still
   * finds its way into the session. Minted by the client, never by the model.
   */
  generationId: string;
}

export interface PreparedBatch {
  /** Parsed, option-permuted, in the model's own question order. */
  questions: ParsedQuestion[];
  /** One result per question, positionally aligned with `questions`. */
  qa: QaResult[];
}

/**
 * Everything between the raw response and the insert: parse, move each answer
 * onto its planned letter, then gate.
 *
 * Order matters. The permutation has to happen before the gate, because the gate
 * reads option positions and distractor-explanation letters, and the permuted
 * order is what the student will actually see. It has to happen before
 * buildDistractorExplanations for the same reason.
 *
 * Split out from the insert so the caller can run the cold-answering pass
 * against the same questions concurrently — the two are independent and the
 * batch should not pay for both in series.
 */
export function prepareBatch(content: string, plan: BatchPlan): PreparedBatch {
  const parsed = parseRaw(content);

  // A plan written before modes existed (an old eval report replayed through
  // regate.ts, say) has no examMode and no per-row track: Step 1, as it was.
  const planTrack: ExamTrack = plan.examMode === "step2ck" ? "step2ck" : "step1";

  const questions = parsed.map((question, i) => {
    // Fall back to position when the model's own index is missing or wrong;
    // the plan is per-index and a batch that mislabels one is still playable.
    const row = plan.questions.find((p) => p.index === question.index) ?? plan.questions[i];
    // The track comes from the row, never from the model's examTrack field.
    // The row is the instruction; the field is the model's report of having
    // followed it, and the two are stored side by side so they can be compared.
    const tracked = withTrackEnums(question, row?.examTrack ?? planTrack);
    return row ? permuteToPlannedLetter(tracked, row.answerLetter) : tracked;
  });

  return { questions, qa: checkBatch(questions) };
}

/**
 * One question as a `questions` row.
 *
 * Lifted out of persistBatch so the incremental writer can insert a single
 * question the moment it closes mid-stream and the batch writer can still do
 * one multi-row insert, without the two drifting into different column sets —
 * a generated row the grading RPC trusts must look identical whichever path
 * wrote it.
 */
function buildRow(
  question: ParsedQuestion,
  userId: string,
  input: PersistInput,
  qaResult: QaResult | undefined,
  verification: VerificationResult[]
) {
  return {
    subject: SYSTEM_NAMES[input.system],
    domain: question.domain,
    topic: question.subtopic,
    difficulty: question.difficulty,
    reasoning_order: question.reasoningOrder,
    competency: question.competency,
    question_text: `${question.vignette}\n\n${question.leadIn}`,
    option_a: question.options.a,
    option_b: question.options.b,
    option_c: question.options.c,
    option_d: question.options.d,
    option_e: question.options.e,
    correct_option: question.correctOption,
    explanation: question.explanation,
    teaching_point: question.teachingPoint,
    distractor_explanations: buildDistractorExplanations(question),
    // The concrete track the item was written on, never "mixed": a mixed set
    // yields individually filterable rows. What the student asked for is
    // generation_meta.examMode.
    exam_mode: question.examTrack,
    is_active: false,
    origin: "generated",
    created_by: userId,
    generation_meta: {
      generationId: input.generationId,
      model: input.model,
      promptVersion: PROMPT_VERSION,
      requestedTopic: input.topic,
      system: input.system,
      challenge: input.plan.challenge,
      examMode: input.plan.examMode,
      examTrack: question.examTrack,
      examTrackReported: question.examTrackReported,
      index: question.index,
      plannedAnswer: input.plan.questions.find((p) => p.index === question.index)?.answerLetter ?? null,
      plannedReasoningOrder:
        input.plan.questions.find((p) => p.index === question.index)?.reasoningOrder ?? null,
      reasoningChain: question.reasoningChain,
      selfCheck: question.selfCheck,
      reviewerFlag: question.reviewerFlag,
      suggestedImage: question.suggestedImage,
      // The two quality signals, stored rather than recomputed. Without these
      // there is no way to ask later how a change to the prompt or the gate
      // moved the numbers — the findings used to exist only in a React memo.
      qa: qaResult?.findings ?? [],
      qaBlocked: qaResult?.blocked ?? false,
      verification: verification.find((v) => v.index === question.index) ?? null,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Writes the batch and returns the new ids in the model's own question order.
 *
 * Rows are inactive by design. `is_active = false` is what keeps a generated
 * item out of the curated random sample — start_qbank_session's sampling branch
 * filters on it — while its explicit-ids branch admits an inactive row for the
 * user who created it. So these are playable by their author and invisible to
 * everyone else, with no extra policy.
 *
 * The audit trail the model produced (reasoning chain, self-check, reviewer
 * flag, the letter it was assigned) goes to generation_meta rather than into
 * the question columns: none of it should ever reach a student, and the
 * reasoning chain in particular spells out the answer.
 */
export async function persistBatch(
  client: SupabaseClient,
  userId: string,
  input: PersistInput,
  prepared: PreparedBatch,
  verification: VerificationResult[] = []
): Promise<string[]> {
  const { questions, qa } = prepared;
  if (questions.length === 0) return [];

  const rows = questions.map((question, i) =>
    buildRow(question, userId, input, qa[i], verification)
  );

  // Insert order is preserved by Postgres for a multi-row INSERT … RETURNING,
  // so the returned ids line up with `questions` — which is what lets the
  // client match a persisted id back to the draft it already rendered.
  const { data, error } = await client.from("questions").insert(rows).select("id");
  if (error) throw new Error(`insert_failed: ${error.message}`);

  return (data ?? []).map((row: { id: string }) => row.id);
}

/**
 * The outcome of writing one question: its id, or the database's reason for
 * refusing it.
 *
 * The reason is carried rather than dropped because the two failures it
 * distinguishes need opposite responses. A row rejected for its own sake — a
 * constraint the question itself violates — is the shortfall this function was
 * built to absorb, and a later wave simply writes another one. A row rejected
 * because the TABLE cannot accept it, a column the deployed function writes and
 * the schema does not have, fails identically for every question ever written
 * and no amount of regenerating will help. Both arrive here as `error`; only
 * the caller, which knows how many of the wave's inserts failed, can tell them
 * apart — and it can only do that if the message survives this far.
 */
export interface PersistOneResult {
  id: string | null;
  /**
   * The database's `code: message`, or null when the row landed.
   *
   * PostgREST's `details` is deliberately dropped: on a constraint violation it
   * carries the failing row, which is model output, and this string is both
   * logged and relayed to the client. `code` and `message` name the schema
   * object at fault and nothing else.
   */
  error: string | null;
}

/**
 * Writes one question and returns its id, or the reason it could not be saved.
 *
 * The incremental counterpart to persistBatch: a question is written the moment
 * it closes mid-stream rather than at the end of the batch, which is what lets
 * the student start on question one while the rest are still being written.
 *
 * It reports rather than throws because a single failed insert is a shortfall,
 * not a dead batch. The wave loop above it is driven by how many questions have
 * actually landed, so a lost row is simply regenerated by a later wave —
 * whereas throwing here would abort a stream that still had perfectly good
 * questions coming.
 */
export async function persistOne(
  client: SupabaseClient,
  userId: string,
  input: PersistInput,
  question: ParsedQuestion,
  qaResult: QaResult | undefined,
  verification: VerificationResult[] = []
): Promise<PersistOneResult> {
  const { data, error } = await client
    .from("questions")
    .insert(buildRow(question, userId, input, qaResult, verification))
    .select("id")
    .single();

  if (error) {
    return { id: null, error: [error.code, error.message].filter(Boolean).join(": ") };
  }
  return { id: (data as { id: string } | null)?.id ?? null, error: null };
}
