import type { GeneratedQuestionDraft, OptionKey } from "./qbank-types";

/**
 * Machine QA gate for generated questions.
 *
 * The v13 prompt asks the model to self-check every item against ten rules, and
 * the model dutifully reports that it passed. That report is worth having but
 * cannot be the gate: a model does not know what it does not know, and the
 * measured reject rate for AI-written single-best-answer items is around 31%.
 *
 * Several of v13's rules are deterministic, so they are checked here instead of
 * trusted. This catches the mechanical flaws — the ones NBME's item-writing
 * guide calls out as giving savvy test-takers an edge without testing anything:
 * a correct answer that stands out by length, cueing between stem and key,
 * "all of the above", vague qualifier language in the options.
 *
 * What it deliberately does NOT check is factual accuracy or option
 * homogeneity, neither of which is decidable from the text. Accuracy is the job
 * of the independent cold-answering pass; homogeneity stays with the reviewer.
 *
 * A `block` finding means the item is not fit to be answered by a student and
 * must not be persisted. A `warn` finding is worth surfacing to a reviewer but
 * does not stop the item.
 */

export type QaSeverity = "block" | "warn";

export interface QaFinding {
  /** Stable slug, so the UI can group findings without matching on prose. */
  rule: string;
  severity: QaSeverity;
  detail: string;
}

export interface QaResult {
  index: number;
  findings: QaFinding[];
  /** True when any finding is a block. */
  blocked: boolean;
}

const OPTION_KEYS: OptionKey[] = ["a", "b", "c", "d", "e"];

/**
 * v13 Rule 6's banned list, verbatim. These are checked against the options
 * only — the same words are perfectly normal inside a vignette or explanation.
 */
const BANNED_OPTION_PHRASES = [
  "always",
  "never",
  "usually",
  "frequently",
  "may ",
  "could be",
  "is associated with",
  "is useful for",
];

/** v13 Pitfall 7: the explanation must never expose the reasoning scaffolding. */
const META_LANGUAGE = [
  "step 1",
  "step 2",
  "step 3",
  "reasoning chain",
  "fails at step",
  "first step",
];

/**
 * Words too common in clinical prose to carry any signal. Deliberately separate
 * from the list in source-labels.ts, whose stopwords ("pdf", "ebook", "scan")
 * are tuned for mangled PDF filenames and would let a great deal of clinical
 * filler through here.
 */
const CLINICAL_STOPWORDS = new Set([
  "patient", "history", "physical", "examination", "presents", "reveals",
  "shows", "findings", "results", "which", "following", "most", "likely",
  "there", "with", "this", "that", "from", "have", "been", "were", "their",
  "increased", "decreased", "normal", "abnormal", "years", "year", "week",
  "weeks", "month", "months", "days", "male", "female", "woman", "man",
  // Physiology vocabulary common enough to appear in any stem and any option
  // on the same topic. Without these the cueing check fires on "pressure" and
  // "diastolic", which tell a student nothing they did not already know from
  // the subject of the question.
  "blood", "pressure", "systolic", "diastolic", "arterial", "venous",
  "cardiac", "vascular", "volume", "flow", "rate", "wall", "cell", "cells",
  "tissue", "level", "levels", "acute", "chronic", "effect", "effects",
  "mechanism", "response", "function", "during", "after", "before", "into",
  "within", "artery", "arteries", "vein", "veins", "muscle", "smooth",
]);

/** Lowercased 4+ character words, crudely stemmed, clinical filler removed. */
function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !CLINICAL_STOPWORDS.has(t))
      .map((t) => t.replace(/(?:ies|es|ing|s)$/, ""))
      .filter((t) => t.length >= 4)
  );
}

/** Count of `**bolded**` spans. */
function boldSpans(value: string): string[] {
  return value.match(/\*\*[^*]+\*\*/g) ?? [];
}

function distractorKeys(correct: OptionKey): OptionKey[] {
  return OPTION_KEYS.filter((k) => k !== correct);
}

