/**
 * The section catalogue and the archetypes that draw on it.
 *
 * The sheet's six sections were a disease template — Mechanism →
 * Pathophysiology → Diagnosis → Workup → Management → Complications. That is
 * the right shape for a condition and the wrong shape for most of what people
 * actually type in. A drug wants mechanism of action, pharmacokinetics,
 * adverse effects and monitoring; an organism wants a stain, virulence factors
 * and transmission; a biochemical pathway wants enzymes, regulation and
 * deficiency states; a statistics topic wants a formula and a worked example,
 * and has no "management" at all. All of them were being forced through
 * "Diagnosis / Management / Complications".
 *
 * An archetype names the kind of thing being studied. Each one has a spine —
 * the sections it always gets — plus sections added by exam mode and by
 * difficulty. That keeps the result scorable (the spine must be present, the
 * total is bounded) while letting the sheet actually differ by topic.
 *
 * The settings bind here rather than in prose. Exam mode and difficulty used
 * to be adjectives the model could ignore; they now change which sections
 * exist, which the model cannot ignore and a scorer can check.
 */

/**
 * How a section's body is shaped. `table` is rows of cells under headers the
 * template fixes, for sections whose items are all the same few facts about
 * each thing — a differential by its distinguishing feature, an enzyme by its
 * cofactor. The model writes only the rows, so it cannot rename, reorder or
 * drop a column.
 */
export type SectionKind = "prose" | "list" | "table";
export type ExamMode = "General" | "USMLE Step 1" | "USMLE Step 2";
export type Difficulty = "Basic" | "Intermediate" | "Advanced";

/**
 * How deep a sheet goes.
 *
 * Every sheet is written as its high-yield core. A comprehensive sheet is the
 * same sheet with its most useful branches grown from it
 * (sheet-branch-prompts.ts), so the high-yield sheet is always what the
 * comprehensive one grew from, and the two can never disagree.
 *
 * The split below between what a section's core holds and what it leaves to
 * `<key>_more` still decides the core: a label outside it (Second-line,
 * Definitive) is left out of the high-yield sheet, and the branch suggestions
 * are pointed at it. Nothing writes `_more` now; depth was written there
 * before branches replaced it.
 *
 * It replaced three lengths (Concise / Moderate / Detailed) that only changed
 * item counts. Counts were the least reliable part of the contract — writers
 * overran or collapsed them — whereas which key a fact is written under is
 * structure, and a high-yield view that filters by key holds even when a
 * writer overshoots.
 */
export type Depth = "highYield" | "comprehensive";

/** The lengths a sheet was made at before depth replaced them. Old clients still send one. */
export type LengthSetting = "Concise" | "Moderate" | "Detailed";

/**
 * The request's depth. A current client sends `depth`; one from before sends
 * `length`, of which only Detailed asked for more than a high-yield sheet.
 */
export function asDepth(depth: unknown, legacyLength?: unknown): Depth {
  if (depth === "highYield" || depth === "comprehensive") return depth;
  return legacyLength === "Detailed" ? "comprehensive" : "highYield";
}

/** The suffix of the key that holds a section's comprehensive depth. */
export const MORE_SUFFIX = "_more";
export const moreKey = (key: string) => `${key}${MORE_SUFFIX}`;

/** A section's high-yield core range, and what comprehensive depth adds to it. */
export interface DepthRange {
  core: [number, number];
  more: [number, number];
}

/**
 * One labelled line of a prose section whose labels are not all high-yield.
 * The ones outside the core at the request's exam mode are left to the
 * section's `_more`.
 */
export interface LabelSpec {
  label: string;
  /** What goes on the line after "Label: ". */
  line: string;
  /** Exam modes at which this label is part of the high-yield core. Absent: every mode. */
  coreAt?: readonly ExamMode[];
  /** A section that takes this label's content over when the plan has it. */
  droppedBy?: string;
}

