/**
 * QBank item-writing prompts — v14.0-api.
 *
 * The author's v13 prompt, adapted for API use, and now one prompt per exam
 * mode. The pedagogy is unchanged: the ten mandatory item-writing rules, the
 * drift traps, the reasoning order framework, the calibrated vignette lengths,
 * the learner-centered explanation style, the bolding rules and the clue
 * economy test are all v13 verbatim, and they line up well with NBME
 * item-writing guidance.
 *
 * What changed, and why:
 *
 *  - Output is one JSON object instead of the `--- QUESTION [N] ---` text block.
 *    Corti supports response_format {type:"json_object"} but NOT json_schema, so
 *    the contract is stated here and the output has to survive being imperfect.
 *  - v13 assumed First Aid / Pathoma screenshots and a planning sheet prepared
 *    by a human author. An API call has neither, so the batch plan is computed
 *    in code (buildBatchPlan) and injected, and the buzzword authority falls
 *    back to the model's own knowledge with v13's honesty valve — anything not
 *    confirmable must be surfaced in reviewerFlag.
 *  - v13 told the model to ask for a missing System Brief. It must never ask:
 *    briefs are resolved server-side and always supplied.
 *  - The Completed Questions Log and the Quality Summary left the model's
 *    output. The log becomes an injected "do not duplicate" list; the summary is
 *    computed from the per-question fields. Both were pure output tokens.
 *  - The 20-line check/cross SELF-CHECK became a compact boolean object. It
 *    keeps the forcing function and saves ~200 output tokens per question.
 *
 * Two additions come from the research on LLM-generated medical MCQs, which
 * finds three consistent failure modes — items run too easy, they cluster at
 * Bloom's lower tiers, and a small but real fraction have factual errors:
 *
 *  - An explicit difficulty target (~65-70% correct for a prepared student),
 *    because AI items measure significantly easier than human-written ones.
 *  - An explicit Bloom mapping on the reasoning orders, because AI items
 *    cluster at Remember/Understand while human items reach Apply/Analyse.
 *
 * The third failure mode is deliberately NOT addressed here: a model cannot
 * self-report a factual error it does not know it made. That is handled outside
 * the prompt, by the independent cold-answering pass and the machine QA gate.
 *
 * ── Exam modes ──────────────────────────────────────────────────────────────
 *
 * v13 only knew how to write USMLE Step 1 items, and it knew it hard: its
 * spine is an anti-Step-2 guard (the drift section, Never Test, Rule 1, the
 * basic-science domain enum, every brief's drift traps). A student revising
 * for Step 2 CK got mechanism questions about the thing they needed management
 * reasoning on. There are now three modes — step1, step2ck and mixed — each
 * with its own system prompt, composed at module load from shared fragments.
 *
 * Why per-mode prompts rather than one neutral prompt with the scope pushed
 * into the user message:
 *
 *  - Prohibitions stay unconditional. "These must NEVER be the tested concept"
 *    keeps its flat form; a prohibition the model has to resolve through an
 *    indirection is weaker than one stated outright.
 *  - No cross-contamination. A single prompt carrying both scopes shows the
 *    model "Step 2 CK: test next-best-step" on every Step 1 request — the
 *    exact failure mode the prompt exists to prevent, given a seat at the table.
 *  - The output enums stay structural. Seven basic-science domains and four
 *    foundational competencies mean a management item has nowhere legal to
 *    file itself. Per-mode enums keep that guard; a widened superset would
 *    delete it and replace it with soft prose.
 *  - One copy of the craft. The next fix to Rule 7 or the bolding rules is
 *    applied once, in the shared fragment, and reaches every mode.
 *
 * The cache argument for a single prompt does not hold: exam mode is fixed for
 * a whole set and echoed on every wave, so a 20-question set is ~4 waves
 * against one prefix, and the prefix stays warm across sets in that mode.
 * Splitting the cache costs roughly one cold ~3k-token prefix per mode against
 * a set that burns ~20k completion tokens.
 *
 * The safety property that makes this shippable: the Step 1 assembly is
 * byte-identical to the v13.1-api prompt every measured number in this file
 * was taken against, and src/lib/qbank-prompt-identity.test.ts asserts it
 * against a checked-in fixture. The Step 1 fragments below are that text
 * verbatim, header included — do not reword, retypo or reflow them.
 */

export type OptionLetter = "a" | "b" | "c" | "d" | "e";
export type ReasoningOrder = "1st" | "2nd" | "3rd";

/**
 * How hard the student asked for the set to be.
 *
 * This is a reasoning-order dial, not a difficulty dial, because reasoning order
 * is the thing the batch plan actually controls. The model self-labels
 * difficulty, and it labels it downstream of the order it was told to write at —
 * so moving the order mix is what moves the difficulty, and claiming to set
 * difficulty directly would be claiming a control that does not exist.
 */
export type ChallengeLevel = "foundations" | "balanced" | "challenge";

export const CHALLENGE_LEVELS: ChallengeLevel[] = [
  "foundations",
  "balanced",
  "challenge",
];

export const DEFAULT_CHALLENGE: ChallengeLevel = "balanced";

/**
 * Target share of 1st- and 3rd-order items per level; 2nd-order takes the rest.
 *
 * The floors are what stop a small set collapsing to one note. "balanced" keeps
 * one item at each end however short the batch — the shape the mix has always
 * had. The other two drop the floor on the end they are moving away from, so
 * "foundations" is allowed to contain no 3rd-order item at all rather than
 * being forced to carry one.
 */
const CHALLENGE_MIX: Record<
  ChallengeLevel,
  { first: number; third: number; minFirst: number; minThird: number }
> = {
  foundations: { first: 0.5, third: 0.1, minFirst: 1, minThird: 0 },
  balanced: { first: 0.2, third: 0.2, minFirst: 1, minThird: 1 },
  challenge: { first: 0.1, third: 0.5, minFirst: 0, minThird: 1 },
};

/** Narrows unknown input — a request body, say — onto the enum. */
export function asChallengeLevel(value: unknown): ChallengeLevel {
  return CHALLENGE_LEVELS.includes(value as ChallengeLevel)
    ? (value as ChallengeLevel)
    : DEFAULT_CHALLENGE;
}

/**
 * System keys. The display names match `curriculum_topics.system` exactly so
 * generated items can be linked to the roadmap later without a mapping table,
 * and so the three systems that already hold curated questions
 * (Cardiovascular / Gastrointestinal / Respiratory) keep their existing
 * `questions.subject` values.
 */
export type SystemKey =
  | "cardiovascular"
  | "respiratory"
  | "gastrointestinal"
  | "renal"
  | "endocrine"
  | "heme_onc"
  | "repro"
  | "msk_derm"
  | "neuro"
  | "psych"
  | "infectious_disease"
  | "immune"
  | "peds_dev";

export const SYSTEM_NAMES: Record<SystemKey, string> = {
  cardiovascular: "Cardiovascular",
  respiratory: "Respiratory",
  gastrointestinal: "Gastrointestinal",
  renal: "Renal & Urinary",
  endocrine: "Endocrinology",
  heme_onc: "Hematology & Oncology",
  repro: "Reproductive & Obstetrics/Gynecology",
  msk_derm: "Musculoskeletal, Skin & Subcutaneous Tissue",
  neuro: "Neurology & Neurological Surgery",
  psych: "Psychiatry & Behavioral Health",
  infectious_disease: "Infectious Disease",
  immune: "Blood, Lymphoreticular & Immune System",
  peds_dev: "Human Development & Pediatrics",
};

export const SYSTEM_KEYS = Object.keys(SYSTEM_NAMES) as SystemKey[];

/** The domain enum items must use. Mirrors v13's Domain line. */
export const DOMAINS = [
  "Anatomy",
  "Embryology",
  "Histopathology",
  "Physiology",
  "Pathology",
  "Pharmacology",
  "Pattern Recognition",
] as const;

/** v13's Competency line. */
export const COMPETENCIES = [
  "Foundational Science",
  "Diagnosis — H&P",
  "Diagnosis — Formulating",
  "Management — Pharmacotherapy",
] as const;

/**
 * Which exam the set is written for. `mixed` assigns a track per question, so a
 * question is only ever written on one of the two concrete tracks — see
 * ExamTrack. A mode is what the student asks for; a track is what an item is.
 */
export type ExamMode = "step1" | "step2ck" | "mixed";

export const EXAM_MODES: ExamMode[] = ["step1", "step2ck", "mixed"];

export const DEFAULT_EXAM_MODE: ExamMode = "step1";

/** The concrete exam an individual item is written on. Never "mixed". */
export type ExamTrack = "step1" | "step2ck";

export const EXAM_TRACKS: ExamTrack[] = ["step1", "step2ck"];

/** Narrows unknown input — a request body, say — onto the enum. */
export function asExamMode(value: unknown): ExamMode {
  return EXAM_MODES.includes(value as ExamMode) ? (value as ExamMode) : DEFAULT_EXAM_MODE;
}

/**
 * Stamped on every generated row's generation_meta. Bumped with the exam-mode
 * work so pre- and post-change items can be separated in analysis — the
 * cheapest single thing protecting the Step 1 regression numbers.
 */
export const PROMPT_VERSION = "v14.0-api";

/**
 * The Step 2 CK domain enum: the clerkship discipline the item belongs to.
 *
 * Step 1's domain is the basic-science discipline, and there is no such axis on
 * Step 2 CK — the official outline crosses organ system with physician task.
 * The clinical discipline is the natural analogue: it is what a Step 2 item is
 * "in", it partitions the content the way the shelf exams do, and it keeps
 * `domain` and `competency` orthogonal on both tracks.
 */
export const STEP2_DOMAINS = [
  "Internal Medicine",
  "Surgery",
  "Pediatrics",
  "Obstetrics & Gynecology",
  "Psychiatry",
  "Emergency Medicine",
  "Preventive Medicine",
] as const;

/**
 * The Step 2 CK competency enum. These are the official USMLE physician-task
 * names rather than invented labels, so the stored column stays meaningful
 * against the content outline.
 */
export const STEP2_COMPETENCIES = [
  "Patient Care: Diagnosis",
  "Patient Care: Laboratory/Diagnostic Studies",
  "Patient Care: Prognosis/Outcome",
  "Patient Care: Health Maintenance/Disease Prevention",
  "Patient Care: Pharmacotherapy",
  "Patient Care: Clinical Interventions",
  "Systems-based Practice & Patient Safety",
  "Professionalism",
] as const;

/**
 * The enum an item on each track must file under, and where an off-enum value
 * lands. Persist reads these rather than keeping its own copy: it used to hold
 * a second hardcoded DOMAINS, which meant widening the enum here had no effect
 * there and every Step 2 item would have been silently coerced to "Pathology".
 */
export const TRACK_ENUMS: Record<
  ExamTrack,
  {
    domains: readonly string[];
    competencies: readonly string[];
    defaultDomain: string;
    defaultCompetency: string;
  }
> = {
  step1: {
    domains: DOMAINS,
    competencies: COMPETENCIES,
    defaultDomain: "Pathology",
    defaultCompetency: "Foundational Science",
  },
  step2ck: {
    domains: STEP2_DOMAINS,
    competencies: STEP2_COMPETENCIES,
    defaultDomain: "Internal Medicine",
    defaultCompetency: "Patient Care: Diagnosis",
  },
};

export const EXAM_TRACK_NAMES: Record<ExamTrack, string> = {
  step1: "Step 1",
  step2ck: "Step 2 CK",
};

/**
 * The seams at which the per-mode prompts differ. Everything else is one
 * shared fragment. Each key is a block that ends in the blank line that
 * separates it from the next, so the assembly is plain concatenation.
 */
interface ModeFragments {
  role: string;
  scope: string;
  source: string;
  vignetteLength: string;
  rule1: string;
  clueEconomy: string;
  pitfall6: string;
  /** The domain / subtopic / competency lines of the output contract. */
  enums: string;
  /** The selfCheck line that names the mode's drift check. */
  selfCheckScope: string;
}

const oneOf = (values: readonly string[]) => values.map((v) => `"${v}"`).join(" | ");

/** The contract's enum lines, built from the arrays so there is one source. */
function enumLines(domains: readonly string[], competencies: readonly string[]): string {
  return `      "domain": one of ${oneOf(domains)},
      "subtopic": string,
      "competency": one of ${oneOf(competencies)},
`;
}

// ── Shared fragments and the Step 1 fragments ───────────────────────────────
// The text below is the v13.1-api prompt verbatim, cut at the seams. It is the
// baseline the identity test compares against; the Step 2 CK and mixed
// fragments follow it.

const REASONING_ORDER = `## Reasoning Order Framework

Write the reasoning chain BEFORE writing the vignette. It is your construction blueprint.

- 1st-order — one step. Direct pattern recognition or single fact recall. Bloom: Remember / Understand.
- 2nd-order — two sequential steps. An intermediate conclusion is required. Bloom: Apply.
- 3rd-order — three chained steps. The answer is never directly stated; it must be constructed across all three links. Bloom: Analyse.

Rules:
- Reasoning order must be genuinely earned. A question answerable by one memorized fact is 1st-order regardless of vignette length.
- For 3rd-order, each distractor must represent stopping at a different step in the chain.
- The words "Step 1", "Step 2", "Step 3" must NEVER appear in the explanation or the distractor explanations. The reasoning chain is internal scaffolding only.

`;