/**
 * The key has to clear the longest distractor by this much before length is a
 * tell rather than a coincidence — 40% longer, and at least 20 characters.
 *
 * Both bounds are needed, and measuring against the longest distractor rather
 * than the mean is the point. An earlier version compared to the mean at a 25%
 * margin and blocked three items in five: real keys that happened to be the
 * longest option ran 2, 4 and 14 characters clear of the next longest, which no
 * student could read anything into, but sat well above a mean dragged down by
 * two short options. What NBME actually warns about is a key padded with
 * caveats and instructional material until it visibly outweighs the field, and
 * that looks like the 80-character gap this now requires.
 */
const LENGTH_TELL_RATIO = 1.4;
const LENGTH_TELL_CHARS = 20;

/** v13 Rule 7 / NBME "correct answer standing out". */
function checkKeyLength(draft: GeneratedQuestionDraft, findings: QaFinding[]): void {
  const key = draft.options[draft.correctOption].length;
  const others = distractorKeys(draft.correctOption).map((k) => draft.options[k].length);
  const longest = Math.max(...others);

  if (key > longest * LENGTH_TELL_RATIO && key - longest >= LENGTH_TELL_CHARS) {
    findings.push({
      rule: "key-longest",
      severity: "block",
      detail: `Correct option ${draft.correctOption} is ${key} chars against a longest distractor of ${longest} — length gives the answer away.`,
    });
  }
}

function checkBannedLanguage(draft: GeneratedQuestionDraft, findings: QaFinding[]): void {
  for (const letter of OPTION_KEYS) {
    const text = ` ${draft.options[letter].toLowerCase()} `;
    for (const phrase of BANNED_OPTION_PHRASES) {
      if (text.includes(phrase)) {
        findings.push({
          rule: "banned-option-language",
          severity: "block",
          detail: `Option ${letter} contains banned qualifier "${phrase.trim()}" (Rule 6).`,
        });
      }
    }
  }
}

function checkAllOrNone(draft: GeneratedQuestionDraft, findings: QaFinding[]): void {
  for (const letter of OPTION_KEYS) {
    const text = draft.options[letter].toLowerCase();
    if (text.includes("of the above") || text === "all of these" || text === "none of these") {
      findings.push({
        rule: "all-or-none-option",
        severity: "block",
        detail: `Option ${letter} is an all/none-of-the-above option (Rule 8).`,
      });
    }
  }
}

function checkDistinctOptions(draft: GeneratedQuestionDraft, findings: QaFinding[]): void {
  const seen = new Map<string, OptionKey>();
  for (const letter of OPTION_KEYS) {
    const normalized = draft.options[letter].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const prior = seen.get(normalized);
    if (prior) {
      findings.push({
        rule: "duplicate-option",
        severity: "block",
        detail: `Options ${prior} and ${letter} are the same answer (Rule 8 requires five distinct options).`,
      });
    }
    seen.set(normalized, letter);
  }
}

/**
 * v13 Rule 10 / NBME cueing.
 *
 * The mechanical half of telegraphing: a distinctive word shared between the
 * stem and the key, and present in none of the distractors, lets a student
 * match on vocabulary instead of reasoning. Judgement-based telegraphing —
 * finding sequence, over-specific description — is not decidable here and stays
 * with the reviewer, so this is a warn rather than a block.
 */
