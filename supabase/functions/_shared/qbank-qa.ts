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
 * "all of the above", vague qualifier language in the options, and options that
 * are not all members of the category the lead-in asked for.
 *
 * What it deliberately does NOT check is factual accuracy, which is not
 * decidable from the text. That is the job of the independent cold-answering
 * pass in qbank-verify.ts, which answers each item blind and compares.
 *
 * A `block` finding means the item is not fit to be answered by a student and
 * must not be offered. A `warn` finding is worth surfacing to a reviewer but
 * does not stop the item.
 *
 * This module lives in _shared, not src/lib, because the edge function runs it
 * before the insert so the findings can be stored on the row. src/lib/qbank-qa
 * re-exports it so the browser and the unit tests import exactly this code —
 * one gate, one set of results, no drift between two copies.
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

type Letter = "a" | "b" | "c" | "d" | "e";

/**
 * The fields the gate reads.
 *
 * Structural rather than nominal so both shapes that reach it satisfy it: the
 * browser's `GeneratedQuestionDraft` and the edge function's `ParsedQuestion`.
 */
export interface CheckableQuestion {
  index: number;
  subtopic: string;
  vignette: string;
  leadIn: string;
  options: Record<Letter, string>;
  correctOption: Letter;
  explanation: string;
  distractorExplanations: Partial<Record<Letter, string>>;
  reviewerFlag?: string;
}

const OPTION_KEYS: Letter[] = ["a", "b", "c", "d", "e"];

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

/**
 * v13 Pitfall 7: the explanation must never expose the reasoning scaffolding.
 *
 * These are patterns rather than substrings because the substrings were wrong.
 * A bare "first step" match blocked a good sideroblastic-anaemia item for the
 * phrase "the first step of heme synthesis", and a bare "step 1" match would
 * block any explanation that mentions USMLE Step 1 by name. What the rule is
 * actually after is a numbered scaffold label — "Step 2:", "fails at step 3" —
 * so it now requires the numeral to be used as a label rather than as part of
 * an ordinary noun phrase.
 */