export interface SectionTemplate {
  key: string;
  title: string;
  kind: SectionKind;
  /** Name from the client's icon vocabulary. */
  icon: string;
  /** Whether a "verified sources" badge may appear on this section. */
  evidenceBacked: boolean;
  /**
   * What the model is told to put here. For a prose section with `labels`,
   * only what comes before them.
   */
  brief: string;
  /**
   * `prose` only — labelled lines split between the core and the depth. A
   * prose section without them keeps its labels in `brief`, all of them core.
   */
  labels?: LabelSpec[];
  /** `prose` with `labels` — said after the labelled lines. */
  tail?: string;
  /**
   * What belongs in this section, in one line, for a prompt that lists every
   * section so a fact can be routed to its home. Defaults to the brief's
   * first sentence, or its labels when the brief opens with them.
   */
  scope?: string;
  /** What this section's `_more` adds, in its own terms. Defaults by kind. */
  more?: string;
  /** `prose` only — the depth's line budget, when the default is too small for it. */
  moreBudget?: string;
  /** `list` and `table` — item (or row) ranges for the core and the depth. */
  items?: DepthRange;
  /** `table` only — the column headers, in order. */
  columns?: string[];
  /**
   * Parts of the brief another section takes over when the plan has it:
   * section key → the exact text to leave out. Without this a plan with its
   * own Complications section also asked Clinical Approach for complications,
   * and the sheet said them twice.
   */
  yieldsTo?: Record<string, string>;
}

/**
 * Item ranges are ceilings with a floor, not quotas. Exact counts made the
 * model pad: once a topic's distinct facts ran out, it filled the remaining
 * slots by restating what earlier sections had said.
 *
 * The core sits between the old Concise and Moderate counts: a high-yield
 * section is chosen by what is tested, not cut to a size, so it gets a little
 * room. Core plus depth lands near the old Detailed.
 *
 * The depth's floor is 1, and deepening every section at once drops it to 0:
 * a floor of 2 made a three-enzyme cofactor table invent rows it had to label
 * "substrate, not cofactor". A section with nothing more worth saying says
 * nothing more.
 */
const LIST_DEFAULT: DepthRange = { core: [2, 4], more: [1, 4] };

const PROSE_CORE_BUDGET = "one or two sentences per label";
const PROSE_MORE_BUDGET = "1 to 5 further labelled lines";

const MORE_DEFAULT: Record<SectionKind, string> = {
  prose:
    "Deeper lines for this section: the mechanism behind its core facts, finer detail, exceptions and special populations.",
  list: "Further items of second rank for this section: the less common, secondary or finer-grained ones its core left out.",
  table: "Further rows of second rank: the less common or less often tested ones its core left out.",
};

export const listItems = (t: SectionTemplate): DepthRange => t.items ?? LIST_DEFAULT;

export const proseBudget = (t: SectionTemplate, part: "core" | "more"): string =>
  part === "core" ? PROSE_CORE_BUDGET : t.moreBudget ?? PROSE_MORE_BUDGET;

/** Leaves out the parts of a brief the plan's other sections cover. */
const withoutYielded = (t: SectionTemplate, planKeys: readonly string[], text: string): string =>
  Object.entries(t.yieldsTo ?? {}).reduce(
    (brief, [key, cut]) => (planKeys.includes(key) ? brief.replace(cut, "") : brief),
    text
  );

/** The labelled lines this plan keeps, at this exam mode, split into core and depth. */
function splitLabels(t: SectionTemplate, planKeys: readonly string[], exam: ExamMode) {
  const kept = (t.labels ?? []).filter((l) => !l.droppedBy || !planKeys.includes(l.droppedBy));
  const isCore = (l: LabelSpec) => !l.coreAt || l.coreAt.includes(exam);
  return { core: kept.filter(isCore), more: kept.filter((l) => !isCore(l)) };
}

const labelLines = (labels: LabelSpec[]) => labels.map((l) => `${l.label}: ${l.line}`).join("\n");

/** The labels a prose brief writes inline, as "Label: text" at the head of a line. */
const inlineLabels = (brief: string): string[] =>
  [...brief.matchAll(/^([A-Z][A-Za-z ,/&-]{0,30}?):[ \t]+\S/gm)].map((m) => m[1]);

/**
 * The labels a prose section's core must write, in reading order, and the
 * ones only its depth may introduce.
 */