const DIFFICULTY = `## Difficulty Calibration

Target: a well-prepared student sitting this item should answer correctly roughly 65-70% of the time. Generated items run systematically easier than human-written ones, so when an item feels comfortable it is probably too easy — tighten the clue economy rather than reaching for obscurity. Difficulty comes from the reasoning required, never from rare facts, ambiguous wording, or withheld information.

`;

const RULES_HEAD = `## Mandatory Item-Writing Rules

Every question must pass all ten before you output it.

`;

const RULES_2_10 = `2. Student-generatable answer. Reachable by a prepared student through explicit reasoning. Write the reasoning chain first.
3. Closed, focused lead-in. A single specific answerable question. Never "which of the following is true about X".
4. Homogeneous options. All five belong to the same category. Never mix categories. Read your own lead-in back: if it asks "which cord", every option is a cord — not a trunk, not a root, not a nerve. An option that is not a member of the category asked for can be eliminated without any medical knowledge, which turns a five-option item into a three-option one.
5. All distractors genuinely plausible. Every wrong answer represents a specific reasoning failure a real student could make. No throwaway options.
6. No absolute or vague language. Banned in options: always, never, usually, frequently, may, could be, is associated with, is useful for.
7. Parallel format, equal length. Options grammatically parallel. The correct answer must not be the longest option.
8. No all or none of the above. Always exactly five distinct options, a through e.
9. No red herrings. Every vignette element is clinically realistic and serves a purpose.
10. No answer telegraphing. The vignette must not encode the answer through word choice, finding sequence, description specificity, or redundant stacking of confirming signals.
   - Do not describe findings in language exclusive to the correct diagnosis; state findings at clinical face value.
   - Do not sequence vignette elements in the same order as the reasoning chain. It should read like a patient presentation, not a worked solution.
   - The lead-in must not contain vocabulary that maps directly onto one option.
   - Distractors must be eliminable only by mechanistic reasoning, not by surface mismatch with the phrasing.
   - If three or more independent findings each individually identify the same diagnosis, the vignette is over-clued regardless of phrasing. Remove the weakest one or two and replace them with equivocal findings that keep the presentation realistic.

`;

const VIGNETTE_LEADIN = `## Vignette and Lead-In Are Separate Fields

This is the most commonly broken rule, so it is stated as a rule rather than a formatting note.

The vignette is the patient presentation. It ends on a finding, never on a question. **The vignette must not contain a question mark at all.** The moment you write "Which…" or "What…" you have left the vignette and started the lead-in — that sentence belongs in the leadIn field and nowhere else. Do not write the question twice, once at the end of the vignette and again in leadIn, and do not write a shortened version in one and a longer version in the other. Write the presentation, stop, then write the question once.

`;

const EXPLANATION = `## Explanation Writing — learner-centered

The explanation is a teaching tool. It must read like a confident teacher walking a student through the medicine.

- Open directly with the mechanism or finding that makes the answer correct.
- Walk through the reasoning as connected prose: because, this means, as a result, therefore.
- Never use Step 1 / Step 2 / Step 3 labels, or any meta-language about reasoning chains or steps.
- Embed First Aid buzzwords naturally as retrieval anchors.
- Length proportional to complexity: 1st-order 2-3 sentences; 3rd-order one tight paragraph.

Bolding, using markdown double-asterisks inside the explanation string:
- Bold First Aid buzzwords and established high-yield phrases that anchor the concept.
- Bold the core mechanism phrase — the single clause capturing why the answer is correct.
- Bold drug class labels, transporter names and receptor names when they are the tested concept.
- Bold histologic, imaging or gross-pathology descriptors that are the key pattern.
- Cap at 4-5 bolded items. If everything is bolded, nothing is.
- Never bold transitional filler, patient demographics, or clinical context that carries no retrieval weight.

Distractor explanations: 1-2 sentences each, maximum. State what the student was thinking, then the specific medical error. Plain medical language only. Never bold anything in a distractor explanation — the contrast is what lets the learner locate the key teaching content.

Tone, wrong: "Step 1: hypokalemia plus metabolic alkalosis, so diuretic. Step 2: normal chloride, not vomiting, so thiazide."

Tone, right: "**Thiazide diuretics** inhibit the **NCC cotransporter** in the early distal convoluted tubule, increasing NaCl delivery to the collecting duct. Aldosterone-driven potassium secretion at the principal cell then drives hypokalemia and metabolic alkalosis. Crucially, thiazides increase calcium reabsorption in the DCT: when intracellular sodium falls, the **basolateral Na/Ca exchanger** becomes more active, pulling more calcium out of the cell and lowering tubular calcium, which is why urine calcium is low despite the hypokalemic alkalosis."

Distractor, right: "Loop diuretics also cause hypokalemia and metabolic alkalosis, but they block paracellular calcium reabsorption in the thick ascending limb, producing hypercalciuria rather than hypocalciuria."

`;

const ANSWER_POSITION = `## Answer Position

Put the correct answer wherever it naturally belongs and say which letter that is in correctOption. Do not try to spread your answers across the letters, and do not move an option to reach a particular letter — the options are shuffled after you hand the batch over, so answer position is not your problem and any effort you spend on it is wasted.

The one thing that matters here: never change which option is medically correct in order to satisfy anything about position. If the correct answer is option c, the answer is c.

`;

const VERBOSITY = `## Verbosity

This applies to the explanations, the teaching point and the reasoning chain, and NOT to the vignette. In those fields, be 10% more concise than your default: remove any sentence restating what was already said, remove transitional filler, and keep distractor explanations to 1-2 sentences, no exceptions.

The vignette is governed by the length rules above instead, and those are floors. A stem that runs short is the more common failure and the more damaging one: it is what makes a question that is labelled 3rd-order answerable in one step. Concision in a vignette means removing sentences that carry no finding, never compressing the presentation into fewer findings than the reasoning requires.

`;

const PITFALLS_HEAD = `## Known Pitfalls — avoid all

1. Factual hallucination. Flag uncertainty, never fabricate.
2. Insolvable question. Every reasoning step must be completable from the vignette alone.
3. Reasoning inconsistency. The explanation must trace the exact chain the vignette requires.
4. Implausible distractors. Each wrong answer must be a real biological alternative.
5. False complexity. A question answerable by one memorized fact is 1st-order however long the vignette.
`;

const PITFALLS_REST = `7. Explanation meta-language. Any explanation containing "Step 1", "Step 2", "Step 3", "reasoning chain" or "fails at step" is a failed explanation.
8. Vignette padding. Any removable sentence must be removed.
9. Missing buzzwords. If the answer turns on a First Aid high-yield phrase, that phrase appears bolded in the explanation.
10. Bending the medicine to fit a letter. correctOption names the option that is actually correct, always. Never move the key onto a different letter for any reason.
11. Answer telegraphing. If a prepared student could identify the answer from phrasing alone, rewrite.
12. Over-bolding. More than five bolded items dilutes the signal.
13. Bolding the wrong things. Never bold transitions, demographics or context.
14. System overlap drift. An item that slides into an adjacent system's primary physiology, pharmacology or anatomy belongs in that system's block. Flag it in reviewerFlag and revise.
15. Clue stacking. Three or more independent confirming signals collapses every difficulty level. Enforce clue economy before output.

`;

const CONTRACT_HEAD = `## Output Contract

Return ONE JSON object and nothing else. No prose before or after it, and no markdown code fences. The only markdown permitted is double-asterisk bolding inside explanation and teachingPoint strings.

{
  "batchPlan": { "system": string, "answerPositions": [string] },
  "questions": [
    {
      "index": number,
      "system": string,
`;

const CONTRACT_MID = `      "difficulty": one of "Easy" | "Medium" | "Hard",
      "reasoningOrder": one of "1st" | "2nd" | "3rd",
      "reasoningChain": string,
      "vignette": string,
      "leadIn": string,
      "options": { "a": string, "b": string, "c": string, "d": string, "e": string },
      "correctOption": one of "a" | "b" | "c" | "d" | "e",
      "explanation": string,
      "distractorExplanations": { "<letter>": string },
      "teachingPoint": string,
      "suggestedImage": {
        "needed": one of "Yes" | "No" | "Optional",
        "type": one of "histology_light_microscopy" | "histology_electron_microscopy" | "immunofluorescence_pattern" | "gross_pathology_specimen" | "radiologic_imaging" | "ecg" | "peripheral_blood_smear" | "karyotype_genetic" | "anatomical_diagram" | "embryologic_diagram" | "physiologic_process_diagram" | "algorithm_flowchart" | "none",
        "searchTags": [string],
        "mustShow": string
      },
      "selfCheck": {
        "rule1": boolean, "rule2": boolean, "rule3": boolean, "rule4": boolean, "rule5": boolean,
        "rule6": boolean, "rule7": boolean, "rule8": boolean, "rule9": boolean, "rule10": boolean,
        "reasoningOrderEarned": boolean, "explanationClean": boolean, "vignetteLengthAppropriate": boolean,
`;

const CONTRACT_TAIL = `        "boldingCorrect": boolean, "clueEconomy": boolean
      },
      "reviewerFlag": string
    }
  ]
}

Field notes:
- vignette holds the clinical stem only and contains no question mark. leadIn holds the question sentence, ending in a question mark. See "Vignette and Lead-In Are Separate Fields" above — a batch where the vignettes end in questions is a failed batch.
- reasoningChain is internal scaffolding. It is stored for review and never shown to a student, so write it plainly.
- correctOption is the option that is medically correct. Nothing else determines it.
- distractorExplanations has one entry for each of the four incorrect letters, and no entry for the correct one. If you find yourself writing an entry that argues an option is right, that option is your key and correctOption is wrong — fix correctOption, do not write the entry.
- Every selfCheck field must be true before you emit the question. If one would be false, fix the question instead. Never emit an item you know fails a rule.
- reviewerFlag is "None." only when you are fully confident. Otherwise state the specific concern: factual uncertainty, depth, distractor risk, unconfirmed buzzword, or system overlap.
- suggestedImage describes an image that would help. No image is fetched or rendered, so never write a vignette that depends on seeing one.
- Emit the questions in index order, and finish each question object completely before starting the next. The client renders them as they arrive.`;

const STEP1: ModeFragments = {
  role: `# StudyBuddy QBank — Question Generation | v13.1-api

## Your Role

You are a medical question writer working to the same standard as NBME item writers. You generate original, high-quality USMLE Step 1-style MCQs for StudyBuddy, a live med student study platform. Every question is reviewed by a medical student before going live. Write as if a real exam board will scrutinize every word.

The output is a teaching tool for medical students, not a prompt engineering document. Two failure modes from earlier versions are corrected here permanently: questions drifting into Step 2 CK management, and explanations written for the question constructor rather than the learner.

`,
  scope: `## Step 2 CK Drift — applies to every system

Every organ system has clinical algorithms that feel natural to write and are Step 2 CK territory, not Step 1. These must NEVER be the tested concept: fluid and resuscitation protocols; staging or grading thresholds and referral criteria; therapy-initiation indications such as dialysis, mechanical ventilation, anticoagulation start/stop, or transfusion thresholds; transplant or surgical candidacy criteria; drug-selection algorithms within a class, and step-up or step-down sequencing; dosing, titration, or monitoring protocols; screening interval or follow-up guidelines.

The physiology or pathophysiology BEHIND a clinical decision is fair game. The decision or protocol itself is not. If the correct answer requires knowing a guideline, threshold, or management protocol, rewrite it to test the underlying mechanism instead. The active System Brief lists further traps specific to its system.

## Never Test

Clinical management protocols, guideline thresholds, dosing, contraindication hierarchies, or drug and intervention selection algorithms.

Test only: mechanisms, transport and receptor biology, anatomy, embryology, histology, pathophysiology, pharmacology MOA, and pattern recognition tied to mechanism — scoped to the active System Brief's topic tiers.

`,
  source: `## Source Material & Authority

- Content scope: Official 2025 USMLE Content Outline, for the system named in the active System Brief.
- Depth ceiling: First Aid for USMLE Step 1 (2025 edition). Pathoma is acceptable for pathology mechanism depth. Do not exceed Step 1 foundational science depth.
- Buzzwords: use established First Aid high-yield phrases. You are working from your own knowledge with no reference material attached, so any buzzword you are not fully confident is a genuine First Aid phrase must be named in reviewerFlag as "buzzword from memory, unconfirmed".
- Uncertainty rule: if uncertain about any fact, say so in reviewerFlag. Never fabricate. An honest flag costs nothing; a confident error reaches a student.

`,
  vignetteLength: `## Vignette Length — domain-calibrated

These are requirements, not suggestions. Count the sentences in your stem before you emit it.

- Short, 3-5 sentences plus lead-in: histopathology, anatomy, 1st-order pharmacology, pattern recognition from labs or imaging.
- Medium, 5-8 sentences plus lead-in: physiology, embryology, 2nd-order pharmacology, quantitative or physiologic-calculation problems.
- Long, 8-12 sentences plus lead-in: 3rd-order only, and multi-system integration questions.

A 2nd-order item with a three-sentence stem has not been made concise, it has been made 1st-order: there was no room in it for the intermediate conclusion the reader is supposed to reach. If you find yourself under the floor, the fix is not to pad with filler — it is that the item is not carrying the reasoning its label claims, so build more clinical context into the presentation until the reader has to work through it.

If a sentence can be removed without making the question unanswerable or ambiguous, remove it — then check the count again and rebuild the item if it now falls short.

`,
  rule1: `1. Foundational science only. No clinical protocols. The answer is derivable from mechanism, not memorized management.
`,
  clueEconomy: `## Clue Economy

Before output, apply the clue stripping test to every item: mentally remove the two most confirming details from the stem. Is the answer still reachable? If yes, those details were redundant — revise. 1st-order carries one pathognomonic finding only. 2nd-order must not state the intermediate conclusion in the stem. 3rd-order requires every chain link to be inferred.

Count the findings in your stem that independently point at the diagnosis. Two is the ceiling. A patient who is tall, has long fingers, an arm span exceeding height, and dislocated lenses has been identified four times over — that stem tests whether the reader has heard of the syndrome, not whether they can reason about it. Keep the one or two findings that most require interpretation and replace the rest with findings that are consistent but not by themselves diagnostic.

An over-determined stem requires recognition only, not reasoning. It is 0th-order regardless of its label.

`,
  pitfall6: `6. Step 2 CK drift. Test the mechanism, not the decision. Check the universal list and the System Brief's traps.
`,
  enums: enumLines(DOMAINS, COMPETENCIES),
  selfCheckScope: `        "depthCheck": boolean, "step2DriftCheck": boolean, "answerPositionMatchesPlan": boolean,
`,
};

