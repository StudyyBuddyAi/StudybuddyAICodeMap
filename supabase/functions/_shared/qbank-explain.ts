/**
 * The full explanation of a QBank question, written once, after a student has
 * answered it.
 *
 * Early-access feedback: the explanation was short, and students preparing
 * for the USMLE want the depth of a commercial QBank — tables and figures.
 * The writer's own explanation stays short on purpose (qbank-prompt.ts asks
 * for concision, and a longer one would slow every set); this is a second,
 * deeper read written on demand: the concept in depth, why each option is
 * right or wrong, a comparison table where the topic has look-alikes, and the
 * stepwise algorithm drawn as a figure where it has one.
 *
 * It is grounded on the question as stored — vignette, key, explanation — so
 * it explains the item rather than the topic, and the key is never argued
 * with in front of the student: if the writer is sure the key is wrong, it
 * says so and the explanation is held back for review.
 *
 * No Deno API here, so the app's tests run it.
 */
import { repairLlmJson } from "./repair-llm-json.ts";

export const EXPLAIN_PROMPT_VERSION = "explain-v1";

const LETTERS = ["a", "b", "c", "d", "e"] as const;
export type OptionLetter = (typeof LETTERS)[number];

/** A question as stored, with what grading reveals. */
export interface ExplainableQuestion {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string;
  correct_option: string;
  explanation: string | null;
  teaching_point: string | null;
  distractor_explanations: Record<string, string> | null;
  subject?: string | null;
  topic?: string | null;
}

export interface ExplanationTable {
  title: string;
  columns: string[];
  rows: string[][];
}

/** One box of the algorithm; a decision says where yes and no lead. */
export interface AlgorithmStep {
  text: string;
  yes?: string;
  no?: string;
}

export interface FullExplanation {
  bottomLine: string;
  explanation: string[];
  options: Partial<Record<OptionLetter, string>>;
  table: ExplanationTable | null;
  algorithm: { title: string; steps: AlgorithmStep[] } | null;
  highYield: string[];
}

/** What the writer returned: an explanation, or a doubt about the key. */
export type ExplainResult = { kind: "explained"; explanation: FullExplanation } | { kind: "disputed"; reason: string };

export const EXPLAIN_SYSTEM_PROMPT = `You are a USMLE educator writing the full explanation of a question a student has just answered — the teaching a leading QBank gives after each item. A short explanation is already shown to the student; yours goes deeper and stands on its own.

Rules:
- The keyed answer is correct. Explain it and never contradict it. Only if you are certain it is medically wrong, set "agrees" to false, give the reason in "disagreement", and leave every other field empty.
- Teach the concept the question tests, not only this patient: the mechanism or reasoning, how to recognise the presentation, and what to know or do next.
- Use the standard high-yield wording of First Aid and board review. Bold (**like this**) only the four to six terms most worth remembering, across the whole explanation.
- No references, citations, trial names, guideline names with years, or numbers you are not sure of.
- A table only when the topic has look-alikes to tell apart (the key against its closest distractors, or the differential): 2 to 4 columns, 3 to 6 rows, short cells. Otherwise null.
- An algorithm only when the topic has a real stepwise approach (a workup or a management pathway): 3 to 7 steps in order. For a decision step, say in a few words where "yes" and "no" lead; for a plain step leave them "". Otherwise null.

Return ONE JSON object and nothing else — no prose around it, no code fences:
{
  "agrees": boolean,
  "disagreement": string,
  "bottomLine": string,
  "explanation": [string],
  "options": { "a": string, "b": string, "c": string, "d": string, "e": string },
  "table": { "title": string, "columns": [string], "rows": [[string]] } | null,
  "algorithm": { "title": string, "steps": [{ "text": string, "yes": string, "no": string }] } | null,
  "highYield": [string]
}

Field notes:
- bottomLine: the educational objective, one sentence.
- explanation: 3 to 5 short paragraphs.
- options: every letter, 1 to 2 sentences each — for the key why it is right, for the others why it is wrong here and when it would be right.
- highYield: 3 to 5 facts to remember, one line each.`;