export function sectionLabels(
  t: SectionTemplate,
  planKeys: readonly string[],
  exam: ExamMode
): { core: string[]; more: string[] } {
  if (t.kind !== "prose") return { core: [], more: [] };
  if (!t.labels) return { core: inlineLabels(withoutYielded(t, planKeys, t.brief)), more: [] };
  const { core, more } = splitLabels(t, planKeys, exam);
  return { core: core.map((l) => l.label), more: more.map((l) => l.label) };
}

/** What belongs in a section, in one line. */
export function scopeOf(t: SectionTemplate, planKeys: readonly string[], exam: ExamMode = "General"): string {
  if (t.scope) return t.scope;
  const first = t.brief.split(/(?<=\.)\s|\n/)[0].trim();
  // A brief that opens straight into its labels says what it holds by them.
  if (/^Structure it as:?$/i.test(first) || /:\s*$/.test(first)) {
    const { core, more } = sectionLabels(t, planKeys, exam);
    return [...core, ...more].join(", ").toLowerCase();
  }
  return first.replace(/\.$/, "");
}

/** The brief for a section's high-yield core, as this plan needs it. */
export function briefFor(t: SectionTemplate, planKeys: readonly string[], exam: ExamMode = "General"): string {
  if (!t.labels) return withoutYielded(t, planKeys, t.brief);
  const { core } = splitLabels(t, planKeys, exam);
  return withoutYielded(t, planKeys, [t.brief, labelLines(core), t.tail].filter(Boolean).join("\n"));
}

/** The brief for what a comprehensive sheet adds to this section, under `<key>_more`. */
export function moreBriefFor(t: SectionTemplate, planKeys: readonly string[], exam: ExamMode = "General"): string {
  const base = t.more ?? MORE_DEFAULT[t.kind];
  if (t.kind !== "prose") return base;
  const { core, more } = sectionLabels(t, planKeys, exam);
  if (!t.labels || !more.length) {
    return `${base} Start every line with one of this section's labels: ${core.join(", ")}.`;
  }
  const { more: moreSpecs } = splitLabels(t, planKeys, exam);
  return withoutYielded(
    t,
    planKeys,
    `${base} The sub-sections the high-yield core left out, each on its own line — leave out any that does not apply to this topic:\n${labelLines(moreSpecs)}\nThen, if the topic needs it, deeper lines under ${core.join(", ")}.`
  );
}

/** Renders an item range as the phrase the prompt and the checklist both use. */
export const itemPhrase = ([lo, hi]: [number, number]): string =>
  lo === hi ? `exactly ${lo}` : `${lo} to ${hi}`;

const prose = (
  key: string,
  title: string,
  icon: string,
  brief: string,
  extra: Partial<SectionTemplate> = {}
): SectionTemplate => ({ key, title, kind: "prose", icon, evidenceBacked: true, brief, ...extra });

const list = (
  key: string,
  title: string,
  icon: string,
  brief: string,
  extra: Partial<SectionTemplate> = {}
): SectionTemplate => ({ key, title, kind: "list", icon, evidenceBacked: true, brief, ...extra });

const table = (
  key: string,
  title: string,
  icon: string,
  columns: string[],
  brief: string,
  extra: Partial<SectionTemplate> = {}
): SectionTemplate => ({
  key,
  title,
  kind: "table",
  icon,
  evidenceBacked: true,
  brief,
  columns,
  ...extra,
});

/**
 * Every section any archetype can ask for, by key.
 *
 * `overview`, `clinicalApproach`, `memoryHooks`, `keyPoints` and `examTraps`
 * keep the keys, titles and internal structure they have always had, so the
 * condition archetype — the best-tested path by far — keeps its shape.
 *
 * The three closing study aids are not summaries of the sheet. Briefed as
 * "high-yield one-liners" and "things that stick", they restated it: measured
 * across topic kinds, over half of Key Points repeated an earlier section, and
 * a fifth to a third of Memory Hooks and Exam Traps. Each now asks for what
 * the sheet has not yet said, except that a Memory Hook may encode a central
 * fact — the device itself is the new thing, and that is the repetition worth
 * keeping.
 */