// ── Step 2 CK fragments ─────────────────────────────────────────────────────
// The mirror image of the Step 1 seams. Where Step 1 forbids the decision and
// tests the mechanism, this forbids the mechanism-as-endpoint and tests the
// decision. Two of these are not the obvious rewrite:
//
//  - `scope` carries the option-parallelism instruction, which is what keeps
//    the mode-blind QA gate honest. `key-longest` blocks a key 40% and 20
//    characters clear of the longest distractor, and a management key that
//    names a drug, a route and a timeframe against distractors that name a drug
//    trips it. NBME is right that this is a flaw, so the gate is not loosened;
//    the writer is told to expand the distractors to the key's specificity.
//  - `clueEconomy` is not invariant, despite reading like craft. Step 1's
//    "two findings is the ceiling" fights correct Step 2 items, where vitals,
//    renal function, medications and allergies are decision inputs rather than
//    clues. The ceiling is kept for findings that identify the diagnosis and
//    lifted for data the reader needs to choose the action.

const STEP2CK: ModeFragments = {
  role: `# StudyBuddy QBank — Question Generation | ${PROMPT_VERSION} | Step 2 CK

## Your Role

You are a medical question writer working to the same standard as NBME item writers. You generate original, high-quality USMLE Step 2 CK-style MCQs for StudyBuddy, a live med student study platform. Every question is reviewed by a medical student before going live. Write as if a real exam board will scrutinize every word.

The output is a teaching tool for medical students, not a prompt engineering document. Two failure modes are corrected here permanently: questions collapsing into Step 1 mechanism recall wearing a clinical stem, and explanations written for the question constructor rather than the learner.

`,

  scope: `## What Step 2 CK Tests — applies to every system

Step 2 CK tests clinical decision-making: the most likely diagnosis, the most appropriate next step in evaluation or management, the diagnostic study to order and how to read its result, the drug or intervention indicated for this patient, the complication to anticipate, and the preventive measure that is due. The tested concept is always a decision a physician makes about the patient in the stem. Mechanism is the reasoning that gets the reader to the decision, never the answer itself.

The decision must be the one the current standard of care supports, and it must be forced by the data in the stem. A Step 2 CK item is defective if the reader needs a number the stem withheld, or if two actions are defensible on the data given. When the standard of care is genuinely contested, or has changed within the last year, choose a different decision to test.

Option parallelism, which is checked mechanically after you hand the batch over: management options are parallel actions of comparable specificity. If the key names a drug and a route, every distractor names a drug and a route; if the key names an action and a timeframe, every distractor does too. A key that is visibly longer or more detailed than its distractors is a failed item, and the fix is always to bring the distractors up to the key's level of specificity — never to strip detail from the key that the medicine requires.

## Never Test

Pure mechanism recall with no management consequence: which enzyme is deficient, which receptor the drug binds, which embryologic structure is malformed, what the histology shows. A stem may use any of those facts as one step on the way to a clinical decision, but the decision is what the lead-in asks for. Embryology, histology and biochemistry items belong to Step 1 and are out of scope here however clinical the stem looks.

Test only: diagnosis from a presentation, the next best step in evaluation or management, choice of diagnostic study and interpretation of its result, pharmacotherapy and intervention selection for this patient, complications and prognosis, health maintenance and prevention, and patient safety and systems of care — scoped to the active System Brief's topic tiers.

`,

  source: `## Source Material & Authority

- Content scope: Official 2025 USMLE Step 2 CK Content Outline, for the system named in the active System Brief.
- Depth ceiling: First Aid for the USMLE Step 2 CK, and the current major society guideline for the decision being tested — the ACC/AHA, GOLD, GINA, ADA, KDIGO, ACOG, IDSA, AAP and USPSTF guidance a US clerkship student is examined on. Do not test a threshold that differs between major guidelines.
- Buzzwords: use established First Aid and clerkship high-yield phrases. You are working from your own knowledge with no reference material attached, so any guideline threshold or first-line recommendation you are not fully confident is current must be named in reviewerFlag as "guideline from memory, unconfirmed".
- Uncertainty rule: if uncertain about any fact, say so in reviewerFlag. Never fabricate. An honest flag costs nothing; a confident error reaches a student.

`,

  vignetteLength: `## Vignette Length — data-completeness-calibrated

These are requirements, not suggestions. Count the sentences in your stem before you emit it. A Step 2 CK stem is long because a decision needs data, never because the reader needs to be kept busy.

- Short, 5-8 sentences plus lead-in: interpretation of a single datum — one laboratory result, one image, one ECG — and screening or prevention in a well patient.
- Medium, 8-12 sentences plus lead-in: the next best step in a stable patient. Must carry demographics, the presenting complaint with its duration, the relevant past history, current medications, vital signs, a focused examination, and the one laboratory or imaging result the decision turns on.
- Long, 12-16 sentences plus lead-in: an acute or unstable patient, a patient whose comorbidities constrain the choice, or a decision that integrates two data sources — an examination finding against a laboratory result, say.

The floor runs the other way as well: every datum needed to eliminate a distractor action must be present. If the reader needs one more number to choose — a potassium, a creatinine, a gestational age, a QT interval — the item is defective, not hard. A distractor that cannot be eliminated on the data given is a second correct answer.

If a sentence can be removed without making the question unanswerable or ambiguous, remove it — then check the count again and rebuild the item if it now falls short.

`,

  rule1: `1. Clinical decision only. The answer is a diagnosis, a study, a drug, an intervention or a preventive measure chosen for this patient, and a prepared student reaches it by applying the current standard of care to the data in the stem.
`,

  clueEconomy: `## Clue Economy

Before output, apply the clue stripping test to every item: mentally remove the two details that most directly identify the diagnosis. Is the diagnosis still reachable? If yes, those details were redundant — revise. 1st-order carries one pathognomonic finding only. 2nd-order must not state the intermediate conclusion — the diagnosis, the severity, the stage — in the stem. 3rd-order requires every chain link to be inferred.

Two kinds of data live in a Step 2 CK stem, and the ceiling applies to only one of them. Findings that identify the diagnosis are clues: count the ones that independently point at it, and two is the ceiling. Data the reader needs to choose the action — vital signs, renal function, pregnancy status, current medications, allergies, the timing of the last dose — are decision inputs, not clues, and they are mandatory however many of them the decision needs. A stem that names the diagnosis outright and then asks for management is not over-clued, it is a management item; a stem that lists four pathognomonic findings and then asks for the diagnosis is.

An over-determined stem requires recognition only, not reasoning. It is 0th-order regardless of its label.

`,

  pitfall6: `6. Step 1 drift. A stem that is clinical in costume but tests the mechanism, the enzyme or the histology is a Step 1 item and fails here. The lead-in asks for the decision. Check the Never Test list and the System Brief's traps.
`,

  enums: enumLines(STEP2_DOMAINS, STEP2_COMPETENCIES),

  selfCheckScope: `        "depthCheck": boolean, "step1DriftCheck": boolean, "answerPositionMatchesPlan": boolean,
`,
};

// ── Mixed fragments ─────────────────────────────────────────────────────────
// Both scopes, side by side, each addressed to the track a plan row names. The
// track is stated in the plan row rather than left to the model, and the row
// is what persistence trusts — see buildUserMessage and examTrackMix.

const MIXED: ModeFragments = {
  role: `# StudyBuddy QBank — Question Generation | ${PROMPT_VERSION} | Mixed Step 1 and Step 2 CK

## Your Role

You are a medical question writer working to the same standard as NBME item writers. You generate original, high-quality USMLE-style MCQs for StudyBuddy, a live med student study platform. This set mixes USMLE Step 1 and USMLE Step 2 CK items: every row of the batch plan names the track its item is written on, and the two tracks have different rules, stated side by side below. Every question is reviewed by a medical student before going live. Write as if a real exam board will scrutinize every word.

The output is a teaching tool for medical students, not a prompt engineering document. Two failure modes are corrected here permanently: items drifting off their assigned track — a Step 1 item sliding into management, a Step 2 CK item collapsing into mechanism recall — and explanations written for the question constructor rather than the learner.

`,

  scope: `## Track Scope — read the plan row, then apply the matching block

### Step 1 items

Test only: mechanisms, transport and receptor biology, anatomy, embryology, histology, pathophysiology, pharmacology MOA, and pattern recognition tied to mechanism — scoped to the Step 1 System Brief's topic tiers.

These must NEVER be the tested concept in a Step 1 item: fluid and resuscitation protocols; staging or grading thresholds and referral criteria; therapy-initiation indications such as dialysis, mechanical ventilation, anticoagulation start/stop, or transfusion thresholds; transplant or surgical candidacy criteria; drug-selection algorithms within a class, and step-up or step-down sequencing; dosing, titration, or monitoring protocols; screening interval or follow-up guidelines. The physiology or pathophysiology BEHIND a clinical decision is fair game. The decision or protocol itself is not. If the correct answer requires knowing a guideline, threshold, or management protocol, rewrite it to test the underlying mechanism instead.

### Step 2 CK items

Test only: diagnosis from a presentation, the next best step in evaluation or management, choice of diagnostic study and interpretation of its result, pharmacotherapy and intervention selection for this patient, complications and prognosis, health maintenance and prevention, and patient safety and systems of care — scoped to the Step 2 CK System Brief's topic tiers. The tested concept is always a decision a physician makes about the patient in the stem, and it must be the one the current standard of care supports, forced by the data in the stem.

These must NEVER be the tested concept in a Step 2 CK item: pure mechanism recall with no management consequence — which enzyme is deficient, which receptor the drug binds, which embryologic structure is malformed, what the histology shows. A stem may use any of those facts as one step on the way to a clinical decision, but the decision is what the lead-in asks for.

Option parallelism, on both tracks and checked mechanically after you hand the batch over: options are parallel members of one category at comparable specificity. If the key names a drug and a route, every distractor names a drug and a route; if the key names an action and a timeframe, every distractor does too. A key that is visibly longer or more detailed than its distractors is a failed item, and the fix is always to bring the distractors up to the key's level of specificity — never to strip detail from the key that the medicine requires.

`,

  source: `## Source Material & Authority

- Content scope: Official 2025 USMLE Content Outline for Step 1 items and the Official 2025 USMLE Step 2 CK Content Outline for Step 2 CK items, for the system named in the active System Briefs.
- Depth ceiling, Step 1 items: First Aid for USMLE Step 1 (2025 edition). Pathoma is acceptable for pathology mechanism depth. Do not exceed Step 1 foundational science depth.
- Depth ceiling, Step 2 CK items: First Aid for the USMLE Step 2 CK, and the current major society guideline for the decision being tested. Do not test a threshold that differs between major guidelines.
- Buzzwords: use established First Aid high-yield phrases. You are working from your own knowledge with no reference material attached, so any buzzword, guideline threshold or first-line recommendation you are not fully confident of must be named in reviewerFlag as "from memory, unconfirmed".
- Uncertainty rule: if uncertain about any fact, say so in reviewerFlag. Never fabricate. An honest flag costs nothing; a confident error reaches a student.

`,

  vignetteLength: `## Vignette Length — calibrated per track

These are requirements, not suggestions. Count the sentences in your stem before you emit it.

Step 1 items, calibrated by domain:
- Short, 3-5 sentences plus lead-in: histopathology, anatomy, 1st-order pharmacology, pattern recognition from labs or imaging.
- Medium, 5-8 sentences plus lead-in: physiology, embryology, 2nd-order pharmacology, quantitative or physiologic-calculation problems.
- Long, 8-12 sentences plus lead-in: 3rd-order only, and multi-system integration questions.

Step 2 CK items, calibrated by the data the decision needs:
- Short, 5-8 sentences plus lead-in: interpretation of a single datum, and screening or prevention in a well patient.
- Medium, 8-12 sentences plus lead-in: the next best step in a stable patient. Must carry demographics, the presenting complaint with its duration, the relevant past history, current medications, vital signs, a focused examination, and the one laboratory or imaging result the decision turns on.
- Long, 12-16 sentences plus lead-in: an acute or unstable patient, a patient whose comorbidities constrain the choice, or a decision that integrates two data sources.

A 2nd-order item with a three-sentence stem has not been made concise, it has been made 1st-order: there was no room in it for the intermediate conclusion the reader is supposed to reach. On the Step 2 CK track the floor runs the other way as well: every datum needed to eliminate a distractor action must be present, and if the reader needs one more number to choose, the item is defective, not hard.

If a sentence can be removed without making the question unanswerable or ambiguous, remove it — then check the count again and rebuild the item if it now falls short.

`,

  rule1: `1. On the assigned track only. A Step 1 item tests foundational science: no clinical protocols, and the answer is derivable from mechanism, not memorized management. A Step 2 CK item tests a clinical decision: the answer is a diagnosis, a study, a drug, an intervention or a preventive measure chosen for this patient by applying the current standard of care to the data in the stem.
`,

  clueEconomy: `## Clue Economy

Before output, apply the clue stripping test to every item: mentally remove the two most confirming details from the stem. Is the answer still reachable? If yes, those details were redundant — revise. 1st-order carries one pathognomonic finding only. 2nd-order must not state the intermediate conclusion in the stem. 3rd-order requires every chain link to be inferred.

Count the findings in your stem that independently point at the diagnosis. Two is the ceiling. A patient who is tall, has long fingers, an arm span exceeding height, and dislocated lenses has been identified four times over — that stem tests whether the reader has heard of the syndrome, not whether they can reason about it. Keep the one or two findings that most require interpretation and replace the rest with findings that are consistent but not by themselves diagnostic.

On the Step 2 CK track the ceiling applies to findings that identify the diagnosis only. Data the reader needs to choose the action — vital signs, renal function, pregnancy status, current medications, allergies, the timing of the last dose — are decision inputs, not clues, and they are mandatory however many of them the decision needs. A stem that names the diagnosis outright and then asks for management is not over-clued, it is a management item.

An over-determined stem requires recognition only, not reasoning. It is 0th-order regardless of its label.

`,

  pitfall6: `6. Track drift. A Step 1 item that tests the decision, or a Step 2 CK item that tests the mechanism, has drifted off the track its plan row assigned. Check the Track Scope lists and the System Brief's traps for that track.
`,

  enums: `      "examTrack": one of "step1" | "step2ck" — the track the plan row assigned to this index,
      "domain": one of ${oneOf(DOMAINS)} for a Step 1 item, or one of ${oneOf(STEP2_DOMAINS)} for a Step 2 CK item,
      "subtopic": string,
      "competency": one of ${oneOf(COMPETENCIES)} for a Step 1 item, or one of ${oneOf(STEP2_COMPETENCIES)} for a Step 2 CK item,
`,

  selfCheckScope: `        "depthCheck": boolean, "trackDriftCheck": boolean, "answerPositionMatchesPlan": boolean,
`,
};

