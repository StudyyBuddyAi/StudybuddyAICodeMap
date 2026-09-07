import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { SYSTEM_NAMES, type BatchPlan, type OptionLetter, type SystemKey } from "./qbank-prompt.ts";

/**
 * Parsing and persisting a generated batch, server-side.
 *
 * Deliberately narrower than src/lib/parse-partial-questions.ts, which does the
 * other half of the job: that one parses an in-flight stream at element grain
 * so the preview can reveal questions as they finish, and it runs in the
 * browser. This one sees the finished text and has a different obligation — it
 * decides what is safe to write into a table the grading RPC will later trust.
 *
 * The QA gate is deliberately NOT applied here. It lives in src/lib/qbank-qa.ts
 * where it is unit-tested, and the client already has it; duplicating 380 lines
 * of rule checks into Deno to run them twice would guarantee the two copies
 * drift. Everything that parses is persisted, and the client decides which ids
 * to hand to start_qbank_session — the RPC re-checks ownership regardless, so a
 * blocked item that is never requested is simply an unused row.
 */

const OPTION_KEYS: OptionLetter[] = ["a", "b", "c", "d", "e"];
const DIFFICULTIES = ["Easy", "Medium", "Hard"];
const REASONING_ORDERS = ["1st", "2nd", "3rd"];

/** The `questions` domain column has no constraint, but the prompt's enum does. */
const DOMAINS = [
  "Anatomy", "Embryology", "Histopathology", "Physiology",
  "Pathology", "Pharmacology", "Pattern Recognition",
];

export interface ParsedQuestion {
  index: number;
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
  const domain = asString(raw.domain);

  return {
    index: typeof raw.index === "number" ? raw.index : fallbackIndex,
    domain: DOMAINS.includes(domain) ? domain : "Pathology",
    subtopic: asString(raw.subtopic) || "Untitled",
    competency: asString(raw.competency) || "Foundational Science",
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

/** Parses the finished response, salvaging what it can from a damaged tail. */
export function parseBatchContent(content: string): ParsedQuestion[] {
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
 * The `questions` table has one explanation column, but the prompt produces two
 * things a learner needs: why the key is right, and why each distractor is
 * wrong. They are joined here so the existing player renders both without any
 * change — the explanation panel is `whitespace-pre-line`, so the line breaks
 * survive, and renderMarkdown keeps the bolding.
 *
 * Letters are upper-cased to match how the options are labelled on screen.
 */
function composeExplanation(question: ParsedQuestion): string {
  const wrong = OPTION_KEYS
    .filter((k) => k !== question.correctOption && question.distractorExplanations[k])
    .map((k) => `${k.toUpperCase()}. ${question.distractorExplanations[k]}`);

  if (wrong.length === 0) return question.explanation;
  return `${question.explanation}\n\nWhy the others are wrong\n${wrong.join("\n")}`;
}

export interface PersistInput {
  content: string;
  system: SystemKey;
  plan: BatchPlan;
  topic: string;
  model: string;
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
  input: PersistInput
): Promise<string[]> {
  const questions = parseBatchContent(input.content);
  if (questions.length === 0) return [];

  const rows = questions.map((question) => ({
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
    explanation: composeExplanation(question),
    teaching_point: question.teachingPoint,
    is_active: false,
    origin: "generated",
    created_by: userId,
    generation_meta: {
      model: input.model,
      promptVersion: "v13.1-api",
      requestedTopic: input.topic,
      system: input.system,
      index: question.index,
      plannedAnswer: input.plan.questions.find((p) => p.index === question.index)?.answerLetter ?? null,
      plannedReasoningOrder:
        input.plan.questions.find((p) => p.index === question.index)?.reasoningOrder ?? null,
      reasoningChain: question.reasoningChain,
      selfCheck: question.selfCheck,
      reviewerFlag: question.reviewerFlag,
      suggestedImage: question.suggestedImage,
      generatedAt: new Date().toISOString(),
    },
  }));

  // Insert order is preserved by Postgres for a multi-row INSERT … RETURNING,
  // so the returned ids line up with `questions` — which is what lets the
  // client match a persisted id back to the draft it already rendered.
  const { data, error } = await client.from("questions").insert(rows).select("id");
  if (error) throw new Error(`insert_failed: ${error.message}`);

  return (data ?? []).map((row: { id: string }) => row.id);
}