export const SECTIONS: Record<string, SectionTemplate> = {
  // ── Shared ────────────────────────────────────────────────────────────────
  overview: prose(
    "overview",
    "Overview",
    "overview",
    `Pathophysiology-first conceptual foundation. Each sub-section on its own line, starting with a \\n before the label:
Mechanism: **Bold the core defect** — one sentence on the cellular or molecular trigger.
Pathophysiology: trace how that defect produces the clinical syndrome. Use arrows → to show flow. Bold **key mechanisms**.
Key associations: a numbered idea per line — **Buzzword** → why it occurs mechanistically. Mechanistic links only; differentials and clinical pearls belong to later sections.
Never put drug names, diagnostic criteria, management steps or investigations here — they belong in other sections only.`,
    {
      scope: "mechanism and pathophysiology only — no drugs, diagnostic criteria, investigations or management",
      more: "Deeper mechanism: the steps between the defect and the syndrome that the core skipped, the body's compensation and why it fails, and the less classic associations with their mechanism. Still no drug names, diagnostic criteria, management steps or investigations.",
    }
  ),
  clinicalApproach: prose(
    "clinicalApproach",
    "Clinical Approach",
    "clinical",
    "The only section with diagnostic criteria, drug names and management steps. Each sub-section on its own line, starting with a \\n before the label:",
    {
      // Which sub-sections are high-yield depends on the exam: Step 2 asks for
      // the best initial test and the contraindication as often as the
      // diagnosis, Step 1 rarely does. What the core leaves out, `_more` holds.
      labels: [
        { label: "Diagnosis", line: "gold standard → what it shows. Key distinguishing findings." },
        { label: "Workup", line: "what to order and why — labs, imaging, scores.", coreAt: ["USMLE Step 2"] },
        { label: "Management", line: "first-line → drug and rationale." },
        { label: "Second-line", line: "when first-line fails or is contraindicated → what and why.", coreAt: [] },
        { label: "Definitive", line: "surgical or specialist triggers.", coreAt: [] },
        {
          label: "Complications",
          line: "what goes wrong if undertreated — bold **the dangerous ones**.",
          coreAt: [],
          droppedBy: "complications",
        },
        { label: "Avoid", line: "interventions or drugs contraindicated here.", coreAt: ["USMLE Step 2", "General"] },
      ],
      tail: "Be the most clinically dense section on the sheet.",
      more: "The clinical depth a comprehensive sheet needs.",
      // Up to five sub-sections the core left out, plus deeper lines under the rest.
      moreBudget: "2 to 7 further labelled lines",
      yieldsTo: { differentials: " Key distinguishing findings." },
    }
  ),
  memoryHooks: list(
    "memoryHooks",
    "Memory Hooks",
    "memory",
    "One memory device per line — a mnemonic, an analogy or a vivid image — each encoding one of the sheet's most central facts. The device is the content: a line that only restates a fact is not a hook.",
    {
      evidenceBacked: false,
      items: { core: [2, 3], more: [1, 2] },
      more: "Devices for important facts the core hooks did not encode — never a second hook for the same fact.",
    }
  ),
  keyPoints: list(
    "keyPoints",
    "Key Points",
    "keypoints",
    'High-yield "If X → think Y" one-liners the sections above did not state — thresholds and numbers, discriminators between look-alikes, next best steps, classic presentations. Never a restatement of an earlier line.',
    {
      items: { core: [3, 5], more: [1, 4] },
      more: 'Second-rank "If X → think Y" one-liners: atypical presentations, secondary discriminators, finer thresholds, special populations. Never a restatement of an earlier line.',
    }
  ),
  examTraps: list(
    "examTraps",
    "Exam Traps",
    "traps",
    "Each trap: the tempting wrong answer or misconception → why it is wrong → what is right. Only mistakes the sheet has not already warned about.",
    {
      evidenceBacked: false,
      items: { core: [2, 3], more: [1, 3] },
      more: "Subtler traps: second-order misconceptions and the distractors that catch students who know the basics. Same format.",
    }
  ),

  // ── Condition ─────────────────────────────────────────────────────────────
  differentials: table(
    "differentials",
    "Differential Diagnosis",
    "compare",
    ["Diagnosis", "Distinguishing feature", "Confirm with"],
    "One row per condition that presents this way: the single feature that separates it from this diagnosis, and the test that settles it."
  ),
  complications: list(
    "complications",
    "Complications",
    "traps",
    "What goes wrong if this is missed or undertreated, and how it is recognised."
  ),

  // ── Drug ──────────────────────────────────────────────────────────────────
  moa: prose(
    "moa",
    "Mechanism of Action",
    "drug",
    `Drug class, molecular target and what the target does when engaged. Structure it as:
Class: the pharmacological class.
Target: **the receptor, enzyme or channel** acted on.
Effect: target engagement → physiological consequence → therapeutic effect. Use arrows →.`
  ),
  pharmacokinetics: prose(
    "pharmacokinetics",
    "Pharmacokinetics",
    "data",
    `Absorption, distribution, metabolism and elimination, only where exam-relevant. Structure it as:
Absorption: route and anything that changes it.
Metabolism: **the enzyme(s)**, and whether it is a prodrug.
Elimination: route, half-life, and what a failing organ does to it.`
  ),
  indications: list(
    "indications",
    "Indications",
    "keypoints",
    "What it is actually used for, first-line uses first."
  ),
  adverseEffects: list(
    "adverseEffects",
    "Adverse Effects",
    "traps",
    "Effects worth knowing, each with the mechanism that causes it. Bold **the dangerous ones**."
  ),
  interactions: table(
    "interactions",
    "Interactions & Contraindications",
    "traps",
    ["Drug or condition", "What happens", "Why"],
    "One row per interacting drug or absolute contraindication. Bold **the dangerous ones**."
  ),
  monitoring: table(
    "monitoring",
    "Monitoring",
    "data",
    ["Parameter", "Target", "When to check"],
    "One row per thing to measure."
  ),

  // ── Organism ──────────────────────────────────────────────────────────────
  microbiology: prose(
    "microbiology",
    "Microbiology & Identification",
    "micro",
    `How it is recognised in the lab. Structure it as:
Morphology: shape, stain and arrangement.
Culture: medium and **the distinguishing growth characteristic**.
Identification: the test that separates it from its nearest look-alike.`
  ),
  virulence: list(
    "virulence",
    "Virulence Factors",
    "micro",
    "Each factor with the mechanism by which it causes disease."
  ),
  transmission: prose(
    "transmission",
    "Transmission & Epidemiology",
    "micro",
    `How it spreads and who gets it. Structure it as:
Reservoir: where it lives between hosts.
Transmission: route.
At risk: **the classic host** and why.`
  ),
  clinicalSyndromes: list(
    "clinicalSyndromes",
    "Clinical Syndromes",
    "clinical",
    "Each disease it causes, with the presentation that identifies it."
  ),
  treatment: prose(
    "treatment",
    "Treatment & Prevention",
    "drug",
    `Structure it as:
First-line: the drug and why it works against this organism.
Resistance: **the mechanism** and what it forces you to use instead.
Prevention: vaccine, prophylaxis or infection control.`
  ),

  // ── Anatomy ───────────────────────────────────────────────────────────────
  structure: prose(
    "structure",
    "Structure & Relations",
    "anatomy",
    `Structure it as:
Structure: what it is and where it sits.
Relations: **what lies immediately around it**, and on which side.
Landmarks: what you find it by.`
  ),
  bloodSupply: list(
    "bloodSupply",
    "Blood Supply & Innervation",
    "anatomy",
    "Arterial supply, venous and lymphatic drainage, and nerve supply — each with its clinical consequence."
  ),
  clinicalCorrelates: list(
    "clinicalCorrelates",
    "Clinical Correlates",
    "clinical",
    "What goes wrong here and the deficit or sign it produces."
  ),

  // ── Pathway ───────────────────────────────────────────────────────────────
  pathwaySteps: prose(
    "pathwaySteps",
    "Pathway & Key Steps",
    "pathway",
    `Structure it as:
Purpose: what the pathway is for, in one sentence.
Steps: substrate → intermediate → product, using arrows →. Bold **the rate-limiting step**.
Location: the cell and compartment it runs in.`
  ),
  regulation: prose(
    "regulation",
    "Regulation",
    "pathway",
    `Structure it as:
Rate-limiting enzyme: **the enzyme**, named once — its controls go under Activators and Inhibitors.
Activators: what turns it up, and the signal behind it.
Inhibitors: what turns it down.`
  ),
  cofactors: table(
    "cofactors",
    "Enzymes & Cofactors",
    "pathway",
    ["Enzyme", "Cofactor", "Without it"],
    "One row per enzyme: its cofactor or vitamin, and what fails without it. Name the enzymes briefly; the cofactor and the failure are the point."
  ),
  deficiencies: table(
    "deficiencies",
    "Deficiency States",
    "traps",
    ["Deficiency", "Accumulates", "Disease"],
    "One row per enzyme or cofactor deficiency: the metabolite that builds up, and the disease that results."
  ),

  // ── Physiology ────────────────────────────────────────────────────────────
  normalFunction: prose(
    "normalFunction",
    "Normal Function",
    "pathway",
    `Structure it as:
Purpose: what this process achieves.
Mechanism: how it works, step by step, using arrows →. Bold **the key determinant**.
Normal values: the numbers worth knowing.`
  ),
  controlLoops: prose(
    "controlLoops",
    "Control & Feedback",
    "pathway",
    `Structure it as:
Sensor: what detects the change.
Response: the loop that corrects it, using arrows →.
Feedback: **negative or positive**, and what happens when it is lost.`
  ),
  curves: list(
    "curves",
    "Curves & Relationships",
    "data",
    "Each curve or relationship: the axes, what shifts it, and which way."
  ),
  dysfunction: list(
    "dysfunction",
    "When It Fails",
    "traps",
    "Each failure mode with the clinical picture it produces."
  ),

  // ── Procedure ─────────────────────────────────────────────────────────────
  contraindications: list(
    "contraindications",
    "Contraindications",
    "traps",
    "Absolute contraindications first, each with the reason."
  ),
  technique: prose(
    "technique",
    "Technique",
    "procedure",
    `Structure it as:
Preparation: position, consent, kit.
Landmarks: **where exactly**, and what you are avoiding.
Steps: the sequence, using arrows →.`
  ),
  aftercare: prose(
    "aftercare",
    "Aftercare & Follow-up",
    "procedure",
    `Structure it as:
Immediately after: what to check and document.
Warning signs: **what means something has gone wrong**.
Follow-up: when and what for.`
  ),

  // ── Investigation ─────────────────────────────────────────────────────────
  principle: prose(
    "principle",
    "Principle",
    "data",
    `Structure it as:
Measures: what the test actually detects.
Basis: **the physical or biochemical principle** behind it.
Limits: what it cannot see.`
  ),
  interpretation: prose(
    "interpretation",
    "Interpretation",
    "data",
    `Structure it as:
Normal: the reference range or normal appearance.
Abnormal: what each abnormal pattern means. Use arrows →.
Threshold: **the number or finding that changes management**.`
  ),
  pitfalls: list(
    "pitfalls",
    "Pitfalls & Limitations",
    "traps",
    "False positives, false negatives and the situations that make the result untrustworthy."
  ),

  // ── Concept ───────────────────────────────────────────────────────────────
  definition: prose(
    "definition",
    "Definition",
    "overview",
    `Structure it as:
Definition: what it means, in plain language.
Why it matters: **the decision it informs**.
Contrast: the concept it is most often confused with, and the difference.`
  ),
  formula: prose(
    "formula",
    "Formula & Worked Example",
    "data",
    `Structure it as:
Formula: the expression, written out.
Worked example: real numbers substituted in, arriving at an answer. Use arrows → between steps.
Reading it: **what the result means** at that value.`
  ),
  application: prose(
    "application",
    "Application",
    "clinical",
    `Structure it as:
In practice: where this is used in a real clinical or research decision.
Interpretation: how the value changes what you do.
Caveat: **when it misleads**.`
  ),
};

