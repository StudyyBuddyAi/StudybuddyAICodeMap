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
export type LengthSetting = "Concise" | "Moderate" | "Detailed";
export type ExamMode = "General" | "USMLE Step 1" | "USMLE Step 2";
export type Difficulty = "Basic" | "Intermediate" | "Advanced";

export interface SectionTemplate {
  key: string;
  title: string;
  kind: SectionKind;
  /** Name from the client's icon vocabulary. */
  icon: string;
  /** Whether a "verified sources" badge may appear on this section. */
  evidenceBacked: boolean;
  /** What the model is told to put here. */
  brief: string;
  /** `list` and `table` — item (or row) count range per length. */
  items?: Record<LengthSetting, [number, number]>;
  /** `table` only — the column headers, in order. */
  columns?: string[];
  /** `prose` only — sentence budget per length. */
  sentences?: Record<LengthSetting, string>;
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
 */
const LIST_DEFAULT: Record<LengthSetting, [number, number]> = {
  Concise: [2, 3],
  Moderate: [3, 5],
  Detailed: [4, 8],
};

const PROSE_DEFAULT: Record<LengthSetting, string> = {
  Concise: "2-3 sentences",
  Moderate: "3-5 sentences",
  Detailed: "5-8 sentences",
};

export const listItems = (t: SectionTemplate, len: LengthSetting): [number, number] =>
  (t.items ?? LIST_DEFAULT)[len];

export const proseBudget = (t: SectionTemplate, len: LengthSetting): string =>
  (t.sentences ?? PROSE_DEFAULT)[len];

/** The brief as this plan needs it: minus what the plan's other sections cover. */
export const briefFor = (t: SectionTemplate, planKeys: readonly string[]): string =>
  Object.entries(t.yieldsTo ?? {}).reduce(
    (brief, [key, text]) => (planKeys.includes(key) ? brief.replace(text, "") : brief),
    t.brief
  );

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
Never put drug names, diagnostic criteria, management steps or investigations here — they belong in other sections only.`
  ),
  clinicalApproach: prose(
    "clinicalApproach",
    "Clinical Approach",
    "clinical",
    `The only section with diagnostic criteria, drug names and management steps. Each sub-section on its own line, starting with a \\n before the label:
Diagnosis: gold standard → what it shows. Key distinguishing findings.
Workup: what to order and why — labs, imaging, scores.
Management: first-line → drug and rationale. Second-line → when and why to escalate. Definitive → surgical or specialist triggers.
Complications: what goes wrong if undertreated — bold **the dangerous ones**.
Avoid: interventions or drugs contraindicated here.
Be the most clinically dense section on the sheet.`,
    {
      sentences: { Concise: "Diagnosis and first-line Management only — omit Workup, Second-line, Definitive and Avoid entirely", Moderate: "every sub-section at moderate depth", Detailed: "every sub-section fully expanded, with edge cases" },
      yieldsTo: {
        complications: "\nComplications: what goes wrong if undertreated — bold **the dangerous ones**.",
        differentials: " Key distinguishing findings.",
      },
    }
  ),
  memoryHooks: list(
    "memoryHooks",
    "Memory Hooks",
    "memory",
    "One memory device per line — a mnemonic, an analogy or a vivid image — each encoding one of the sheet's most central facts. The device is the content: a line that only restates a fact is not a hook.",
    { evidenceBacked: false, items: { Concise: [2, 3], Moderate: [2, 4], Detailed: [3, 5] } }
  ),
  keyPoints: list(
    "keyPoints",
    "Key Points",
    "keypoints",
    'High-yield "If X → think Y" one-liners the sections above did not state — thresholds and numbers, discriminators between look-alikes, next best steps, classic presentations. Never a restatement of an earlier line.',
    { items: { Concise: [3, 5], Moderate: [4, 8], Detailed: [5, 10] } }
  ),
  examTraps: list(
    "examTraps",
    "Exam Traps",
    "traps",
    "Each trap: the tempting wrong answer or misconception → why it is wrong → what is right. Only mistakes the sheet has not already warned about.",
    { evidenceBacked: false, items: { Concise: [2, 3], Moderate: [3, 4], Detailed: [3, 6] } }
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