const META_LANGUAGE: { pattern: RegExp; label: string }[] = [
  { pattern: /\bsteps?\s*[123]\b\s*[:.\-–—]/i, label: "Step 1:" },
  { pattern: /\b(?:at|in|from|to|after|before)\s+step\s*[123]\b/i, label: "at step 2" },
  { pattern: /\bfails?\s+at\s+step\b/i, label: "fails at step" },
  { pattern: /\breasoning chain\b/i, label: "reasoning chain" },
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

function distractorKeys(correct: Letter): Letter[] {
  return OPTION_KEYS.filter((k) => k !== correct);
}

/** Punctuation and case flattened, so two options are compared on their words. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
function checkKeyLength(q: CheckableQuestion, findings: QaFinding[]): void {
  const key = q.options[q.correctOption].length;
  const others = distractorKeys(q.correctOption).map((k) => q.options[k].length);
  const longest = Math.max(...others);

  if (key > longest * LENGTH_TELL_RATIO && key - longest >= LENGTH_TELL_CHARS) {
    findings.push({
      rule: "key-longest",
      severity: "block",
      detail: `Correct option ${q.correctOption} is ${key} chars against a longest distractor of ${longest} — length gives the answer away.`,
    });
  }
}

function checkBannedLanguage(q: CheckableQuestion, findings: QaFinding[]): void {
  for (const letter of OPTION_KEYS) {
    const text = ` ${q.options[letter].toLowerCase()} `;
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

function checkAllOrNone(q: CheckableQuestion, findings: QaFinding[]): void {
  for (const letter of OPTION_KEYS) {
    const text = q.options[letter].toLowerCase();
    if (text.includes("of the above") || text === "all of these" || text === "none of these") {
      findings.push({
        rule: "all-or-none-option",
        severity: "block",
        detail: `Option ${letter} is an all/none-of-the-above option (Rule 8).`,
      });
    }
  }
}

function checkDistinctOptions(q: CheckableQuestion, findings: QaFinding[]): void {
  const seen = new Map<string, Letter>();
  for (const letter of OPTION_KEYS) {
    const normalized = normalize(q.options[letter]);
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
 * Generic head nouns that name no category. "Which mechanism explains…" is
 * asking for a mechanism, but no option will contain the word "mechanism", so
 * there is nothing to check; these are skipped before the split test runs.
 */
const UNCATEGORICAL_NOUNS = new Set([
  "mechanism", "process", "change", "finding", "statement", "option",
  "condition", "explanation", "reason", "cause", "effect", "result",
  "feature", "property", "characteristic", "best", "additional", "other",
]);

/**
 * v13 Rule 4 / NBME homogeneous options.
 *
 * The mechanical half of the rule. When the lead-in names the category it is
 * asking for — "which **cord** of the brachial plexus" — every option has to be
 * a member of that category. An option that is not cannot be the answer to the
 * question as asked, so it is eliminable without any medical reasoning, and a
 * five-option item quietly becomes a three-option one.
 *
 * The majority test is what keeps this honest, and it was arrived at the hard
 * way. An earlier version fired whenever 2 to 4 options carried the category
 * word, and on a 50-item run that blocked three perfectly good questions: a
 * lead-in asking "which cells" against five cell types where only two happened
 * to spell out the word "cells" (a macrophage is a cell without saying so), and
 * two more of the same shape on "which protein". The word is only evidence of a
 * naming convention when most of the set follows it, so the rule now needs at
 * least three options carrying it and at most two missing it.
 *
 * A warn, not a block, and deliberately so. The only true positive measured for
 * it is a brachial plexus batch that offered trunks and roots against a lead-in
 * asking for a cord; against that sits a known remaining false positive — five
 * lung development stages where one is legitimately named "Embryonic period" —
 * which no amount of word matching will get right. One confirmed catch is not
 * enough evidence to start withholding questions, and the finding is surfaced
 * for review either way.
 */
function checkOptionHomogeneity(q: CheckableQuestion, findings: QaFinding[]): void {
  const asked = /\b(?:which|what)\s+(?:of\s+the\s+following\s+)?([a-z][a-z-]{3,})\b/i.exec(q.leadIn);
  if (!asked) return;

  const noun = asked[1].toLowerCase();
  if (UNCATEGORICAL_NOUNS.has(noun)) return;

  // "cords" and "cord" are the same category; compare on the singular stem.
  const stem = noun.replace(/s$/, "");
  const pattern = new RegExp(`\\b${stem}s?\\b`, "i");
  const members = OPTION_KEYS.filter((k) => pattern.test(q.options[k]));

  if (members.length >= 3 && members.length <= 4) {
    const strangers = OPTION_KEYS.filter((k) => !members.includes(k));
    findings.push({
      rule: "mixed-option-categories",
      severity: "warn",
      detail: `The lead-in asks for a ${stem} and ${members.length} options are named as one, but ${strangers.join(" and ")} ${strangers.length === 1 ? "is not" : "are not"} — check they belong to the same category (Rule 4).`,
    });
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
function checkCueing(q: CheckableQuestion, findings: QaFinding[]): void {
  // Vignette only, deliberately. NBME's cueing flaw is stem language echoed in
  // the key; the lead-in is a different thing — Rule 3 requires it to name the
  // category being asked about, and Rule 4 requires every option to belong to
  // that category, so a lead-in asking "which transporter" will always share
  // vocabulary with a correct answer that is a transporter. Counting that as
  // cueing flags the rules working.
  const stemTokens = tokens(q.vignette);
  const keyTokens = tokens(q.options[q.correctOption]);
  const distractorTokens = new Set<string>();
  for (const letter of distractorKeys(q.correctOption)) {
    for (const t of tokens(q.options[letter])) distractorTokens.add(t);
  }

  // A word drawn from the question's own subject is not a cue. Every item on
  // aortic dissection will say "dissection" in the stem, and if it is also the
  // right answer's vocabulary that is the topic showing through, not a tell.
  const topicTokens = tokens(q.subtopic);

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

function checkMetaLanguage(q: CheckableQuestion, findings: QaFinding[]): void {
  const haystack = [q.explanation, ...Object.values(q.distractorExplanations)].join(" ");

  for (const { pattern, label } of META_LANGUAGE) {
    if (pattern.test(haystack)) {
      findings.push({
        rule: "explanation-meta-language",
        severity: "block",
        detail: `Explanation exposes reasoning scaffolding ("${label}") — it must read as medical prose.`,
      });
    }
  }
}

function checkDistractorCoverage(q: CheckableQuestion, findings: QaFinding[]): void {
  for (const letter of distractorKeys(q.correctOption)) {
    if (!q.distractorExplanations[letter]?.trim()) {
      findings.push({
        rule: "missing-distractor-explanation",
        severity: "warn",
        detail: `No explanation for distractor ${letter}.`,
      });
    }
  }

  // Blocks, not warns. An item that writes a why-it-is-wrong entry for its own
  // key is internally inconsistent, and measurement says that inconsistency is
  // load-bearing: in a 50-item run this fired on exactly one item, and that item
  // was the only one whose answer key was factually wrong — the model had
  // written a correct question, been made to move the key onto a planned letter,
  // and left behind an explanation arguing the original answer was right.
  if (q.distractorExplanations[q.correctOption]) {
    findings.push({
      rule: "distractor-explains-key",
      severity: "block",
      detail: `Option ${q.correctOption} is the correct answer but has a "why it is wrong" entry — the item contradicts its own key.`,
    });
  }
}

/**
 * v13's bolding rules. The cap exists because bolding is a skimming aid: an
 * explanation with everything bolded carries no more signal than one with
 * nothing bolded, and the contrast against unbolded distractor prose is what
 * lets a learner find the teaching content.
 */
function checkBolding(q: CheckableQuestion, findings: QaFinding[]): void {
  const count = boldSpans(q.explanation).length;
  if (q.explanation.trim() && count === 0) {
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
  for (const [letter, text] of Object.entries(q.distractorExplanations)) {
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
function checkVignetteQuestion(q: CheckableQuestion, findings: QaFinding[]): void {
  if (q.vignette.includes("?")) {
    findings.push({
      rule: "question-in-vignette",
      severity: "warn",
      detail: "Vignette contains a question; the stem must end on a finding and ask nothing.",
    });
  }
}

function checkLeadIn(q: CheckableQuestion, findings: QaFinding[]): void {
  if (!q.leadIn.trim().endsWith("?")) {
    findings.push({
      rule: "lead-in-not-question",
      severity: "warn",
      detail: "Lead-in does not end in a question mark (Rule 3 wants a closed, focused question).",
    });
  }
  if (/which of the following is true/i.test(q.leadIn)) {
    findings.push({
      rule: "open-lead-in",
      severity: "block",
      detail: '"Which of the following is true about X" is an open lead-in (Rule 3).',
    });
  }
}

/**
 * The writer's own uncertainty, surfaced.
 *
 * This replaces a check on the `selfCheck` booleans, which measured as pure
 * noise: across 50 items the model reported all eighteen of them true every
 * single time, including on the item whose answer key was wrong. `reviewerFlag`
 * is free text and carries real information — on that same run it was the one
 * signal that named the broken item correctly.
 *
 * A warn, not a block, because the prompt deliberately encourages low-stakes
 * honesty here ("buzzword from memory, unconfirmed"). Blocking would teach the
 * model to stop flagging, which costs more than it saves.
 */
function checkReviewerFlag(q: CheckableQuestion, findings: QaFinding[]): void {
  const flag = (q.reviewerFlag ?? "").trim();
  if (!flag || /^none\.?$/i.test(flag)) return;

  findings.push({
    rule: "writer-flagged",
    severity: "warn",
    detail: `The writer flagged this item: ${flag}`,
  });
}

/** Checks one question against every self-contained rule. */
export function checkQuestion(question: CheckableQuestion): QaResult {
  const findings: QaFinding[] = [];

  checkKeyLength(question, findings);
  checkBannedLanguage(question, findings);
  checkAllOrNone(question, findings);
  checkDistinctOptions(question, findings);
  checkOptionHomogeneity(question, findings);
  checkCueing(question, findings);
  checkMetaLanguage(question, findings);
  checkDistractorCoverage(question, findings);
  checkBolding(question, findings);
  checkVignetteQuestion(question, findings);
  checkLeadIn(question, findings);
  checkReviewerFlag(question, findings);

  return {
    index: question.index,
    findings,
    blocked: findings.some((f) => f.severity === "block"),
  };
}

/** Jaccard overlap of two token sets. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Above this, two items in one batch are testing the same content. */
const DUPLICATE_OVERLAP = 0.5;

/** Above this, two items are drawing their options from one pool. */
const OPTION_POOL_OVERLAP = 0.4;

/** Lead-ins sharing this many opening content words are asking the same thing. */
const LEAD_IN_PREFIX_WORDS = 4;

/**
 * Interrogative scaffolding. Every lead-in is built from these, so they say
 * nothing about what is being asked and are dropped before the comparison.
 *
 * Without them the check compared raw opening words and matched four items in
 * one batch on "which of the following best", which is how most lead-ins open
 * and told nobody anything.
 */
const LEAD_IN_FILLER = new Set([
  "which", "what", "of", "the", "following", "is", "are", "was", "were", "be",
  "best", "most", "likely", "this", "that", "these", "those", "in", "on", "at",
  "a", "an", "and", "or", "to", "for", "from", "by", "with", "does", "do",
  "patient", "patients", "his", "her", "their", "its",
]);

/** The opening content words of a lead-in, as one comparable key. */
function leadInPrefix(leadIn: string): string {
  const words = leadIn
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !LEAD_IN_FILLER.has(w));

  return words.length >= LEAD_IN_PREFIX_WORDS
    ? words.slice(0, LEAD_IN_PREFIX_WORDS).join(" ")
    : "";
}

/**
 * Cross-checks a batch for near-duplicates.
 *
 * Generated batches repeat themselves — roughly twice as often as human-written
 * sets in the one head-to-head measurement available — and a student who gets
 * the same concept twice in a five-question set has had their session halved.
 *
 * Three different repetitions, because they fail independently:
 *
 *  - `duplicate-question` — the stems share their distinctive vocabulary.
 *  - `repeated-lead-in` — the stems differ but the *task* is identical. This is
 *    the one that matters most in practice. A measured brachial plexus batch
 *    asked "which cord of the brachial plexus…" in three items out of five, and
 *    the vocabulary check saw nothing, because the subtopics genuinely differed
 *    (Erb palsy, Klumpke palsy, posterior cord lesion).
 *  - `shared-option-pool` — the same five answers recycled across items, which
 *    lets a student answer later items by elimination against earlier ones.
 */
export function checkBatch(questions: CheckableQuestion[]): QaResult[] {
  const results = questions.map((q) => checkQuestion(q));
  const vocab = questions.map((q) => tokens(`${q.subtopic} ${q.vignette} ${q.leadIn}`));
  const optionSets = questions.map((q) => new Set(OPTION_KEYS.map((k) => normalize(q.options[k]))));
  const prefixes = questions.map((q) => leadInPrefix(q.leadIn));

  const pairFinding = (i: number, j: number, rule: string, detail: string) => {
    results[i].findings.push({ rule, severity: "warn", detail });
    results[j].findings.push({ rule, severity: "warn", detail });
  };

  for (let i = 0; i < questions.length; i++) {
    for (let j = i + 1; j < questions.length; j++) {
      const a = questions[i].index;
      const b = questions[j].index;

      if (overlap(vocab[i], vocab[j]) >= DUPLICATE_OVERLAP) {
        pairFinding(i, j, "duplicate-question",
          `Questions ${a} and ${b} test substantially the same content.`);
      }

      if (prefixes[i] && prefixes[i] === prefixes[j]) {
        pairFinding(i, j, "repeated-lead-in",
          `Questions ${a} and ${b} both ask "${prefixes[i]}…" — the same task twice.`);
      }

      if (overlap(optionSets[i], optionSets[j]) >= OPTION_POOL_OVERLAP) {
        pairFinding(i, j, "shared-option-pool",
          `Questions ${a} and ${b} draw their options from the same pool, so each can be answered by elimination against the other.`);
      }
    }
  }

  return results;
}