export type ArchetypeId =
  | "condition"
  | "drug"
  | "organism"
  | "anatomy"
  | "pathway"
  | "physiology"
  | "procedure"
  | "investigation"
  | "concept";

export interface Archetype {
  id: ArchetypeId;
  /** One line describing it, used in the classifier prompt. */
  hint: string;
  /** Always present, in this order. */
  spine: string[];
  /** Added when the request names this exam mode. */
  byExamMode?: Partial<Record<ExamMode, string[]>>;
  /** Added at this difficulty. */
  byDifficulty?: Partial<Record<Difficulty, string[]>>;
}

/**
 * Nine archetypes. The condition spine is deliberately the five sections a
 * sheet has always had, so the commonest request keeps its tested behaviour
 * and the exam-mode and difficulty additions are the only change.
 */
export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  condition: {
    id: "condition",
    hint: "a disease, syndrome or clinical presentation",
    spine: ["overview", "memoryHooks", "clinicalApproach", "keyPoints", "examTraps"],
    byExamMode: { "USMLE Step 2": ["differentials"] },
    byDifficulty: { Advanced: ["complications"] },
  },
  drug: {
    id: "drug",
    hint: "a drug, a drug class or pharmacological treatment",
    spine: ["moa", "indications", "adverseEffects", "memoryHooks", "examTraps"],
    byExamMode: { "USMLE Step 1": ["pharmacokinetics"], "USMLE Step 2": ["monitoring"] },
    byDifficulty: { Advanced: ["interactions"] },
  },
  organism: {
    id: "organism",
    hint: "a bacterium, virus, fungus or parasite",
    spine: ["microbiology", "clinicalSyndromes", "treatment", "memoryHooks", "examTraps"],
    byExamMode: { "USMLE Step 1": ["virulence"], "USMLE Step 2": ["transmission"] },
    byDifficulty: { Advanced: ["virulence"] },
  },
  anatomy: {
    id: "anatomy",
    hint: "an anatomical structure, region or relationship",
    spine: ["structure", "bloodSupply", "clinicalCorrelates", "memoryHooks"],
    byExamMode: { "USMLE Step 2": ["clinicalCorrelates"] },
    byDifficulty: { Advanced: ["examTraps"] },
  },
  pathway: {
    id: "pathway",
    hint: "a biochemical or metabolic pathway",
    spine: ["pathwaySteps", "regulation", "cofactors", "memoryHooks", "examTraps"],
    byExamMode: { "USMLE Step 1": ["deficiencies"] },
    byDifficulty: { Advanced: ["deficiencies"] },
  },
  physiology: {
    id: "physiology",
    hint: "a normal physiological process or control system",
    spine: ["normalFunction", "controlLoops", "keyPoints", "memoryHooks"],
    byExamMode: { "USMLE Step 2": ["dysfunction"] },
    byDifficulty: { Advanced: ["curves"] },
  },
  procedure: {
    id: "procedure",
    hint: "a clinical procedure, operation or practical skill",
    spine: ["indications", "contraindications", "technique", "complications"],
    byExamMode: { "USMLE Step 2": ["aftercare"] },
    byDifficulty: { Basic: ["memoryHooks"], Advanced: ["examTraps"] },
  },
  investigation: {
    id: "investigation",
    hint: "a diagnostic test, lab assay or imaging modality",
    spine: ["principle", "indications", "interpretation", "pitfalls"],
    byExamMode: { "USMLE Step 2": ["clinicalCorrelates"] },
    byDifficulty: { Advanced: ["examTraps"] },
  },
  concept: {
    id: "concept",
    hint: "a statistics, epidemiology, ethics or health-systems concept",
    spine: ["definition", "application", "pitfalls", "memoryHooks"],
    byExamMode: { "USMLE Step 1": ["formula"] },
    byDifficulty: { Advanced: ["examTraps"] },
  },
};

export const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as ArchetypeId[];

export const DEFAULT_ARCHETYPE: ArchetypeId = "condition";

/** Normalises whatever the classifier said into a known archetype. */
export function asArchetype(raw: unknown): ArchetypeId | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  return (ARCHETYPE_IDS as string[]).includes(cleaned) ? (cleaned as ArchetypeId) : null;
}