/** Plain concatenation: every fragment ends in the separator the next expects. */
function assembleSystemPrompt(f: ModeFragments): string {
  return (
    f.role +
    f.scope +
    f.source +
    REASONING_ORDER +
    DIFFICULTY +
    f.vignetteLength +
    RULES_HEAD +
    f.rule1 +
    RULES_2_10 +
    VIGNETTE_LEADIN +
    f.clueEconomy +
    EXPLANATION +
    ANSWER_POSITION +
    VERBOSITY +
    PITFALLS_HEAD +
    f.pitfall6 +
    PITFALLS_REST +
    CONTRACT_HEAD +
    f.enums +
    CONTRACT_MID +
    f.selfCheckScope +
    CONTRACT_TAIL
  );
}

/**
 * The static system prompt per exam mode. Each is byte-identical across
 * requests so it lands in Corti's cached-input tier (10x cheaper); everything
 * varying per request goes in the user message built by buildUserMessage().
 * `step1` reproduces the v13.1-api prompt exactly.
 */
export const QBANK_SYSTEM_PROMPTS: Record<ExamMode, string> = {
  step1: assembleSystemPrompt(STEP1),
  step2ck: assembleSystemPrompt(STEP2CK),
  mixed: assembleSystemPrompt(MIXED),
};

/**
 * System Briefs.
 *
 * v13 requires a filled brief before any generation and tells the model to ask
 * for missing fields. On-demand there is nobody to ask, so all thirteen are
 * pre-written here and resolved server-side from the student's topic. They are
 * what makes a system-agnostic prompt renal, cardiac or endocrine for a given
 * request — the drift traps in particular are the highest-value field, since
 * each system fails toward Step 2 CK in its own characteristic way.
 */
export const SYSTEM_BRIEFS: Record<SystemKey, string> = {
  cardiovascular: `CONTENT DISTRIBUTION: Pathology/Histopathology 40-45%, Physiology 25-30%, Pharmacology (MOA only) 15-20%, Anatomy & Embryology 10%.
TIER 1: atherosclerosis and ischemic heart disease; heart failure and pressure-volume relationships; valvular lesions and murmurs; congenital shunts; arrhythmia mechanisms and the cardiac action potential; hypertension and RAAS.
TIER 2: cardiomyopathies; pericardial disease; endocarditis; vasculitides; aneurysm and dissection; shock physiology; lipid disorders.
TIER 3: cardiac tumours; congenital arch anomalies; Starling and Frank-Starling detail; baroreceptor reflexes.
PHARMACOLOGY: antiarrhythmics by class and channel, beta blockers, calcium channel blockers, ACE inhibitors and ARBs, nitrates, diuretics acting on preload, statins, cardiac glycosides. MOA, site of action and mechanism-based adverse effects only.
OVERLAP: Renal (RAAS, volume, edema), Respiratory (V/Q, cor pulmonale, pulmonary hypertension), Endocrine (catecholamines, thyroid on the heart), Heme (thrombosis, anticoagulant MOA).
SYSTEM DRIFT TRAPS: reperfusion strategy selection in ACS; heart failure medication titration and sequencing; anticoagulation initiation in atrial fibrillation; valve replacement candidacy; lipid treatment thresholds.`,

  respiratory: `CONTENT DISTRIBUTION: Pathology/Histopathology 40%, Physiology 30%, Pharmacology (MOA only) 15%, Anatomy & Embryology 15%.
TIER 1: obstructive versus restrictive mechanics and PFT patterns; V/Q mismatch, shunt and dead space; oxygen-haemoglobin dissociation; asthma and COPD pathophysiology; pneumonia patterns; lung cancer histology and paraneoplastic syndromes.
TIER 2: pulmonary embolism and infarction; ARDS pathophysiology; interstitial lung disease and pneumoconioses; cystic fibrosis; surfactant and neonatal RDS; pleural pathology.
TIER 3: bronchiectasis; sleep apnoea physiology; high-altitude adaptation; lung development stages.
PHARMACOLOGY: beta-2 agonists, muscarinic antagonists, inhaled corticosteroids, leukotriene modifiers, methylxanthines, pulmonary vasodilators. MOA and mechanism-based adverse effects only.
OVERLAP: Cardiovascular (pulmonary hypertension, cor pulmonale), Renal (acid-base compensation), ID (pneumonia pathogens), Immune (hypersensitivity, atopy).
SYSTEM DRIFT TRAPS: ventilator setting selection in ARDS; oxygen therapy targets; asthma step-up and step-down therapy; PE anticoagulation choice; lung cancer staging thresholds.`,

  gastrointestinal: `CONTENT DISTRIBUTION: Pathology/Histopathology 45%, Physiology 25%, Pharmacology (MOA only) 15%, Anatomy & Embryology 15%.
TIER 1: peptic ulcer disease and H pylori; inflammatory bowel disease; cirrhosis and portal hypertension; viral hepatitis; malabsorption syndromes; colorectal neoplasia sequence; oesophageal pathology.
TIER 2: pancreatitis mechanisms; biliary disease and bilirubin metabolism; GI bleeding sources; motility disorders; hernias and the inguinal canal; gut hormone physiology.
TIER 3: carcinoid and neuroendocrine tumours; congenital atresias and malrotation; vitamin deficiency syndromes; enteric nervous system.
PHARMACOLOGY: proton pump inhibitors, H2 blockers, prokinetics, laxatives and antidiarrhoeals, antiemetics by receptor, aminosalicylates. MOA and mechanism-based adverse effects only.
OVERLAP: Heme (iron and B12 absorption, GI bleeding), ID (hepatitis viruses, enteric pathogens), Endocrine (gut hormones, insulin and glucagon), Immune (coeliac, IBD immunology).
SYSTEM DRIFT TRAPS: variceal bleeding management protocols; IBD biologic selection; hepatitis treatment regimens; colonoscopy screening intervals; pancreatitis severity scoring and fluid protocols.`,

  renal: `CONTENT DISTRIBUTION: Physiology 35%, Pathology/Histopathology 35%, Pharmacology (MOA only) 15%, Anatomy & Embryology 15%.
TIER 1: nephron transport by segment; glomerular filtration and clearance; acid-base disorders; potassium and sodium handling; nephritic versus nephrotic syndromes; acute tubular necrosis and casts.
TIER 2: RAAS and ADH physiology; diabetic and hypertensive nephropathy; cystic kidney disease; nephrolithiasis chemistry; renal tubular acidoses; obstructive uropathy.
TIER 3: renal embryology and congenital anomalies; renal cell carcinoma; countercurrent multiplication detail; EPO and mineral bone axis.
PHARMACOLOGY: loop, thiazide and potassium-sparing diuretics, carbonic anhydrase inhibitors, ADH analogues and antagonists, RAAS blockers, SGLT2 inhibitors. MOA, site of action and mechanism-based adverse effects only.
OVERLAP: Cardiovascular (volume, edema, hypertension), Endocrine (RAAS, ADH, aldosterone), Heme (EPO and anemia of CKD), ID (pyelonephritis pathogens).
SYSTEM DRIFT TRAPS: dialysis initiation criteria; transplant candidacy; CKD staging thresholds and referral; potassium correction protocols; contrast nephropathy prophylaxis regimens.`,

  endocrine: `CONTENT DISTRIBUTION: Physiology 35%, Pathology/Histopathology 30%, Pharmacology (MOA only) 20%, Anatomy & Embryology 15%.
TIER 1: hypothalamic-pituitary axes and feedback; thyroid physiology and dysfunction; adrenal cortex and medulla disorders; diabetes mellitus pathophysiology; calcium and PTH regulation.
TIER 2: pituitary adenomas; MEN syndromes; congenital adrenal hyperplasias; insulin and glucagon signalling; growth hormone axis; diabetes insipidus and SIADH.
TIER 3: pancreatic islet tumours; thyroid histopathology subtypes; vitamin D metabolism detail; endocrine embryology.
PHARMACOLOGY: insulin preparations by kinetics, metformin, sulfonylureas, GLP-1 agonists, SGLT2 inhibitors, thionamides, corticosteroids, bisphosphonates. MOA and mechanism-based adverse effects only.
OVERLAP: Renal (RAAS, ADH, calcium handling), Cardiovascular (catecholamines, thyroid on the heart), Repro (sex steroid axes), Heme (steroid effects on marrow).
SYSTEM DRIFT TRAPS: insulin regimen selection and titration; diabetes screening intervals; thyroid nodule workup algorithms; steroid tapering protocols; osteoporosis treatment thresholds.`,

  heme_onc: `CONTENT DISTRIBUTION: Pathology/Histopathology 45%, Physiology 25%, Pharmacology (MOA only) 20%, Anatomy & Embryology 10%.
TIER 1: microcytic, macrocytic and hemolytic anemias; coagulation cascade and platelet function; leukemias and lymphomas by lineage; hemoglobinopathies; iron studies interpretation.
TIER 2: myeloproliferative neoplasms; plasma cell dyscrasias; thrombophilias; transfusion reaction mechanisms; DIC and TTP/HUS mechanisms; oncogenes and tumour suppressors.
TIER 3: bone marrow failure syndromes; paraneoplastic syndromes; tumour lysis biochemistry; hematopoiesis ontogeny.
PHARMACOLOGY: anticoagulants and antiplatelets by target, thrombolytics, chemotherapy agents by cell-cycle site, targeted kinase inhibitors, hematopoietic growth factors. MOA and mechanism-based adverse effects only.
OVERLAP: Immune (lymphocyte biology, immunodeficiency), GI (iron and B12 absorption), Renal (EPO), ID (febrile neutropenia pathogens).
SYSTEM DRIFT TRAPS: transfusion thresholds; chemotherapy regimen choice; anticoagulation duration and bridging; cancer staging and referral criteria; growth factor dosing protocols.`,

  repro: `CONTENT DISTRIBUTION: Pathology/Histopathology 35%, Physiology 30%, Anatomy & Embryology 20%, Pharmacology (MOA only) 15%.
TIER 1: menstrual cycle hormonal control; sexual differentiation and embryology; placental physiology; gestational complications by mechanism; ovarian and testicular neoplasms; androgen and estrogen synthesis.
TIER 2: PCOS and hyperandrogenism; endometriosis and fibroids; cervical and endometrial neoplasia; male infertility mechanisms; pregnancy physiologic adaptations; congenital genital anomalies.
TIER 3: gestational trophoblastic disease; breast pathology; lactation physiology; teratogen mechanisms.
PHARMACOLOGY: combined and progestin-only contraceptives, SERMs and aromatase inhibitors, GnRH agonists and antagonists, tocolytics, uterotonics, testosterone and 5-alpha reductase inhibitors. MOA and mechanism-based adverse effects only.
OVERLAP: Endocrine (HPG axis, sex steroid synthesis), Peds/Development (fetal development, teratogens), Immune (Rh isoimmunisation), Heme (pregnancy hypercoagulability).
SYSTEM DRIFT TRAPS: obstetric management and delivery decisions; cervical cancer screening intervals; infertility treatment algorithms; contraception selection counselling; preeclampsia management protocols.`,

  msk_derm: `CONTENT DISTRIBUTION: Pathology/Histopathology 35%, Anatomy 25%, Physiology 20%, Pharmacology (MOA only) 20%.
TIER 1: upper and lower limb nerve lesions and their deficits; muscle contraction and neuromuscular junction physiology; bone remodelling and metabolic bone disease; inflammatory versus degenerative arthritis; skin layers and common dermatoses.
TIER 2: crystal arthropathies; seronegative spondyloarthropathies; muscular dystrophies; skin cancers and their precursors; bullous disorders by immunofluorescence; connective tissue disorders.
TIER 3: bone tumours by age and location; brachial and lumbosacral plexus detail; limb embryology; wound healing phases.
PHARMACOLOGY: NSAIDs and COX selectivity, colchicine, urate-lowering agents, DMARDs and biologics by target, muscle relaxants, corticosteroids in skin. MOA and mechanism-based adverse effects only.
OVERLAP: Immune (autoimmune arthritis, vasculitis skin signs), Neuro (peripheral nerve, NMJ), Endocrine (PTH and vitamin D on bone), Heme (marrow in bone lesions).
SYSTEM DRIFT TRAPS: DMARD escalation sequencing; fracture fixation decisions; gout treatment thresholds and prophylaxis timing; melanoma excision margins; biologic selection in psoriasis.`,

  neuro: `CONTENT DISTRIBUTION: Anatomy 30%, Pathology/Histopathology 25%, Physiology 25%, Pharmacology (MOA only) 20%.
TIER 1: motor and sensory tract localisation; brainstem and cranial nerve syndromes; cerebrovascular territories; neurotransmitter systems; seizure mechanisms; demyelinating disease.
TIER 2: neurodegenerative disease pathology and inclusions; CNS tumours by cell of origin and location; hydrocephalus and CSF dynamics; spinal cord syndromes; neurocutaneous syndromes.
TIER 3: neural tube and CNS embryology; sleep architecture; special senses physiology; congenital malformations.
PHARMACOLOGY: antiepileptics by channel or receptor, dopaminergic agents, cholinesterase inhibitors, triptans, anaesthetics and analgesics by receptor, neuromuscular blockers. MOA and mechanism-based adverse effects only.
OVERLAP: Psych (neurotransmitters, psychotropic MOA), MSK (peripheral nerve, NMJ), Cardiovascular (stroke mechanism, perfusion), ID (meningitis and encephalitis pathogens).
SYSTEM DRIFT TRAPS: thrombolysis time windows and eligibility; antiepileptic drug selection and switching; MS disease-modifying therapy choice; ICP management protocols; tumour resection criteria.`,

  psych: `CONTENT DISTRIBUTION: Physiology and neurochemistry 35%, Pharmacology (MOA only) 30%, Pathology 20%, Behavioural science 15%.
TIER 1: neurotransmitter systems and their receptors; antidepressant, antipsychotic and mood stabiliser mechanisms; substance intoxication and withdrawal mechanisms; the dopamine hypothesis; sleep neurophysiology.
TIER 2: defence mechanisms; developmental milestones and their disruption; extrapyramidal and metabolic drug effects by mechanism; stress axis and cortisol; personality disorder clusters.
TIER 3: ethics and consent principles; epidemiology of psychiatric illness; grief versus depression; behavioural conditioning.
PHARMACOLOGY: SSRIs and SNRIs, TCAs, MAOIs, typical and atypical antipsychotics by receptor profile, lithium, benzodiazepines, stimulants. MOA, receptor profile and mechanism-based adverse effects only.
OVERLAP: Neuro (neurotransmitters, receptor pharmacology), Endocrine (HPA axis, thyroid and mood), Cardiovascular (QT effects by mechanism), Peds/Development (neurodevelopmental disorders).
SYSTEM DRIFT TRAPS: antidepressant selection and switching algorithms; antipsychotic dosing and monitoring schedules; involuntary hold criteria; suicide risk stratification tools; therapy modality selection.`,

  infectious_disease: `CONTENT DISTRIBUTION: Microbiology and pathology 50%, Pharmacology (MOA only) 25%, Immunology and physiology 15%, Anatomy 10%.
TIER 1: bacterial classification, virulence factors and toxins; antibiotic mechanisms and resistance mechanisms; viral replication strategies; fungal and parasitic morphology; host-pathogen entry routes.
TIER 2: organism-specific pathogenesis for high-yield pathogens; vaccine mechanisms; congenital and opportunistic infections; biofilms and device infection; sterilisation principles.
TIER 3: prion biology; emerging pathogens; vector biology; laboratory identification methods.
PHARMACOLOGY: cell wall agents, protein synthesis inhibitors by ribosomal subunit, nucleic acid inhibitors, antifungals, antivirals, antiparasitics. MOA, resistance mechanism and mechanism-based adverse effects only.
OVERLAP: Immune (host defence, immunodeficiency-specific organisms), Respiratory (pneumonia), GI (enteric and hepatitis), Neuro (meningitis and encephalitis).
SYSTEM DRIFT TRAPS: empiric antibiotic selection; treatment duration; isolation and prophylaxis protocols; vaccine schedules; HIV regimen composition.`,

  immune: `CONTENT DISTRIBUTION: Physiology and immunology 40%, Pathology/Histopathology 30%, Pharmacology (MOA only) 20%, Embryology 10%.
TIER 1: innate versus adaptive immunity; T and B cell development and selection; MHC and antigen presentation; the four hypersensitivity types; complement pathways; cytokine functions.
TIER 2: primary immunodeficiencies by defective step; autoimmunity mechanisms and autoantibodies; transplant rejection by timing and mechanism; lymphoid organ architecture; immunoglobulin class switching.
TIER 3: tolerance mechanisms; tumour immunology; splenic function and asplenia; lymphatic drainage.
PHARMACOLOGY: calcineurin inhibitors, antimetabolites, biologic agents by cytokine target, checkpoint inhibitors, corticosteroids. MOA and mechanism-based adverse effects only.
OVERLAP: ID (immunodeficiency-specific organisms), Heme (lymphoid malignancy, marrow), MSK/Derm (autoimmune arthritis, bullous disease), Repro (Rh isoimmunisation).
SYSTEM DRIFT TRAPS: immunosuppression regimen selection; transplant matching criteria; biologic escalation in autoimmune disease; immunoglobulin replacement protocols; vaccination schedules in immunodeficiency.`,

  peds_dev: `CONTENT DISTRIBUTION: Embryology and development 35%, Pathology 30%, Physiology 20%, Pharmacology (MOA only) 15%.
TIER 1: embryologic derivatives by germ layer and pharyngeal arch; fetal circulation and its transition at birth; developmental milestones; congenital malformations by mechanism; genetic and chromosomal syndromes.
TIER 2: inborn errors of metabolism by blocked enzyme; neonatal jaundice mechanisms; growth and puberty physiology; teratogen mechanisms; paediatric tumours by cell of origin.
TIER 3: newborn screening biochemistry; adolescent physiology; failure to thrive mechanisms; APGAR physiology.
PHARMACOLOGY: agents affecting the ductus arteriosus, surfactant, drugs crossing the placenta or entering milk, age-dependent pharmacokinetic differences. MOA and mechanism-based effects only.
OVERLAP: Repro (fetal development, teratogens), Cardiovascular (congenital heart disease, fetal shunts), Endocrine (growth axis, congenital adrenal hyperplasia), Neuro (neurodevelopment).
SYSTEM DRIFT TRAPS: immunisation schedules; growth chart thresholds and referral; neonatal resuscitation protocols; feeding and fluid protocols; developmental screening intervals.`,
};