function checkCueing(draft: GeneratedQuestionDraft, findings: QaFinding[]): void {
  // Vignette only, deliberately. NBME's cueing flaw is stem language echoed in
  // the key; the lead-in is a different thing — Rule 3 requires it to name the
  // category being asked about, and Rule 4 requires every option to belong to
  // that category, so a lead-in asking "which transporter" will always share
  // vocabulary with a correct answer that is a transporter. Counting that as
  // cueing flags the rules working.
  const stemTokens = tokens(draft.vignette);
  const keyTokens = tokens(draft.options[draft.correctOption]);
  const distractorTokens = new Set<string>();
  for (const letter of distractorKeys(draft.correctOption)) {
    for (const t of tokens(draft.options[letter])) distractorTokens.add(t);
  }

  // A word drawn from the question's own subject is not a cue. Every item on
  // aortic dissection will say "dissection" in the stem, and if it is also the
  // right answer's vocabulary that is the topic showing through, not a tell.
  const topicTokens = tokens(draft.subtopic);

  const cues = [...keyTokens].filter(
    (t) => stemTokens.has(t) && !distractorTokens.has(t) && !topicTokens.has(t)
  );
  if (cues.length > 0) {
    findings.push({
      rule: "stem-key-cueing",
      severity: "warn",
      detail: `"${cues.join('", "')}" appears in both the stem and the correct answer but in no distractor (Rule 10).`,
    });
  }
}

function checkMetaLanguage(draft: GeneratedQuestionDraft, findings: QaFinding[]): void {
  const haystack = [draft.explanation, ...Object.values(draft.distractorExplanations)]
    .join(" ")
    .toLowerCase();

  for (const phrase of META_LANGUAGE) {
    if (haystack.includes(phrase)) {
      findings.push({
        rule: "explanation-meta-language",
        severity: "block",
        detail: `Explanation exposes reasoning scaffolding ("${phrase}") — it must read as medical prose.`,
      });
    }
  }
}

function checkDistractorCoverage(draft: GeneratedQuestionDraft, findings: QaFinding[]): void {
  for (const letter of distractorKeys(draft.correctOption)) {
    if (!draft.distractorExplanations[letter]?.trim()) {
      findings.push({
        rule: "missing-distractor-explanation",
        severity: "warn",
        detail: `No explanation for distractor ${letter}.`,
      });
    }
  }
  if (draft.distractorExplanations[draft.correctOption]) {
    findings.push({
      rule: "distractor-explains-key",
      severity: "warn",
      detail: `Option ${draft.correctOption} is the correct answer but has a "why it is wrong" entry.`,
    });
  }
}

/**
 * v13's bolding rules. The cap exists because bolding is a skimming aid: an
 * explanation with everything bolded carries no more signal than one with
 * nothing bolded, and the contrast against unbolded distractor prose is what
 * lets a learner find the teaching content.
 */
function checkBolding(draft: GeneratedQuestionDraft, findings: QaFinding[]): void {
  const count = boldSpans(draft.explanation).length;
  if (draft.explanation.trim() && count === 0) {
    findings.push({
      rule: "no-bolding",
      severity: "warn",
      detail: "Explanation has no bolded buzzword or mechanism phrase.",
    });
  }
  if (count > 5) {
    findings.push({
      rule: "over-bolding",
      severity: "warn",
      detail: `${count} bolded items in the explanation; the cap is 5.`,
    });
  }
  for (const [letter, text] of Object.entries(draft.distractorExplanations)) {
    if (boldSpans(text ?? "").length > 0) {
      findings.push({
        rule: "bolded-distractor",
        severity: "warn",
        detail: `Distractor ${letter} explanation contains bolding; distractor prose is never bolded.`,
      });
    }
  }
}

/**
 * The vignette must not ask the question — that is the lead-in's job.
 *
 * Measured, not theoretical: the first real batch had this in five items out of
 * five, each ending its stem with a question and then repeating a reworded
 * version in leadIn. The reader sees the question twice, in two different
 * phrasings, which is both sloppy and a genuine source of ambiguity when the
 * two wordings do not ask quite the same thing.
 */
function checkVignetteQuestion(draft: GeneratedQuestionDraft, findings: QaFinding[]): void {
  if (draft.vignette.includes("?")) {
    findings.push({
      rule: "question-in-vignette",
      severity: "warn",
      detail: "Vignette contains a question; the stem must end on a finding and ask nothing.",
    });
  }
}

