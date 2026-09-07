import { stripFences } from "./sanitize-json";
import { repairLlmJson } from "./repair-llm-json";
import type {
  Difficulty,
  GeneratedQuestionDraft,
  OptionKey,
  ReasoningOrder,
  SelfCheck,
  SuggestedImage,
} from "./qbank-types";

/**
 * Reading a half-streamed question batch.
 *
 * Same problem parse-partial-sheet.ts solves, one level down. The model emits
 * `{ "batchPlan": {...}, "questions": [ ... ] }` as a single object, so nothing
 * is parseable until the last token — and a five-question batch is roughly a
 * minute of generation. Waiting for it means a minute of spinner.
 *
 * The difference from the sheet parser is the grain. There, the useful unit is
 * a top-level key; here it is an *array element*, because a question is only
 * worth showing once it is whole. A half-written vignette with no options is
 * not a question, and a repaired-tail question would render with fabricated
 * empty fields. So this deliberately does not repair the in-flight element: it
 * finds the elements that closed on their own and ignores the rest.
 */

/** Walks `text` from `start` (the char after `[`) and returns each closed element. */
function completedElements(text: string, start: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let elementStart = -1;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      if (depth === 0 && ch === "{") elementStart = i;
      depth++;
    } else if (ch === "}" || ch === "]") {
      // A `]` at depth 0 closes the questions array itself — nothing follows
      // that belongs to it.
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

/** Index of the char just after the `[` that opens the questions array. */
function questionsArrayStart(text: string): number {
  const key = /"questions"\s*:\s*\[/.exec(text);
  return key ? key.index + key[0].length : -1;
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

const OPTION_KEYS: OptionKey[] = ["a", "b", "c", "d", "e"];

const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard"];
const REASONING_ORDERS: ReasoningOrder[] = ["1st", "2nd", "3rd"];

function asOptionKey(v: unknown): OptionKey | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (OPTION_KEYS as string[]).includes(s) ? (s as OptionKey) : null;
}

/** All five options present and non-empty, or null — a partial set is unusable. */
function asOptions(v: unknown): Record<OptionKey, string> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const raw = v as Record<string, unknown>;
  const out = {} as Record<OptionKey, string>;
  for (const key of OPTION_KEYS) {
    const value = raw[key];
    if (typeof value !== "string" || !value.trim()) return null;
    out[key] = value.trim();
  }
  return out;
}

function asDistractorExplanations(v: unknown): Partial<Record<OptionKey, string>> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const raw = v as Record<string, unknown>;
  const out: Partial<Record<OptionKey, string>> = {};
  for (const key of OPTION_KEYS) {
    if (typeof raw[key] === "string") out[key] = raw[key] as string;
  }
  return out;
}

function asSelfCheck(v: unknown): SelfCheck | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: SelfCheck = {};
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function asSuggestedImage(v: unknown): SuggestedImage | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const raw = v as Record<string, unknown>;
  const needed = asString(raw.needed);
  return {
    needed: needed === "Yes" || needed === "Optional" ? needed : "No",
    type: asString(raw.type) || "none",
    searchTags: Array.isArray(raw.searchTags)
      ? raw.searchTags.filter((t): t is string => typeof t === "string")
      : [],
    mustShow: asString(raw.mustShow),
  };
}

/**
 * Turn one parsed element into a draft, or null if it is not a usable question.
 *
 * Strict on the five fields a student would actually see — stem, lead-in, five
 * options, a key that names one of them — and forgiving on everything else. A
 * model that omits teachingPoint has written a slightly worse question; a model
 * that omits half its options has not written a question at all.
 */
function toDraft(raw: Record<string, unknown>, fallbackIndex: number): GeneratedQuestionDraft | null {
  const options = asOptions(raw.options);
  const correctOption = asOptionKey(raw.correctOption);
  const vignette = asString(raw.vignette).trim();
  const leadIn = asString(raw.leadIn).trim();

  if (!options || !correctOption || !vignette || !leadIn) return null;

  const difficulty = asString(raw.difficulty) as Difficulty;
  const reasoningOrder = asString(raw.reasoningOrder) as ReasoningOrder;

  return {
    index: typeof raw.index === "number" ? raw.index : fallbackIndex,
    system: asString(raw.system),
    domain: asString(raw.domain),
    subtopic: asString(raw.subtopic),
    competency: asString(raw.competency),
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : "Medium",
    reasoningOrder: REASONING_ORDERS.includes(reasoningOrder) ? reasoningOrder : "2nd",
    reasoningChain: asString(raw.reasoningChain),
    vignette,
    leadIn,
    options,
    correctOption,
    explanation: asString(raw.explanation),
    distractorExplanations: asDistractorExplanations(raw.distractorExplanations),
    teachingPoint: asString(raw.teachingPoint),
    suggestedImage: asSuggestedImage(raw.suggestedImage),
    selfCheck: asSelfCheck(raw.selfCheck),
    reviewerFlag: asString(raw.reviewerFlag) || undefined,
  };
}

/**
 * Parse however much of a streamed question batch has arrived.
 *
 * Returns the questions that are complete, in arrival order. Safe to call on
 * every chunk: it is a single linear scan, and a question that appears once
 * keeps appearing with identical content, so callers can render straight off
 * the returned array without diffing.
 */
export function parsePartialQuestions(raw: string): GeneratedQuestionDraft[] {
  const text = repairLlmJson(stripFences(raw));
  const start = questionsArrayStart(text);
  if (start < 0) return [];

  const drafts: GeneratedQuestionDraft[] = [];
  completedElements(text, start).forEach((element, i) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(element);
    } catch {
      // One malformed element must not hide the ones after it — the model
      // sometimes fumbles an escape mid-batch and recovers.
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const draft = toDraft(parsed as Record<string, unknown>, i + 1);
    if (draft) drafts.push(draft);
  });

  return drafts;
}

/**
 * Parse a finished response.
 *
 * Tries the whole object first so a well-formed batch keeps its batchPlan, and
 * falls back to the element scan — which does not need the outer object to have
 * closed — when the response was truncated or the tail was damaged. A batch cut
 * short still yields every question that completed before the damage.
 */
export function parseQuestionsOutput(raw: string): GeneratedQuestionDraft[] {
  const text = repairLlmJson(stripFences(raw));

  try {
    const parsed = JSON.parse(text);
    const list = (parsed as Record<string, unknown>)?.questions;
    if (Array.isArray(list)) {
      return list
        .map((item, i) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? toDraft(item as Record<string, unknown>, i + 1)
            : null
        )
        .filter((d): d is GeneratedQuestionDraft => d !== null);
    }
  } catch {
    // Fall through to the partial scan.
  }

  return parsePartialQuestions(raw);
}