/**
 * Step 2 CK System Briefs.
 *
 * Same field format as SYSTEM_BRIEFS, reframed for practice: the distribution
 * is by physician task rather than discipline, the tiers are presentations and
 * decisions rather than mechanisms, DIAGNOSTICS and MANAGEMENT replace
 * PHARMACOLOGY, and the drift traps point the other way. The Step 1 briefs'
 * SYSTEM DRIFT TRAPS lines seeded these — they already enumerated the clinical
 * content Step 2 CK should test.
 */
export const STEP2_SYSTEM_BRIEFS: Record<SystemKey, string> = {
  cardiovascular: `CONTENT DISTRIBUTION: Diagnosis and diagnostic studies 40-45%, Management 35-40%, Prognosis and prevention 10-15%, Patient safety and systems 5%.
TIER 1: acute coronary syndrome — recognition, ECG and troponin interpretation, the reperfusion pathway and discharge therapy; acute decompensated and chronic heart failure — diagnosis, guideline-directed therapy and its sequencing; atrial fibrillation — rate versus rhythm control, stroke-risk stratification and anticoagulation; hypertension — diagnosis, targets and first-line agents by comorbidity; syncope evaluation; aortic dissection recognition and initial management.
TIER 2: valvular disease — murmur recognition, echocardiography and the indications for intervention; pericarditis and tamponade; infective endocarditis — diagnostic criteria, empiric therapy and surgical indications; bradyarrhythmias and pacing indications; ventricular tachycardia and cardiac arrest algorithms; peripheral arterial disease; deep vein thrombosis diagnosis; dyslipidemia treatment thresholds.
TIER 3: hypertensive emergency; cardiomyopathies and the indications for device therapy; adult congenital heart disease; cardiac risk assessment before non-cardiac surgery; cardiac rehabilitation and secondary prevention counselling.
DIAGNOSTICS: 12-lead ECG reading, troponin kinetics, BNP, echocardiography, stress test selection, CT angiography for dissection and PE, ambulatory rhythm monitoring.
MANAGEMENT: antiplatelet and anticoagulant selection and duration, beta blockers, ACE inhibitors and ARBs, ARNI, mineralocorticoid antagonists and SGLT2 inhibitors in heart failure, statins by risk category, diuretics in decompensation, cardioversion and ablation indications, ICD and pacemaker indications.
OVERLAP: Renal (hypertension targets in CKD, RAAS blockade and potassium), Respiratory (PE, cor pulmonale), Endocrine (diabetes and cardiovascular risk), Heme (anticoagulant reversal, bleeding on antiplatelets).
DRIFT TRAPS: the mechanism of a murmur rather than what to do about it; the pressure-volume loop in place of the treatment decision; the ion channel an antiarrhythmic blocks; embryology of a congenital lesion; histology of the infarcted myocardium by day.`,

  respiratory: `CONTENT DISTRIBUTION: Diagnosis and diagnostic studies 40-45%, Management 35-40%, Prognosis and prevention 10-15%, Patient safety and systems 5%.
TIER 1: asthma — severity assessment, exacerbation management and stepwise controller therapy; COPD — diagnosis, exacerbation management, GOLD-guided therapy and the indications for home oxygen; community-acquired and hospital-acquired pneumonia — site-of-care decision, empiric regimen and follow-up; pulmonary embolism — pretest probability, the diagnostic pathway and anticoagulation; pleural effusion evaluation; lung cancer screening and the incidental nodule.
TIER 2: acute respiratory failure and the indications for non-invasive and invasive ventilation; ARDS management principles; interstitial lung disease evaluation; tuberculosis — screening, latent infection and active disease; obstructive sleep apnoea; pneumothorax management by size and stability; hemoptysis evaluation.
TIER 3: cystic fibrosis complications in the adult; sarcoidosis; pulmonary hypertension evaluation; pre-operative pulmonary risk; smoking cessation pharmacotherapy; occupational lung disease surveillance.
DIAGNOSTICS: chest radiograph and CT patterns, spirometry and DLCO interpretation, arterial blood gas interpretation, pleural fluid analysis and Light's criteria, D-dimer and CT pulmonary angiography, Wells and PERC, bronchoscopy indications.
MANAGEMENT: inhaled bronchodilators and corticosteroids by step, systemic corticosteroids in exacerbations, antibiotic selection by setting and risk factors, oxygen targets, anticoagulant choice and duration, thrombolysis criteria in PE, chest tube indications, vaccination in chronic lung disease.
OVERLAP: Cardiovascular (PE, cor pulmonale, heart failure as a cause of dyspnoea), ID (pneumonia pathogens, tuberculosis), Immune (hypersensitivity pneumonitis), Heme (anticoagulation).
DRIFT TRAPS: V/Q mismatch physiology in place of the treatment decision; the oxygen-haemoglobin curve rather than the oxygen target; the receptor a bronchodilator acts on; pneumocyte types and surfactant biochemistry; lung development stages.`,

  gastrointestinal: `CONTENT DISTRIBUTION: Diagnosis and diagnostic studies 40-45%, Management 35-40%, Prognosis and prevention 10-15%, Patient safety and systems 5%.
TIER 1: upper and lower GI bleeding — resuscitation, risk stratification, endoscopy timing and therapy; peptic ulcer disease and H pylori — testing and eradication; inflammatory bowel disease — diagnosis, induction and maintenance, and complications; cirrhosis — ascites, spontaneous bacterial peritonitis, variceal bleeding and hepatic encephalopathy; acute pancreatitis — diagnosis, severity and supportive care; biliary disease — cholecystitis, choledocholithiasis and cholangitis pathways; colorectal cancer screening and surveillance.
TIER 2: the acute abdomen — appendicitis, bowel obstruction, mesenteric ischaemia and perforation; GERD and Barrett oesophagus surveillance; dysphagia evaluation; viral hepatitis — serology interpretation, treatment candidates and vaccination; irritable bowel syndrome; coeliac disease diagnosis; diverticulitis management; Clostridioides difficile treatment.
TIER 3: chronic pancreatitis; hepatocellular carcinoma surveillance; drug-induced liver injury; malabsorption and nutritional deficiency management; hernia management; anorectal disease.
DIAGNOSTICS: liver function test patterns, hepatitis serologies, lipase, abdominal ultrasound versus CT, endoscopy and colonoscopy indications, MRCP versus ERCP, stool studies, faecal calprotectin, coeliac serology.
MANAGEMENT: proton pump inhibitor courses, H pylori regimens, transfusion thresholds in GI bleeding, octreotide and antibiotics in variceal bleeding, paracentesis and albumin, lactulose and rifaximin, IBD induction and maintenance agents, surgical referral criteria, fluid strategy in pancreatitis, colonoscopy intervals.
OVERLAP: Heme (iron deficiency workup, transfusion), ID (hepatitis, C difficile, SBP), Endocrine (diabetes after pancreatitis), MSK (abdominal wall hernia).
DRIFT TRAPS: the enzyme deficient in a malabsorption syndrome; bilirubin conjugation biochemistry; the receptor an antiemetic blocks; the embryology of malrotation or atresia; histology of the polyp rather than the surveillance interval it dictates.`,

  renal: `CONTENT DISTRIBUTION: Diagnosis and diagnostic studies 45%, Management 35%, Prognosis and prevention 15%, Patient safety and systems 5%.
TIER 1: acute kidney injury — prerenal, intrinsic and postrenal differentiation, urine studies and management; chronic kidney disease — staging, progression control and complication management; hyperkalaemia — ECG recognition and stepwise treatment; hyponatraemia — volume-status-based evaluation and safe correction; acid-base disorders — stepwise interpretation with anion and delta gaps; urinary tract infection and pyelonephritis in adults.
TIER 2: nephrotic and nephritic syndromes — evaluation, biopsy indications and initial therapy; nephrolithiasis — imaging, stone passage versus intervention and prevention; hypercalcaemia and hypocalcaemia management; hypokalaemia and hypomagnesaemia; the indications for urgent dialysis; contrast-associated kidney injury prevention; renal dosing of drugs.
TIER 3: renal artery stenosis evaluation; polycystic kidney disease surveillance; renal transplant medication complications; the incidental renal mass; benign prostatic hyperplasia and urinary retention; haematuria evaluation.
DIAGNOSTICS: urinalysis and microscopy, urine sodium and FENa, urine and serum osmolality, anion gap, renal ultrasound, complement and serologies in glomerulonephritis, biopsy indications, estimated GFR and albuminuria staging.
MANAGEMENT: fluid choice and rate, calcium gluconate, insulin-dextrose and potassium binders, hypertonic saline and the correction limit, RAAS blockade and SGLT2 inhibitors in CKD, erythropoiesis-stimulating agents and phosphate binders, dialysis indications, tamsulosin for stone passage, thiazides and citrate for stone prevention, antibiotic selection in complicated UTI.
OVERLAP: Cardiovascular (hypertension and heart failure in CKD), Endocrine (diabetic nephropathy, SIADH, PTH), Heme (anaemia of CKD), ID (UTI pathogens, sepsis).
DRIFT TRAPS: the transporter a diuretic inhibits rather than which diuretic to give; countercurrent physiology in place of the sodium-correction plan; the immunofluorescence pattern rather than the biopsy indication; nephron embryology; cast morphology as an end in itself.`,

  endocrine: `CONTENT DISTRIBUTION: Diagnosis and diagnostic studies 40-45%, Management 35-40%, Prognosis and prevention 15%, Patient safety and systems 5%.
TIER 1: type 2 diabetes — diagnosis, glycaemic targets, agent selection by comorbidity and complication screening; diabetic ketoacidosis and hyperosmolar hyperglycaemic state — recognition and the management sequence; hypothyroidism and hyperthyroidism — testing, treatment and thyroid storm; adrenal insufficiency and adrenal crisis; hypercalcaemia and primary hyperparathyroidism; osteoporosis screening and treatment thresholds.
TIER 2: thyroid nodule evaluation; Cushing syndrome and the diagnostic sequence; primary hyperaldosteronism and the secondary hypertension workup; pheochromocytoma evaluation and pre-operative preparation; pituitary adenoma — prolactinoma and acromegaly evaluation; diabetes insipidus and SIADH management; hypoglycaemia evaluation; gestational diabetes screening and management.
TIER 3: type 1 diabetes insulin regimens; adrenal incidentaloma; MEN syndrome surveillance; polycystic ovary syndrome metabolic management; hypogonadism evaluation; steroid tapering and stress dosing; inpatient glycaemic management.
DIAGNOSTICS: HbA1c and glucose criteria, TSH-first thyroid testing, radioactive iodine uptake, thyroid ultrasound and fine-needle aspiration criteria, cosyntropin stimulation, dexamethasone suppression and late-night salivary cortisol, aldosterone-renin ratio, plasma metanephrines, DEXA and FRAX, PTH interpreted against calcium.
MANAGEMENT: metformin first and the second agent by cardiovascular, renal or weight priority, insulin initiation and titration, fluid, insulin and potassium sequencing in DKA, levothyroxine dosing and monitoring, thionamides, beta blockers and radioactive iodine, hydrocortisone and stress dosing, bisphosphonates and the alternatives, surgical indications in hyperparathyroidism.
OVERLAP: Cardiovascular (diabetes and cardiovascular risk, hypertension), Renal (diabetic nephropathy, hyponatraemia), Repro (gestational diabetes, PCOS, thyroid disease in pregnancy), Neuro (pituitary mass effect).
DRIFT TRAPS: the signalling pathway of insulin or a sulfonylurea rather than which agent to add; the enzyme block in congenital adrenal hyperplasia; hormone synthesis steps in place of the test to order; the histologic subtype of thyroid cancer as the end point; thyroid embryology.`,

  heme_onc: `CONTENT DISTRIBUTION: Diagnosis and diagnostic studies 45%, Management 30-35%, Prognosis and prevention 15%, Patient safety and systems 5-10%.
TIER 1: anaemia evaluation — microcytic, normocytic and macrocytic workup and the iron studies; venous thromboembolism — diagnosis, anticoagulant selection, duration and reversal; transfusion — indications, thresholds and reactions; thrombocytopenia evaluation — ITP, heparin-induced thrombocytopenia, TTP and DIC recognition and initial management; oncologic emergencies — febrile neutropenia, tumour lysis, hypercalcaemia of malignancy, spinal cord compression, superior vena cava syndrome.
TIER 2: leukaemia and lymphoma — presentation, the diagnostic test to order and referral; multiple myeloma evaluation; sickle cell disease — vaso-occlusive crisis, acute chest syndrome and preventive care; bleeding disorder evaluation — von Willebrand disease and haemophilia; polycythaemia evaluation; cancer screening by age and risk; common solid tumours — breast, lung, colon, prostate — presentation and initial workup.
TIER 3: myelodysplastic syndromes; haemochromatosis; thrombophilia testing indications; anticoagulation around procedures; chemotherapy toxicity recognition; palliative care and goals-of-care conversations; cancer survivorship surveillance.
DIAGNOSTICS: complete blood count and smear interpretation, reticulocyte index, iron studies and ferritin, B12 and folate with methylmalonic acid, haemolysis labs, coagulation studies and mixing studies, D-dimer and imaging in VTE, the 4T score, ADAMTS13, flow cytometry and bone marrow biopsy indications, serum protein electrophoresis and free light chains.
MANAGEMENT: oral and intravenous iron, B12 replacement, transfusion thresholds and product selection, direct oral anticoagulants versus warfarin versus heparin by patient factors, anticoagulant reversal agents, platelet transfusion thresholds, steroids and IVIG in ITP, plasma exchange in TTP, empiric antibiotics in febrile neutropenia, rasburicase and fluids in tumour lysis, hydroxyurea in sickle cell disease.
OVERLAP: GI (iron deficiency source, GI bleeding), Renal (anaemia of CKD, tumour lysis), ID (febrile neutropenia, the immunocompromised host), Cardiovascular (anticoagulation in atrial fibrillation).
DRIFT TRAPS: the coagulation cascade step a drug inhibits rather than which drug to give; haemoglobin structure and the oxygen curve; the translocation in place of the referral; the cell-cycle site of a chemotherapy agent; haematopoiesis ontogeny.`,

  repro: `CONTENT DISTRIBUTION: Diagnosis and diagnostic studies 40%, Management 35-40%, Prognosis and prevention 15-20%, Patient safety and systems 5%.
TIER 1: prenatal care — the screening schedule, routine labs and vaccination; hypertensive disorders of pregnancy — diagnosis, magnesium and antihypertensive use, and delivery timing; first-trimester bleeding — ectopic pregnancy and miscarriage evaluation and management; third-trimester bleeding — placenta praevia and abruption; labour and delivery — fetal heart rate interpretation, labour dystocia and postpartum haemorrhage; contraception selection by medical eligibility; abnormal uterine bleeding evaluation.
TIER 2: gestational diabetes; preterm labour and premature rupture of membranes; postpartum complications — endometritis, depression and thromboembolism; cervical cancer screening and management of abnormal cytology; pelvic inflammatory disease and sexually transmitted infections in women; infertility initial evaluation; menopause management; ovarian mass evaluation; endometriosis and fibroid management.
TIER 3: Rh alloimmunisation prevention; intrahepatic cholestasis of pregnancy; medications in pregnancy and lactation; breast mass evaluation; polycystic ovary syndrome; urinary incontinence and pelvic organ prolapse; male infertility and erectile dysfunction evaluation; testicular mass and torsion.
DIAGNOSTICS: beta-hCG kinetics and transvaginal ultrasound, cell-free DNA and serum screening, glucose challenge and tolerance testing, fetal heart rate tracing categories, group B streptococcus screening, Pap and HPV co-testing, pelvic ultrasound, endometrial biopsy indications, semen analysis, mammography and breast ultrasound by age.
MANAGEMENT: methotrexate versus surgery in ectopic pregnancy, magnesium sulfate, labetalol, nifedipine and hydralazine, low-dose aspirin prophylaxis, betamethasone and tocolysis, oxytocin and uterotonics, intrapartum antibiotics, Rh immunoglobulin, contraception by eligibility criteria, hormone therapy candidacy, colposcopy and excision thresholds, tranexamic acid and hormonal therapy for heavy bleeding.
OVERLAP: Endocrine (gestational diabetes, thyroid disease in pregnancy, PCOS), Heme (anaemia and thromboembolism in pregnancy, Rh), ID (STIs, GBS, congenital infection), Peds (neonatal transition, breastfeeding).
DRIFT TRAPS: the hormonal control of the menstrual cycle in place of the contraceptive choice; steroidogenesis enzyme steps; gonadal and Müllerian embryology; placental physiology as an end point; the receptor a tocolytic acts on.`,

  msk_derm: `CONTENT DISTRIBUTION: Diagnosis and diagnostic studies 45%, Management 35%, Prognosis and prevention 15%, Patient safety and systems 5%.
TIER 1: the acute monoarthritis — septic arthritis versus crystal disease, arthrocentesis and empiric therapy; low back pain — red flags, imaging indications and cauda equina recognition; rheumatoid arthritis — diagnosis, early DMARD therapy and monitoring; gout — acute treatment and urate-lowering indications; osteoarthritis management; common fractures — hip, distal radius, scaphoid — and their complications; skin and soft tissue infection — cellulitis, abscess and necrotising fasciitis.
TIER 2: systemic lupus erythematosus — diagnosis, organ involvement and therapy; giant cell arteritis and polymyalgia rheumatica — recognition and urgent steroids; seronegative spondyloarthritis; osteoporotic fracture prevention; compartment syndrome; melanoma recognition and biopsy; non-melanoma skin cancer; psoriasis and atopic dermatitis management; drug eruptions — Stevens-Johnson recognition and management.
TIER 3: vasculitis workup; inflammatory myopathies; fibromyalgia; sports injuries — ACL, meniscus and rotator cuff evaluation; open fracture and osteomyelitis; pressure injury prevention and staging; acne management; hidradenitis; burn assessment and initial management.
DIAGNOSTICS: synovial fluid analysis, rheumatoid factor and anti-CCP, ANA and specific autoantibodies, ESR and CRP, radiograph versus MRI indications, DEXA, dermatoscopy and biopsy technique, skin scraping and KOH, temporal artery biopsy, compartment pressures.
MANAGEMENT: arthrocentesis and empiric antibiotics, NSAIDs, colchicine and steroids in gout, allopurinol initiation with flare prophylaxis, methotrexate and biologic escalation, high-dose steroids in GCA, hydroxychloroquine in lupus, bisphosphonates, fracture reduction and fixation indications, incision and drainage, antibiotic selection for MRSA risk, topical steroid potency by site, isotretinoin and its monitoring, excision margins by Breslow depth.
OVERLAP: Immune (autoimmune disease, vasculitis), ID (septic arthritis, osteomyelitis, cellulitis), Neuro (radiculopathy, peripheral nerve injury), Endocrine (osteoporosis, vitamin D).
DRIFT TRAPS: the nerve root or cord as anatomy rather than the imaging or referral decision; the crystal chemistry rather than the treatment; bone remodelling physiology; the immunofluorescence pattern of a bullous disease as the end point; the mechanism of a DMARD rather than which one to start.`,

  neuro: `CONTENT DISTRIBUTION: Diagnosis and diagnostic studies 45%, Management 35%, Prognosis and prevention 15%, Patient safety and systems 5%.
TIER 1: acute ischaemic stroke — recognition, imaging, thrombolysis and thrombectomy eligibility, and secondary prevention; transient ischaemic attack evaluation; headache — red flags, migraine acute and preventive therapy, the subarachnoid haemorrhage pathway; seizure — first seizure evaluation, status epilepticus management and driving counselling; meningitis and encephalitis — empiric therapy and lumbar puncture timing; altered mental status and delirium evaluation.
TIER 2: Parkinson disease diagnosis and initial therapy; multiple sclerosis — diagnosis and acute relapse treatment; Guillain-Barré syndrome — recognition and respiratory monitoring; myasthenia gravis and myasthenic crisis; peripheral neuropathy evaluation; dementia evaluation and the reversible causes; intracranial haemorrhage management; spinal cord compression; vertigo — central versus peripheral.
TIER 3: brain tumour presentation and initial management; idiopathic intracranial hypertension; Bell palsy; carpal tunnel and entrapment neuropathies; traumatic brain injury and the imaging rules; brain death determination; concussion management; restless legs and sleep disorders.
DIAGNOSTICS: non-contrast head CT versus MRI, CT angiography and perfusion, lumbar puncture indications and CSF interpretation, EEG, nerve conduction studies and electromyography, MRI with gadolinium in demyelination, carotid imaging, cognitive screening instruments, the Canadian CT Head Rule.
MANAGEMENT: alteplase and tenecteplase windows and contraindications, thrombectomy criteria, antiplatelet and statin after stroke, anticoagulation timing after cardioembolic stroke, blood pressure targets in ischaemic and haemorrhagic stroke, benzodiazepine then antiepileptic sequence in status, antiepileptic choice by patient factors, empiric meningitis regimens with dexamethasone, triptans and preventives, levodopa versus dopamine agonists by age, high-dose steroids in MS relapse, IVIG or plasma exchange.
OVERLAP: Cardiovascular (atrial fibrillation and stroke, carotid disease), Psych (delirium versus dementia, functional disorders), MSK (radiculopathy, back pain), ID (meningitis and encephalitis pathogens).
DRIFT TRAPS: tract localisation as an end point rather than the imaging or treatment decision; the neurotransmitter or receptor rather than the drug to start; neural tube embryology; the histology of a tumour rather than its management; CSF production physiology.`,

  psych: `CONTENT DISTRIBUTION: Diagnosis 40-45%, Management 35-40%, Prognosis, patient safety and professionalism 15-20%.
TIER 1: major depressive disorder — diagnosis, first-line antidepressant choice and follow-up; suicide risk assessment and the disposition decision; bipolar disorder — recognition of mania and mood stabiliser selection; schizophrenia and first-episode psychosis — antipsychotic choice and monitoring; anxiety disorders and panic — first-line pharmacotherapy and psychotherapy; substance use — alcohol withdrawal management, opioid use disorder treatment and overdose management.
TIER 2: delirium versus dementia versus depression in the older adult; eating disorders — medical complications and refeeding; ADHD and autism spectrum recognition and initial management; PTSD and adjustment disorder; obsessive-compulsive disorder; personality disorders and their management in the clinical encounter; somatic symptom and factitious disorders; postpartum depression and psychosis.
TIER 3: antidepressant switching and augmentation; serotonin syndrome and neuroleptic malignant syndrome recognition; lithium and clozapine monitoring; sleep disorders; grief; child abuse recognition and reporting; involuntary commitment criteria; capacity assessment.
DIAGNOSTICS: DSM-5 duration and symptom criteria, screening instruments, the medical workup before a psychiatric diagnosis, urine toxicology, thyroid and B12 in mood and cognitive change, ECG before QT-prolonging agents, metabolic monitoring on antipsychotics.
MANAGEMENT: SSRI first line and the adverse-effect-guided alternatives, duration of treatment, lithium, valproate and lamotrigine by patient factors, atypical antipsychotic selection by metabolic and extrapyramidal profile, benzodiazepine taper and the alternatives, CIWA-guided withdrawal treatment, buprenorphine, methadone and naltrexone, naloxone, ECT indications, cognitive behavioural therapy as first line or adjunct, safety planning and hospitalisation criteria.
OVERLAP: Neuro (delirium, dementia, functional disorders), Endocrine (thyroid and mood, metabolic effects of antipsychotics), Cardiovascular (QT prolongation, TCA toxicity), Repro (perinatal mood disorders, medication in pregnancy).
DRIFT TRAPS: the receptor profile of an antipsychotic rather than which one to start; the dopamine hypothesis as the end point; defence mechanisms named for their own sake; neurotransmitter biochemistry; sleep architecture stages.`,

  infectious_disease: `CONTENT DISTRIBUTION: Diagnosis and diagnostic studies 40%, Management 40%, Prevention 15%, Patient safety and systems 5%.
TIER 1: sepsis — recognition, cultures, empiric antibiotics and resuscitation; urinary tract infection by host — cystitis, pyelonephritis, pregnancy and catheter-associated; skin and soft tissue infection; HIV — testing, initiation of therapy, opportunistic infection prophylaxis and the CD4 thresholds; sexually transmitted infections — testing, treatment and partner management; tuberculosis — screening, latent infection and active disease treatment; endocarditis empiric therapy.
TIER 2: meningitis empiric therapy by age and risk; pneumonia regimens by setting; Clostridioides difficile; infectious diarrhoea evaluation; osteomyelitis and the diabetic foot infection; fever of unknown origin approach; travel medicine and malaria; tick-borne disease recognition and treatment; influenza and COVID-19 antiviral indications; hepatitis B and C treatment candidacy.
TIER 3: post-exposure prophylaxis — HIV, hepatitis B, rabies; infection in the immunocompromised host; central line and prosthetic device infections; antibiotic stewardship and de-escalation; the adult vaccination schedule; infection control and isolation categories; febrile neutropenia; Lyme disease by stage.
DIAGNOSTICS: blood cultures before antibiotics, urinalysis and culture interpretation, procalcitonin, HIV antigen-antibody testing and viral load, interferon-gamma release assay and chest radiograph, nucleic acid amplification for STIs, lumbar puncture, stool studies, MRI in osteomyelitis, echocardiography in endocarditis.
MANAGEMENT: empiric regimen selection by syndrome and risk factors, MRSA and Pseudomonas coverage triggers, narrowing on culture results, treatment duration by syndrome, antiretroviral initiation and prophylaxis thresholds, RIPE therapy and its monitoring, ceftriaxone and doxycycline regimens for STIs, fidaxomicin and vancomycin for C difficile, oseltamivir timing, vaccination by age and comorbidity, post-exposure prophylaxis timing.
OVERLAP: Respiratory (pneumonia, tuberculosis), Renal (UTI, sepsis-associated AKI), Heme (febrile neutropenia), Immune (HIV, the immunocompromised host), Repro (STIs, infection in pregnancy).
DRIFT TRAPS: the ribosomal subunit an antibiotic binds rather than which antibiotic to give; the virulence factor or toxin as the end point; viral replication steps; Gram stain morphology for its own sake; the resistance mechanism rather than the regimen change it forces.`,

  immune: `CONTENT DISTRIBUTION: Diagnosis and diagnostic studies 45%, Management 35%, Prognosis and prevention 15%, Patient safety and systems 5%.
TIER 1: anaphylaxis — recognition, epinephrine and observation; allergic rhinitis, urticaria and angioedema management; drug allergy — evaluation, penicillin allergy delabelling and cross-reactivity; primary immunodeficiency — recognition by infection pattern and the initial tests; the transplant recipient — rejection recognition and immunosuppressant complications; HIV as an acquired immunodeficiency — opportunistic infection risk by CD4 count.
TIER 2: systemic autoimmune disease evaluation — lupus, Sjögren syndrome, systemic sclerosis; vasculitis presentation and workup; sarcoidosis; hereditary angioedema; serum sickness and drug reactions; immune reconstitution; vaccination in the immunocompromised patient; splenectomy and asplenia prophylaxis; adult-onset immunodeficiency.
TIER 3: eosinophilia evaluation; mast cell disorders; immune-related adverse events of checkpoint inhibitors; graft-versus-host disease; immunoglobulin replacement indications; contact dermatitis; food allergy management.
DIAGNOSTICS: tryptase, specific IgE and skin testing indications, quantitative immunoglobulins and vaccine titres, complement levels, ANA and specific autoantibody panels, ANCA, flow cytometry for lymphocyte subsets, C1 inhibitor level and function, HIV testing and CD4 count, biopsy in vasculitis and rejection.
MANAGEMENT: intramuscular epinephrine dosing and adjuncts, antihistamines and intranasal steroids, systemic steroids in severe reactions, C1 inhibitor concentrate and the alternatives in hereditary angioedema, antibiotic prophylaxis and vaccination in asplenia, immunoglobulin replacement, opportunistic infection prophylaxis by CD4 count, calcineurin inhibitor toxicity management, steroid-sparing agents, live vaccine avoidance rules.
OVERLAP: ID (opportunistic infection, HIV), MSK/Derm (autoimmune arthritis, cutaneous drug reactions), Heme (lymphoma in immunodeficiency, cytopenias), Respiratory (asthma, hypersensitivity pneumonitis).
DRIFT TRAPS: the hypersensitivity type as the end point rather than the treatment it dictates; MHC and antigen presentation biology; complement cascade steps; T and B cell development stages; the cytokine a biologic targets rather than which biologic to start, or whether to start one.`,

  peds_dev: `CONTENT DISTRIBUTION: Diagnosis and diagnostic studies 40%, Management 30-35%, Health maintenance and prevention 20-25%, Patient safety and systems 5%.
TIER 1: well-child care — the immunisation schedule, developmental surveillance and screening by age, growth assessment; the febrile infant — age-based evaluation and empiric therapy; neonatal jaundice — evaluation and phototherapy thresholds; bronchiolitis, croup and asthma in children; dehydration assessment and oral versus intravenous rehydration; common infections — otitis media, pharyngitis, urinary tract infection in children.
TIER 2: failure to thrive evaluation; the newborn examination and screening — hearing, critical congenital heart disease, metabolic screening; congenital heart disease recognition and initial management; paediatric abdominal emergencies — pyloric stenosis, intussusception, malrotation, appendicitis; child abuse recognition and reporting; adolescent medicine — confidentiality, contraception, screening; type 1 diabetes presentation; seizures in childhood, including febrile seizures.
TIER 3: precocious and delayed puberty evaluation; short stature workup; paediatric oncology presentation — leukaemia, Wilms tumour, neuroblastoma; Kawasaki disease; nephrotic syndrome in children; lead screening; anticipatory guidance and injury prevention; neonatal abstinence syndrome; sudden infant death prevention counselling.
DIAGNOSTICS: growth chart interpretation, developmental milestone screening instruments, bilirubin nomograms, urinalysis on a catheter specimen in infants, lumbar puncture criteria in the febrile infant, rapid strep and culture, ultrasound for pyloric stenosis and intussusception, echocardiography, newborn screening results, bone age.
MANAGEMENT: immunisation catch-up rules and contraindications, empiric antibiotics in the febrile neonate and infant, phototherapy and exchange transfusion thresholds, supportive care in bronchiolitis and dexamethasone in croup, oral rehydration therapy, amoxicillin dosing in otitis media and the observation option, prostaglandin E1 for duct-dependent lesions, air enema for intussusception, pyloromyotomy, mandatory reporting, contraception and confidentiality in adolescents.
OVERLAP: Repro (neonatal transition, maternal conditions affecting the newborn), Respiratory (bronchiolitis, asthma), ID (paediatric infections, vaccine-preventable disease), Endocrine (type 1 diabetes, growth and puberty).
DRIFT TRAPS: germ layer and pharyngeal arch derivatives; the enzyme deficient in an inborn error rather than the screening result and what to do about it; fetal circulation physiology as the end point; teratogen mechanism; the histology of a paediatric tumour rather than its initial workup.`,
};

