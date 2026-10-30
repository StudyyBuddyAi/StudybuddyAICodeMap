import { cortiComplete, type CortiConfig } from "./corti.ts";
import { EXAM_TRACK_NAMES, type ExamTrack, type OptionLetter } from "./qbank-prompt.ts";

/**
 * Independent cold-answering pass.
 *
 * The machine gate in qbank-qa.ts checks the mechanics of an item and says so
 * itself: factual accuracy is not decidable from the text, and belongs to a
 * pass that actually tries to answer the question. This is that pass.
 *
 * A second model, at temperature 0, is shown the stem, the lead-in and the
 * five options and nothing else. No explanation, no key, no reasoning chain.
 * If it lands somewhere other than the key, one of two things is true: the
 * item is wrong, or the item is hard enough to fool a prepared reader. Both
 * are worth a human look before a student sits it.
 *
 * Measured on a 50-item run before this existed: the probe disagreed on 5 items.
 * Read by hand, 2 of those 5 were genuinely defective — including the only item
 * in the run whose answer key was factually wrong, which every other signal
 * either missed or reported as a warning. The other 3 were the probe falling for
 * a well-built distractor, which is the cost of the check and the reason a
 * disagreement holds an item back for review rather than deleting it.
 *
 * That measurement was taken on `corti-s1-mini-instant` with a 300-token
 * budget. The probe is the weakest model in the pipeline yet a disagreement
 * withholds a question from the student, so it was raised to `corti-s1-instant`:
 * the same strength as the writer, with no reasoning pass to run out of budget.
 * `corti-s1` was tried here and measured worse than either — see corti.ts.
 * A probe primed for Step 1 judging Step 2 CK management items would add false
 * disagreements of its own, which is why the prompt is per track.
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

/**
 * Output budget for the probe. The answer is a ~50-token JSON object and the
 * probe runs on a non-reasoning model, so this is headroom, not a think budget.
 *
 * It was briefly 6000, sized for a reasoning probe on `corti-s1`. Measured on
 * a 10-item run: half the probes never emitted an answer at all, returning
 * "Unexpected end of JSON input" after burning the budget on reasoning, and
 * because the pass fails open those items shipped silently unverified. See
 * VERIFIER_MODEL.
 */
const VERIFIER_MAX_TOKENS = 800;

/**
 * Per-item ceiling. Items are verified individually as they close mid-stream,
 * so this bounds one question's wait, not the wave's. Raised from 45s for the
 * reasoning pass; a probe that runs out the clock still fails open.
 */
const VERIFIER_TIMEOUT_MS = 45_000;

/**
 * The probe is told which exam it is sitting. It withholds questions, and a
 * student primed to answer with the mechanism will disagree with a correct
 * management key more often than one primed for the standard of care.
 */
const VERIFIER_ROLE: Record<ExamTrack, string> = {
  step1: `You are a well-prepared US medical student sitting USMLE ${EXAM_TRACK_NAMES.step1}.`,
  step2ck: `You are a well-prepared US medical student sitting USMLE ${EXAM_TRACK_NAMES.step2ck}. Answer as the current standard of care would have you act for the patient in the stem.`,
};

const verifierPrompt = (track: ExamTrack) =>
  `${VERIFIER_ROLE[track]} You are given one question and five options and nothing else — no explanation, no answer key.

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
  /** The exam the item was written on. Absent on pre-mode shapes: Step 1. */
  examTrack?: ExamTrack;
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

/**
 * Answers one item blind. `track` is per question rather than per batch
 * because a mixed set carries both exams in one wave.
 */
export async function verifyOne(
  config: CortiConfig,
  question: VerifiableQuestion,
  track: ExamTrack = question.examTrack ?? "step1"
): Promise<VerificationResult> {
  const base = { index: question.index, answer: null, solvable: true, issue: "" };

  try {
    const raw = await cortiComplete(config, {
      model: config.verifierModel,
      temperature: 0,
      maxTokens: VERIFIER_MAX_TOKENS,
      json: true,
      messages: [
        { role: "system", content: verifierPrompt(track) },
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

// ── Writer-flag fact check ──────────────────────────────────────────────────

/**
 * What the fact check decided about an item its own writer was unsure of.
 *
 * Only `confirmed` admits the item. Every other verdict holds it back, and the
 * wave loop writes a replacement — the same path a gate block takes.
 */
export type FlagCheckVerdict =
  | "confirmed"
  | "outdated"
  | "contested"
  | "wrong_key"
  | "unsolvable"
  | "error";

export interface FlagCheckResult {
  index: number;
  verdict: FlagCheckVerdict;
  confirmed: boolean;
  /** The checker's reason, under ~25 words; "" when it gave none. */
  note: string;
  /** Set when the check could not be reached or parsed. */
  error: string | null;
}

const FLAG_VERDICTS: FlagCheckVerdict[] = ["confirmed", "outdated", "contested", "wrong_key", "unsolvable"];

/**
 * Not blind, unlike the probe above, and on purpose: the question here is not
 * "can a student answer this" but "is the writer's doubt material". That needs
 * the key, the explanation and the doubt itself in front of the checker.
 *
 * Measured motivation (live table, 2026-10-30): one Step 2 CK item in four
 * carried a writer flag, almost all "guideline from memory, unconfirmed", and
 * 63 of them reached students with nothing to say the author was unsure — SGLT2
 * inhibitors in HFpEF, AASLD thresholds, ICD criteria, empiric endocarditis
 * cover. Those are the items where a confident error does the most harm.
 */
const flagCheckPrompt = (track: ExamTrack) =>
  `You are a board-certified physician reviewing a USMLE ${EXAM_TRACK_NAMES[track]} practice item before it reaches students. The item's writer raised a concern about its own item. You are shown the stem, the options, the keyed answer, the explanation and the writer's concern.