function checkLeadIn(draft: GeneratedQuestionDraft, findings: QaFinding[]): void {
  if (!draft.leadIn.trim().endsWith("?")) {
    findings.push({
      rule: "lead-in-not-question",
      severity: "warn",
      detail: "Lead-in does not end in a question mark (Rule 3 wants a closed, focused question).",
    });
  }
  if (/which of the following is true/i.test(draft.leadIn)) {
    findings.push({
      rule: "open-lead-in",
      severity: "block",
      detail: '"Which of the following is true about X" is an open lead-in (Rule 3).',
    });
  }
}

/**
 * The model was told to fix an item rather than emit one it knows fails a rule,
 * so a false here means it shipped a known-flawed item — worth a reviewer's
 * attention even where the mechanical checks find nothing.
 */
function checkSelfReport(draft: GeneratedQuestionDraft, findings: QaFinding[]): void {
  const failed = Object.entries(draft.selfCheck ?? {})
    .filter(([, passed]) => passed === false)
    .map(([rule]) => rule);

  if (failed.length > 0) {
    findings.push({
      rule: "self-check-failed",
      severity: "warn",
      detail: `Model reported its own item failing: ${failed.join(", ")}.`,
    });
  }
}

/**
 * Checks one question, optionally against the answer letter the batch plan
 * assigned it. Without a plan the position check is skipped; every other check
 * is self-contained.
 */
export function checkQuestion(
  draft: GeneratedQuestionDraft,
  expectedAnswer?: OptionKey
): QaResult {
  const findings: QaFinding[] = [];

  checkKeyLength(draft, findings);
  checkBannedLanguage(draft, findings);
  checkAllOrNone(draft, findings);
  checkDistinctOptions(draft, findings);
  checkCueing(draft, findings);
  checkMetaLanguage(draft, findings);
  checkDistractorCoverage(draft, findings);
  checkBolding(draft, findings);
  checkVignetteQuestion(draft, findings);
  checkLeadIn(draft, findings);
  checkSelfReport(draft, findings);

  if (expectedAnswer && draft.correctOption !== expectedAnswer) {
    // Not a block: the item can be perfectly good, it just landed on the wrong
    // letter. What it costs is the batch's answer-position spread, which the
    // caller can restore by reordering options rather than discarding the item.
    findings.push({
      rule: "answer-position-drift",
      severity: "warn",
      detail: `Batch plan assigned option ${expectedAnswer}; the model used ${draft.correctOption}.`,
    });
  }

  return {
    index: draft.index,
    findings,
    blocked: findings.some((f) => f.severity === "block"),
  };
}

/** Jaccard overlap of two stems' distinctive vocabulary. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Above this, two items in one batch are testing the same thing. */
const DUPLICATE_OVERLAP = 0.5;

/**
 * Cross-checks a batch for near-duplicates.
 *
 * Generated batches repeat themselves — roughly twice as often as human-written
 * sets in the one head-to-head measurement available — and a student who gets
 * the same concept twice in a five-question set has had their session halved.
 * v13 guards this by telling the model what it has already covered; this is the
 * check that the instruction worked.
 */
export function checkBatch(
  drafts: GeneratedQuestionDraft[],
  expectedAnswers?: OptionKey[]
): QaResult[] {
  const results = drafts.map((d, i) => checkQuestion(d, expectedAnswers?.[i]));
  const vocab = drafts.map((d) => tokens(`${d.subtopic} ${d.vignette} ${d.leadIn}`));

  for (let i = 0; i < drafts.length; i++) {
    for (let j = i + 1; j < drafts.length; j++) {
      if (overlap(vocab[i], vocab[j]) >= DUPLICATE_OVERLAP) {
        const detail = `Questions ${drafts[i].index} and ${drafts[j].index} test substantially the same content.`;
        results[i].findings.push({ rule: "duplicate-question", severity: "warn", detail });
        results[j].findings.push({ rule: "duplicate-question", severity: "warn", detail });
      }
    }
  }

  return results;
}