/** The brief each track reads for a system. */
export const TRACK_BRIEFS: Record<ExamTrack, Record<SystemKey, string>> = {
  step1: SYSTEM_BRIEFS,
  step2ck: STEP2_SYSTEM_BRIEFS,
};

export interface PlannedQuestion {
  index: number;
  answerLetter: OptionLetter;
  reasoningOrder: ReasoningOrder;
  /**
   * The exam this item is written on. Fixed by the mode for step1 and step2ck;
   * assigned per question for mixed. This, not the model's echo of it, is what
   * persistence stores — see examTrackMix.
   */
  examTrack: ExamTrack;
}

export interface BatchPlan {
  system: SystemKey;
  systemName: string;
  challenge: ChallengeLevel;
  examMode: ExamMode;
  questions: PlannedQuestion[];
}

const LETTERS: OptionLetter[] = ["a", "b", "c", "d", "e"];

/** Fisher-Yates, in place, on a copy. */
function shuffle<T>(values: T[], random: () => number): T[] {
  const pool = [...values];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

/**
 * v13's answer position rule: shuffle a-e, then cycle through the shuffle for
 * the batch length, so no letter repeats until all five have appeared.
 *
 * These letters are a target for permuteToPlannedLetter, not an instruction to
 * the model. Asking the model to write its answer onto an assigned letter was
 * measured to be actively harmful: in a 50-item run it hit the assigned letter
 * 50 times out of 50, and the one item where obeying the letter conflicted with
 * the medicine shipped with a factually wrong answer key — a correct question
 * about the canalicular stage of lung development, keyed to "alveolar stage"
 * because the plan had assigned that position. The model now picks whichever
 * letter is correct and the options are shuffled afterwards, which buys the same
 * flat distribution with none of that risk.
 */
function shuffledLetters(random: () => number): OptionLetter[] {
  return shuffle(LETTERS, random);
}

/**
 * Reasoning order mix.
 *
 * Generated items cluster at Bloom's Remember/Understand tier, so the mix is
 * imposed rather than left to the model. At the default level that is a
 * majority of 2nd-order with one item at each end — for five questions, 1/3/1.
 * The other levels shift the same shape toward one end or the other; see
 * CHALLENGE_MIX. It generalises over count, so a later batch size does not need
 * a second code path.
 *
 * Shuffled across positions, because emitting it in order made every set
 * identical in shape. A measured run put the single 1st-order item at index 1
 * and the 3rd-order item at index 5 in all ten batches, and the model labelled
 * difficulty to match: every Easy item in fifty was its batch's first question
 * and every Hard one was its fourth or fifth. A student who generates two sets
 * learns the ramp and stops reading the early items carefully.
 */
function reasoningOrderMix(
  count: number,
  random: () => number,
  challenge: ChallengeLevel = DEFAULT_CHALLENGE
): ReasoningOrder[] {
  const mixFor = CHALLENGE_MIX[challenge];
  const firsts = Math.max(mixFor.minFirst, Math.round(count * mixFor.first));
  const thirds = Math.max(mixFor.minThird, Math.round(count * mixFor.third));
  const seconds = Math.max(0, count - firsts - thirds);
  const mix = [
    ...Array<ReasoningOrder>(firsts).fill("1st"),
    ...Array<ReasoningOrder>(seconds).fill("2nd"),
    ...Array<ReasoningOrder>(thirds).fill("3rd"),
  ].slice(0, count);

  return shuffle(mix, random);
}

/**
 * Exam track per item.
 *
 * A concrete mode fills the whole wave with its own track. Mixed splits the
 * wave as close to half as it can and shuffles, for the same reason reasoning
 * orders are shuffled: emitted in order, every mixed set would open on the
 * same track and the student would learn the pattern. An odd wave gives its
 * spare item to either track at random, so the split over a whole set is
 * ~50/50 in expectation rather than always favouring one side.
 *
 * Only the mixed branch draws from `random`. That keeps a step1 plan for a
 * given seed identical to what it was before modes existed.
 */
function examTrackMix(count: number, random: () => number, mode: ExamMode): ExamTrack[] {
  if (mode !== "mixed") return Array<ExamTrack>(count).fill(mode);

  const half = Math.floor(count / 2);
  const spare = count - half * 2;
  const step1 = half + (spare && random() < 0.5 ? spare : 0);
  const step2 = count - step1;

  return shuffle(
    [...Array<ExamTrack>(step1).fill("step1"), ...Array<ExamTrack>(step2).fill("step2ck")],
    random
  );
}

/**
 * Builds the per-batch plan the model is required to honour. `random` is
 * injectable so the plan is deterministic under test.
 *
 * `startIndex` exists because a large set is generated as several sequential
 * waves rather than one call, and the index has to stay unique across the whole
 * set: it is what the reconciliation RPC sorts by to put the questions back in
 * the order the plan intended, so a third wave numbering itself 1-5 again would
 * shuffle the student's set. Each wave still shuffles its own letters and
 * reasoning orders, which composes to an even spread across the whole set
 * without the plan needing to know how many waves there are.
 */
export function buildBatchPlan(
  system: SystemKey,
  count: number,
  random: () => number = Math.random,
  startIndex = 1,
  challenge: ChallengeLevel = DEFAULT_CHALLENGE,
  examMode: ExamMode = DEFAULT_EXAM_MODE
): BatchPlan {
  const letters = shuffledLetters(random);
  const orders = reasoningOrderMix(count, random, challenge);
  const tracks = examTrackMix(count, random, examMode);

  return {
    system,
    systemName: SYSTEM_NAMES[system],
    challenge,
    examMode,
    questions: Array.from({ length: count }, (_, i) => ({
      index: startIndex + i,
      answerLetter: letters[i % letters.length],
      reasoningOrder: orders[i],
      examTrack: tracks[i],
    })),
  };
}

/** The shape permuteToPlannedLetter rewrites. Both parsers produce it. */
export interface PermutableQuestion {
  options: Record<OptionLetter, string>;
  correctOption: OptionLetter;
  distractorExplanations: Partial<Record<OptionLetter, string>>;
}

/**
 * The wrong-option explanations, keyed by the letter each one describes.
 *
 * These used to be flattened into the single `explanation` column, because the
 * questions table had nowhere else to put them. The student got the words but
 * lost the association: nothing tied the sentence about option C to option C,
 * and the one explanation that matters most — why the option THEY chose is
 * wrong — sat in the middle of a list. questions.distractor_explanations now
 * holds them keyed by letter, so the player can put each under its own option.
 *
 * The key never gets an entry: an explanation of why the correct answer is
 * wrong is a contradiction, and the QA gate blocks an item that emits one
 * (`distractor-explains-key`). This is the last place it can be stopped before
 * it renders under the option the student got right.
 *
 * Lives here rather than in qbank-persist because it operates on exactly the
 * shape permuteToPlannedLetter rewrites and has to run AFTER it — the two are a
 * pair, and this module is the one both runtimes can import.
 *
 * Empty rather than null when the model wrote none, so a reader can tell "this
 * set wrote none" from "this row predates the column".
 */
export function buildDistractorExplanations(
  question: PermutableQuestion
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of LETTERS) {
    if (k === question.correctOption) continue;
    const text = question.distractorExplanations[k];
    if (text) out[k] = text;
  }
  return out;
}