Decide whether the keyed answer is the single best answer${
    track === "step2ck"
      ? " under the current US standard of care and the current major society guideline for this decision"
      : " under current First Aid-level teaching"
  }, and whether the writer's concern changes that.

Return ONE JSON object and nothing else:
{"verdict":"confirmed"|"outdated"|"contested"|"wrong_key"|"unsolvable","note":string}

- confirmed: the keyed answer is correct and current, and the concern does not change it — for example a trial name or a number the answer does not depend on.
- outdated: the keyed answer reflects superseded guidance.
- contested: major guidelines or current practice disagree, so more than one option is defensible.
- wrong_key: a different option is the best answer.
- unsolvable: the stem lacks data needed to choose one answer.
- note: your reason in under 25 words.`;

function renderForFlagCheck(question: FlagCheckableQuestion): string {
  const options = LETTERS.map((k) => `${k.toUpperCase()}. ${question.options[k]}`).join("\n");
  return `${question.vignette}

${question.leadIn}

${options}

Keyed answer: ${question.correctOption.toUpperCase()}

Explanation: ${question.explanation}

Writer's concern: ${question.reviewerFlag}`;
}

export interface FlagCheckableQuestion extends VerifiableQuestion {
  explanation: string;
  reviewerFlag: string;
}

/** Reads the checker's reply. Null when it is not one of the verdicts. */
export function parseFlagCheck(raw: string): { verdict: Exclude<FlagCheckVerdict, "error">; note: string } | null {
  try {
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim());
    const verdict = String(parsed?.verdict ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!FLAG_VERDICTS.includes(verdict as FlagCheckVerdict)) return null;
    const note = typeof parsed?.note === "string" ? parsed.note.trim().slice(0, 300) : "";
    return { verdict: verdict as Exclude<FlagCheckVerdict, "error">, note };
  } catch {
    return null;
  }
}

/**
 * Settles a writer flag on an item that already passed the gate and the blind
 * read.
 *
 * It fails CLOSED, the opposite of the probe. The probe checks an item nobody
 * has doubted, so an outage there should not cost the student a question. This
 * runs only on items the author itself was unsure of; when the doubt cannot be
 * cleared, the honest outcome is a replacement item, which the wave loop writes
 * anyway, and a free student is never charged for it (the cap counts delivered
 * questions only).
 *
 * `complete` is injectable so the tests can drive it without a network.
 */
export async function checkWriterFlag(
  config: CortiConfig,
  question: FlagCheckableQuestion,
  track: ExamTrack = question.examTrack ?? "step1",
  complete: typeof cortiComplete = cortiComplete
): Promise<FlagCheckResult> {
  const base = { index: question.index, confirmed: false, note: "" };
  try {
    const raw = await complete(config, {
      model: config.verifierModel,
      temperature: 0,
      maxTokens: VERIFIER_MAX_TOKENS,
      json: true,
      messages: [
        { role: "system", content: flagCheckPrompt(track) },
        { role: "user", content: renderForFlagCheck(question) },
      ],
      signal: AbortSignal.timeout(VERIFIER_TIMEOUT_MS),
    });

    const parsed = parseFlagCheck(raw);
    if (!parsed) {
      return { ...base, verdict: "error", error: `unparseable verdict: ${raw.slice(0, 40)}` };
    }
    return {
      index: question.index,
      verdict: parsed.verdict,
      confirmed: parsed.verdict === "confirmed",
      note: parsed.note,
      error: null,
    };
  } catch (err) {
    return { ...base, verdict: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Answers every item in the batch blind, in parallel.
 *
 * Parallel because the batch is small and the calls are independent, so the
 * whole pass costs about one item's latency. Each item is judged on its own
 * track, so a mixed batch needs no special handling here.
 */
export function verifyBatch(
  config: CortiConfig,
  questions: VerifiableQuestion[]
): Promise<VerificationResult[]> {
  return Promise.all(questions.map((q) => verifyOne(config, q)));
}