const strip = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** The question as the writer reads it: everything the student now sees. */
export function explainUserContent(q: ExplainableQuestion): string {
  const options = LETTERS.map((l) => `${l.toUpperCase()}. ${strip(q[`option_${l}` as const])}`).join("\n");
  const key = (q.correct_option ?? "").toLowerCase();
  const wrong = Object.entries(q.distractor_explanations ?? {})
    .filter(([l, t]) => l !== key && t)
    .map(([l, t]) => `${l.toUpperCase()}: ${strip(t)}`)
    .join("\n");
  return [
    q.subject && `System: ${strip(q.subject)}`,
    q.topic && `Tested concept: ${strip(q.topic)}`,
    `Question:\n${(q.question_text ?? "").trim()}`,
    `Options:\n${options}`,
    `Keyed answer: ${key.toUpperCase()}`,
    q.explanation && `Short explanation already shown:\n${strip(q.explanation)}`,
    q.teaching_point && `Key teaching point: ${strip(q.teaching_point)}`,
    wrong && `Why the others are wrong (already shown):\n${wrong}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const MAX = { line: 600, paragraphs: 6, highYield: 6, columns: 4, rows: 8, cell: 160, steps: 8 } as const;

const text = (v: unknown, max: number = MAX.line): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const lines = (v: unknown, n: number): string[] =>
  Array.isArray(v) ? v.map((x) => text(x)).filter(Boolean).slice(0, n) : [];

function parseTable(v: unknown): ExplanationTable | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  const columns = lines(t.columns, MAX.columns).map((c) => c.slice(0, MAX.cell));
  if (columns.length < 2 || !Array.isArray(t.rows)) return null;
  // A row that doesn't fit the header is dropped, not padded: a cell under
  // the wrong heading teaches the wrong thing.
  const rows = t.rows
    .filter((r): r is unknown[] => Array.isArray(r) && r.length === columns.length)
    .map((r) => r.map((c) => text(c, MAX.cell)))
    .filter((r) => r.some(Boolean))
    .slice(0, MAX.rows);
  return rows.length >= 2 ? { title: text(t.title, 120), columns, rows } : null;
}

function parseAlgorithm(v: unknown): FullExplanation["algorithm"] {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  if (!Array.isArray(a.steps)) return null;
  const steps = a.steps
    .map((s): AlgorithmStep | null => {
      if (!s || typeof s !== "object") return null;
      const r = s as Record<string, unknown>;
      const step: AlgorithmStep = { text: text(r.text, 240) };
      // Only a question branches; a "yes" on a plain step reads as one.
      if (step.text.endsWith("?")) {
        const yes = text(r.yes, 120);
        const no = text(r.no, 120);
        if (yes) step.yes = yes;
        if (no) step.no = no;
      }
      return step.text ? step : null;
    })
    .filter((s): s is AlgorithmStep => s !== null)
    .slice(0, MAX.steps);
  return steps.length >= 3 ? { title: text(a.title, 120), steps } : null;
}

/**
 * The writer's reply, validated. Null when it is not usable — the student
 * keeps the short explanation and nothing is cached.
 */
export function parseExplainReply(raw: string): ExplainResult | null {
  // The object alone: a fence or a stray sentence either side is dropped.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(repairLlmJson(raw.slice(start, end + 1)));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;

  if (d.agrees === false) {
    return { kind: "disputed", reason: text(d.disagreement) || "The writer doubted the keyed answer." };
  }

  const bottomLine = text(d.bottomLine);
  const explanation = lines(d.explanation, MAX.paragraphs);
  if (!bottomLine || !explanation.length) return null;

  const options: FullExplanation["options"] = {};
  if (d.options && typeof d.options === "object") {
    for (const l of LETTERS) {
      const t = text((d.options as Record<string, unknown>)[l]);
      if (t) options[l] = t;
    }
  }

  return {
    kind: "explained",
    explanation: {
      bottomLine,
      explanation,
      options,
      table: parseTable(d.table),
      algorithm: parseAlgorithm(d.algorithm),
      highYield: lines(d.highYield, MAX.highYield),
    },
  };
}