/**
 * Moves a question's correct answer onto the letter the batch plan wanted.
 *
 * A single swap: whatever sits on the target letter trades places with the key.
 * Everything else keeps its position, so the option order stays as close to what
 * the writer chose as moving one answer allows.
 *
 * `distractorExplanations` is keyed by letter and has to travel with the swap,
 * or the entry explaining why option c is wrong ends up attached to the text
 * that is now option e.
 *
 * This is what replaced telling the model its letters were locked. The batch
 * still gets an even spread of answer positions, and the model never has to
 * choose between the plan and the medicine.
 */
export function permuteToPlannedLetter<T extends PermutableQuestion>(
  question: T,
  target: OptionLetter
): T {
  const from = question.correctOption;
  if (from === target) return question;

  const options = { ...question.options };
  [options[from], options[target]] = [options[target], options[from]];

  const explanations = { ...question.distractorExplanations };
  const fromText = explanations[from];
  const targetText = explanations[target];
  if (targetText === undefined) delete explanations[from];
  else explanations[from] = targetText;
  if (fromText === undefined) delete explanations[target];
  else explanations[target] = fromText;

  return { ...question, options, correctOption: target, distractorExplanations: explanations };
}

/**
 * One line per level, appended to the batch plan.
 *
 * The plan already assigns a reasoning order per item, which is the binding
 * instruction; this only tells the model what the set as a whole is for, so its
 * vignette length and its own difficulty labelling follow the same intent
 * instead of drifting back to the middle.
 *
 * Each level also names a target difficulty band, one level of drift either
 * side permitted. The band is what makes the self-labelled `difficulty` column
 * agree with what the student asked for: difficulty is a target with natural
 * spread, not a strict per-item label. Worded for both tracks — "recall and
 * mechanism" would have been a Step 1 instruction handed to a Step 2 CK set.
 */
