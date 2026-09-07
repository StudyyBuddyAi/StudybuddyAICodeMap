import { cortiComplete, type CortiConfig } from "./corti.ts";
import type { OptionLetter } from "./qbank-prompt.ts";

/**
 * Independent cold-answering pass.
 *
 * The machine gate in qbank-qa.ts checks the mechanics of an item and says so
 * itself: factual accuracy is not decidable from the text, and belongs to a
 * pass that actually tries to answer the question. This is that pass.
 *
 * A second model — a small, cheap one, at temperature 0 — is shown the stem,
 * the lead-in and the five options and nothing else. No explanation, no key, no
 * reasoning chain. If it lands somewhere other than the key, one of two things
 * is true: the item is wrong, or the item is hard enough to fool a prepared
 * reader. Both are worth a human look before a student sits it.
 *
 * Measured on a 50-item run before this existed: the probe disagreed on 5 items.
 * Read by hand, 2 of those 5 were genuinely defective — including the only item
 * in the run whose answer key was factually wrong, which every other signal
 * either missed or reported as a warning. The other 3 were the probe falling for
 * a well-built distractor, which is the cost of the check and the reason a
 * disagreement holds an item back for review rather than deleting it.
 *
 * Two deliberate choices:
 *
 *  - It fails OPEN. A verifier that times out or returns nonsense must not cost
 *    the student a batch they waited ninety seconds for, so an errored item is
 *    treated as agreed and the error is recorded.
 *  - Its self-reported confidence is ignored. On the measured run it returned
 *    1.0 on almost every item including the ones it got wrong, so it carries no
 *    information and is not worth the tokens to read.
 */

/** Model for the probe. Deliberately not the writer — an independent read. */
const VERIFIER_MODEL = "corti-s1-mini-instant" as const;

/** One item is a few hundred tokens; well clear of any reasonable answer. */
const VERIFIER_MAX_TOKENS = 300;

/** Per-item ceiling. The whole batch runs in parallel, so this is the wall. */
const VERIFIER_TIMEOUT_MS = 45_000;

const VERIFIER_PROMPT = `You are a well-prepared US medical student sitting USMLE Step 1. You are given one question and five options and nothing else — no explanation, no answer key.

Pick the single best answer. Then judge the item itself.

Return ONE JSON object and nothing else:
{"answer":"a"|"b"|"c"|"d"|"e","solvable":boolean,"issue":string}

- answer: the single best option. Always name one, even if you are unsure.
- solvable: false if the stem does not contain enough information to reach one defensible answer, or if two or more options are defensible.
- issue: "None." when the item is clean. Otherwise name the single biggest problem in under 15 words — factual error, two defensible answers, missing data, answer given away by the wording, or an option that is not in the same category as the others.`;

export interface VerifiableQuestion {
  index: number;
  vignette: string;
  leadIn: string;
  options: Record<OptionLetter, string>;
  correctOption: OptionLetter;
}

export interface VerificationResult {
  index: number;
  /** False only when the probe answered, and answered something else. */
  agreed: boolean;
  answer: OptionLetter | null;
  /** The probe's read on whether the item can be answered at all. */
  solvable: boolean;
  /** The probe's one-line concern, or "" when it had none. */
  issue: string;
  /** Set when the probe could not be reached or could not be parsed. */
  error: string | null;
}

const LETTERS: OptionLetter[] = ["a", "b", "c", "d", "e"];

function renderItem(question: VerifiableQuestion): string {
  const options = LETTERS.map((k) => `${k.toUpperCase()}. ${question.options[k]}`).join("\n");
  return `${question.vignette}\n\n${question.leadIn}\n\n${options}`;
}

async function verifyOne(
  config: CortiConfig,
  question: VerifiableQuestion
): Promise<VerificationResult> {
  const base = { index: question.index, answer: null, solvable: true, issue: "" };

  try {
    const raw = await cortiComplete(config, {
      model: VERIFIER_MODEL,
      temperature: 0,
      maxTokens: VERIFIER_MAX_TOKENS,
      json: true,
      messages: [
        { role: "system", content: VERIFIER_PROMPT },
        { role: "user", content: renderItem(question) },
      ],
      signal: AbortSignal.timeout(VERIFIER_TIMEOUT_MS),
    });

    const parsed = JSON.parse(
      raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim()
    );

    const answer = String(parsed?.answer ?? "").trim().toLowerCase();
    if (!LETTERS.includes(answer as OptionLetter)) {
      return { ...base, agreed: true, error: `off-enum answer: ${answer.slice(0, 20)}` };
    }

    return {
      index: question.index,
      agreed: answer === question.correctOption,
      answer: answer as OptionLetter,
      solvable: parsed?.solvable !== false,
      issue: typeof parsed?.issue === "string" && !/^none\.?$/i.test(parsed.issue.trim())
        ? parsed.issue.trim()
        : "",
      error: null,
    };
  } catch (err) {
    // Fail open: an unreachable verifier is not the student's problem.
    return { ...base, agreed: true, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Answers every item in the batch blind, in parallel.
 *
 * Parallel because the batch is small and the calls are independent, so the
 * whole pass costs about one item's latency — roughly a second against the
 * ninety the generation itself takes.
 */
export function verifyBatch(
  config: CortiConfig,
  questions: VerifiableQuestion[]
): Promise<VerificationResult[]> {
  return Promise.all(questions.map((q) => verifyOne(config, q)));
}