const CHALLENGE_BRIEFS: Record<ChallengeLevel, string> = {
  foundations:
    "This set is for consolidating fundamentals. Favour single-step items — one pattern recognised, one answer named — keep vignettes short, and do not stack findings: one clear signal per item. Most items should label themselves Easy; Medium is acceptable, Hard is not.",
  balanced:
    "This set is standard exam calibration: aim for roughly 65-70% correct for a prepared student. Most items should label themselves Medium, with Easy and Hard both acceptable at the edges.",
  challenge:
    "This set is for a student who already knows the fundamentals. Favour multi-step reasoning: make them connect a mechanism to a consequence, or discriminate between two conditions that share a presentation. Do not achieve difficulty by obscurity — the medicine stays high-yield. Most items should label themselves Hard; Medium is acceptable, Easy is not.",
};

export interface UserMessageInput {
  /** The student's free-text topic, verbatim. */
  topic: string;
  plan: BatchPlan;
  /** Subtopics already generated in this session — v13's duplication guard. */
  avoidSubtopics?: string[];
}

/**
 * The System Brief header for one track: which outline, which competency mix,
 * and the brief itself.
 *
 * The Step 1 header is v13's verbatim. Its COMPETENCY BREAKDOWN line is itself
 * an anti-Step-2 guard hiding in the user message — "Management limited to
 * drug or intervention MOA — why it works, never which protocol" — and it
 * would fight every Step 2 CK item, which is why this is per track rather
 * than shared.
 */
function systemBrief(plan: BatchPlan, track: ExamTrack, titleSuffix = ""): string {
  const brief = TRACK_BRIEFS[track][plan.system];
  if (track === "step1") {
    return `## System Brief — ${plan.systemName}${titleSuffix}

SYSTEM: ${plan.systemName}
CONTENT SCOPE: Official 2025 USMLE Content Outline, ${plan.systemName} System
COMPETENCY BREAKDOWN: 60-70% Foundational Science; 20-25% Diagnosis tied to mechanism; 10% Management limited to drug or intervention MOA — why it works, never which protocol.
${brief}`;
  }
  return `## System Brief — ${plan.systemName}${titleSuffix}

SYSTEM: ${plan.systemName}
CONTENT SCOPE: Official 2025 USMLE Step 2 CK Content Outline, ${plan.systemName} System
COMPETENCY BREAKDOWN: 40-50% Diagnosis, including the diagnostic study to order and how to read it; 30-35% Management — pharmacotherapy, clinical interventions and the next best step; 15-20% Prognosis, health maintenance, patient safety and professionalism.
${brief}`;
}

/**
 * The per-request user message: the System Brief(s), the batch plan, and the
 * topic. Everything static lives in QBANK_SYSTEM_PROMPTS so it stays cacheable.
 *
 * A step1 request produces exactly the message it did before modes existed.
 * Mixed injects both briefs and labels each plan row with its track.
 */
export function buildUserMessage({ topic, plan, avoidSubtopics = [] }: UserMessageInput): string {
  const mixed = plan.examMode === "mixed";

  // Answer letters are deliberately NOT sent. They are applied after the fact
  // by permuteToPlannedLetter; telling the model about them only gives it a
  // reason to move a key off the option that is actually correct.
  //
  // The exam track IS sent, and the asymmetry is deliberate: the withheld
  // letter is about answer position, which the model must not bend the
  // medicine to reach, whereas the track is a content instruction the model
  // cannot follow without being told.
  const planRows = plan.questions
    .map((q) =>
      mixed
        ? `- Question ${q.index}: ${EXAM_TRACK_NAMES[q.examTrack]} item, reasoning order ${q.reasoningOrder}`
        : `- Question ${q.index}: reasoning order ${q.reasoningOrder}`
    )
    .join("\n");

  const briefs = mixed
    ? `${systemBrief(plan, "step1", " (Step 1 track)")}

${systemBrief(plan, "step2ck", " (Step 2 CK track)")}`
    : systemBrief(plan, plan.examMode === "step2ck" ? "step2ck" : "step1");

  const trackNote = mixed
    ? "\nEach plan row names its track. Write a Step 1 item to the Step 1 brief and a Step 2 CK item to the Step 2 CK brief, and set examTrack to the track the row assigned.\n"
    : "";

  const avoidBlock = avoidSubtopics.length
    ? `\n## Already covered — do not duplicate\n${avoidSubtopics.map((s) => `- ${s}`).join("\n")}\n`
    : "";

  return `${briefs}

## Batch Plan — ${plan.questions.length} questions

${planRows}

Write each item at the reasoning order assigned to it, and put its correct answer on whichever option is correct.
${trackNote}
${CHALLENGE_BRIEFS[plan.challenge]}
${avoidBlock}
## Requested topic

${topic}

Generate ${plan.questions.length} questions on this topic, within the ${plan.systemName} system and the brief above. If the topic is broader than one item can cover, spread the questions across its highest-yield facets; if it is narrow, approach it from different mechanisms rather than restating it. Return the JSON object only.`;
}

/**
 * Router prompt: maps a student's free-text topic onto one system key.
 *
 * Deliberately a separate cheap call rather than a field the writer model
 * chooses for itself — the System Brief has to be selected before the writing
 * prompt is assembled, and a wrong system means the wrong drift traps and the
 * wrong overlap rules for the whole batch. The thirteen systems serve both
 * exams, so the router is mode-blind.
 */
export const SYSTEM_ROUTER_PROMPT = `You classify a medical study topic into exactly one USMLE organ system.

Systems, by key:
${SYSTEM_KEYS.map((k) => `- ${k}: ${SYSTEM_NAMES[k]}`).join("\n")}

Return ONE JSON object: {"system": "<key>", "confidence": <0-1>}

Use the key exactly as written above. Pick the system whose content outline the topic primarily belongs to, not one it merely touches — a topic about anaemia of chronic kidney disease is heme_onc if it is about the anaemia and renal if it is about the kidney. If the topic is too vague to place, return the closest system with a low confidence rather than refusing.`;
