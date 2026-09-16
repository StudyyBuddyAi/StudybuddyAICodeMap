/**
 * The comparison set: every medical-notes mode the client uses, with the
 * request bodies shaped exactly as the client sends them (SheetGenerator,
 * FlashcardsGenerator, StudyMode, OutputSection).
 *
 * Topics span systems, personas, lengths and input styles (a topic name, a
 * student's vernacular question, a pasted block of notes), and include topics
 * the guideline corpus is likely to cover and ones it likely does not, so both
 * the grounded and ungrounded prompt branches get exercised.
 */

export type Kind = "sheet" | "cards" | "explain" | "expand" | "clinical";

export interface EvalCase {
  id: string;
  kind: Kind;
  /** One line for the report. */
  label: string;
  body: Record<string, unknown>;
}

const sheet = (id: string, label: string, notes: string, persona: string, examMode: string, length: string, difficulty = "Intermediate", focus = "Deep Understanding"): EvalCase => ({
  id, kind: "sheet", label,
  body: { notes, persona, examMode, length, difficulty, focus, useGrounding: true, topK: 8, threshold: 0.6, useMemory: false },
});

const cards = (id: string, label: string, notes: string, cardCount: number, examMode = "USMLE Step 1"): EvalCase => ({
  id, kind: "cards", label,
  body: { notes, examMode, difficulty: "Basic", focus: "Quick Revision", length: "Concise", cardsOnly: true, cardCount, useGrounding: true, topK: 8, threshold: 0.6, useMemory: false },
});

const explain = (id: string, question: string, answer: string, topic: string): EvalCase => ({
  id, kind: "explain", label: `Explain: ${question.slice(0, 60)}`,
  body: { notes: `CARD QUESTION: ${question}\n\nCARD ANSWER: ${answer}\n\nTOPIC CONTEXT: ${topic}`, examMode: "General", explainMode: true, useMemory: false },
});

const enhance = (id: string, mode: "expand" | "clinical", topic: string, sectionKey: string, itemText: string): EvalCase => ({
  id, kind: mode, label: `${mode === "expand" ? "Expand" : "Clinical"}: ${itemText.slice(0, 60)}`,
  body: { enhanceMode: mode, itemText, sectionKey, sectionItems: [], enhanceTopic: topic, notes: itemText, useMemory: false },
});

export const CASES: EvalCase[] = [
  sheet("sheet-hfref", "HFrEF · student · Step 1 · Concise", "Heart failure with reduced ejection fraction", "student", "USMLE Step 1", "Concise", "Basic", "Quick Revision"),
  sheet("sheet-dka", "DKA · clinician · Step 2 · Moderate", "Diabetic ketoacidosis", "clinician", "USMLE Step 2", "Moderate", "Intermediate", "Clinical Reasoning"),
  sheet("sheet-nephro", "Nephrotic vs nephritic · expert · General · Detailed", "Nephrotic vs nephritic syndrome", "expert", "General", "Detailed", "Advanced", "Deep Understanding"),
  sheet("sheet-asthma-notes", "Pasted asthma notes · student · Moderate", "asthma - reversible airway obstruction, type 2 inflam (eos, IL-4/5/13), triggers allergens/cold/exercise. wheeze worse at night. spirometry FEV1/FVC low, improves >12% w/ bronchodilator. tx SABA prn, ICS mainstay, add LABA. severe exacerbation: silent chest bad sign, give O2 nebs steroids mag", "student", "General", "Moderate", "Basic", "Quick Revision"),
  sheet("sheet-preeclampsia", "Preeclampsia · clinician · Step 2 · Concise", "Preeclampsia", "clinician", "USMLE Step 2", "Concise", "Intermediate", "Clinical Reasoning"),
  // Most topics retrieve nothing at the production 0.60 threshold; this one
  // retrieves, so the grounded branch of the prompt gets exercised.
  sheet("sheet-ida-grounded", "Iron deficiency anemia · student · Step 1 · Moderate (grounded)", "Iron deficiency anemia", "student", "USMLE Step 1", "Moderate", "Intermediate", "Deep Understanding"),
  sheet("sheet-hyperk-vernacular", "\"why does hyperkalemia change the ECG\" · student · Concise", "i dont get why high potassium changes the ECG and what to do about it", "student", "USMLE Step 1", "Concise", "Basic", "Deep Understanding"),

  cards("cards-sepsis", "Sepsis management · 10 cards · Step 2", "Sepsis and septic shock management", 10, "USMLE Step 2"),
  cards("cards-bb", "Beta blockers · 12 cards · Step 1", "Beta blockers pharmacology", 12),
  cards("cards-ida", "Iron deficiency anemia · 8 cards · Step 1", "Iron deficiency anemia", 8),

  explain("explain-digoxin", "A patient on digoxin develops nausea, yellow-tinted vision and bidirectional ventricular tachycardia. Which electrolyte abnormality most increases the risk of this toxicity?", "Hypokalemia — low potassium increases digoxin binding to the Na+/K+-ATPase.", "Digoxin toxicity"),
  explain("explain-sah", "A 45-year-old has a thunderclap headache; non-contrast CT at 10 hours is negative. What is the next step?", "Lumbar puncture looking for xanthochromia.", "Subarachnoid hemorrhage"),
  explain("explain-cushing", "Which test distinguishes pituitary Cushing disease from ectopic ACTH production?", "High-dose dexamethasone suppression test — pituitary ACTH suppresses, ectopic does not.", "Cushing syndrome"),

  enhance("expand-afterload", "expand", "Heart failure with reduced ejection fraction", "keyPoints", "If HFrEF → ACE inhibitors reduce mortality by lowering afterload and blocking remodeling"),
  enhance("expand-anion-gap", "expand", "Diabetic ketoacidosis", "overview", "Key associations: high anion gap metabolic acidosis from ketoacid accumulation"),
  enhance("expand-mg", "expand", "Preeclampsia", "clinicalApproach", "Magnesium sulfate for seizure prophylaxis in preeclampsia with severe features"),
  enhance("clinical-kussmaul", "clinical", "Diabetic ketoacidosis", "keyPoints", "Kussmaul respirations are respiratory compensation for metabolic acidosis"),
  enhance("clinical-peaked-t", "clinical", "Hyperkalemia", "keyPoints", "Peaked T waves are the earliest ECG sign of hyperkalemia"),
  enhance("clinical-ics", "clinical", "Asthma", "clinicalApproach", "Inhaled corticosteroids are the mainstay of persistent asthma control"),

  // ── Added for the configuration check (round 3): every persona × length
  // combination not covered above, more systems, and more of the short modes.
  sheet("sheet-copd-expert", "COPD exacerbation · expert · Step 2 · Detailed", "Acute exacerbation of COPD", "expert", "USMLE Step 2", "Detailed", "Advanced", "Clinical Reasoning"),
  sheet("sheet-stroke-clinician", "Acute ischemic stroke · clinician · General · Moderate", "Acute ischemic stroke: thrombolysis and thrombectomy decisions", "clinician", "General", "Moderate", "Intermediate", "Clinical Reasoning"),
  sheet("sheet-warfarin-student", "Warfarin · student · Step 1 · Concise", "Warfarin mechanism, monitoring and reversal", "student", "USMLE Step 1", "Concise", "Basic", "Quick Revision"),
  sheet("sheet-siadh-vernacular", "\"I keep confusing SIADH and DI\" · student · Moderate", "i keep mixing up SIADH and diabetes insipidus, how do i tell them apart", "student", "USMLE Step 1", "Moderate", "Intermediate", "Deep Understanding"),
  sheet("sheet-meningitis-expert", "Bacterial meningitis · expert · General · Concise", "Bacterial meningitis", "expert", "General", "Concise", "Advanced", "Quick Revision"),

  cards("cards-aki", "Acute kidney injury · 10 cards · Step 2", "Acute kidney injury", 10, "USMLE Step 2"),
  cards("cards-thyroid", "Thyroid disorders · 8 cards · Step 1", "Hyperthyroidism and hypothyroidism", 8),
  cards("cards-anticoag", "Anticoagulants · 12 cards · Step 1", "Anticoagulant pharmacology", 12),

  explain("explain-tension-ptx", "A trauma patient has hypotension, tracheal deviation and absent breath sounds on the left. What is the immediate next step?", "Needle decompression of the left chest.", "Tension pneumothorax"),
  explain("explain-ssri", "A patient started on linezolid while taking sertraline develops clonus, hyperthermia and agitation. What is the mechanism?", "Serotonin syndrome — linezolid is a weak MAO inhibitor that raises serotonin with the SSRI.", "Serotonin syndrome"),

  enhance("expand-frank-starling", "expand", "Heart failure with reduced ejection fraction", "overview", "Frank-Starling curve flattens in systolic failure"),
  enhance("clinical-troponin", "clinical", "Acute coronary syndrome", "clinicalApproach", "High-sensitivity troponin rising above the 99th percentile confirms myocardial injury"),
  enhance("clinical-lithium", "clinical", "Lithium toxicity", "examTraps", "Thiazides and NSAIDs raise lithium levels"),
];

/**
 * Arms. Each tier's baseline is what medical-notes runs today, with the prompt
 * family it runs with; Corti candidates in a tier get that same family.
 */
export interface Arm {
  id: string;
  tier: "premium" | "standard";
  provider: "openrouter" | "corti";
  model: string;
  family: "haiku" | "gptOss";
  prompts: "original" | "tuned";
  baseline?: boolean;
  /** Sampling temperature sent to the function; production uses 0.7. */
  temperature?: number;
  /** Client-side request timeout. A timeout counts as a result, not a retry. */
  timeoutMs?: number;
  /** Repeats per case for this arm, overriding NOTES_EVAL_SAMPLES. */
  samples?: number;
}

export const ARMS: Arm[] = [
  { id: "P0-haiku", tier: "premium", provider: "openrouter", model: "anthropic/claude-haiku-4.5", family: "haiku", prompts: "original", baseline: true },
  { id: "P1-s1i", tier: "premium", provider: "corti", model: "corti-s1-instant", family: "haiku", prompts: "original" },
  { id: "P2-mini-i", tier: "premium", provider: "corti", model: "corti-s1-mini-instant", family: "haiku", prompts: "original" },
  { id: "S0-gptoss", tier: "standard", provider: "openrouter", model: "openai/gpt-oss-20b", family: "gptOss", prompts: "original", baseline: true },
  { id: "S1-mini-i", tier: "standard", provider: "corti", model: "corti-s1-mini-instant", family: "gptOss", prompts: "original" },
  { id: "S2-mini", tier: "standard", provider: "corti", model: "corti-s1-mini", family: "gptOss", prompts: "original" },
  { id: "S3-tiny-i", tier: "standard", provider: "corti", model: "corti-s1-tiny-instant", family: "gptOss", prompts: "original" },

  // ── Round 3: confirm the shipping configuration ─────────────────────────────
  // Premium: corti-s1-instant with tuned prompts at production temperature vs
  // 0.3, and corti-s1 (the reasoning variant — Corti's only "more powerful"
  // option) behind a hard latency gate.
  { id: "R-s1i-t07", tier: "premium", provider: "corti", model: "corti-s1-instant", family: "haiku", prompts: "tuned", temperature: 0.7 },
  { id: "R-s1i-t03", tier: "premium", provider: "corti", model: "corti-s1-instant", family: "haiku", prompts: "tuned", temperature: 0.3 },
  { id: "R-s1-reason", tier: "premium", provider: "corti", model: "corti-s1", family: "haiku", prompts: "tuned", temperature: 0.7, timeoutMs: 120_000, samples: 1 },
  // Free: GPT-OSS with its original prompts vs the Corti-tuned edits.
  { id: "R-gptoss-orig", tier: "standard", provider: "openrouter", model: "openai/gpt-oss-20b", family: "gptOss", prompts: "original", temperature: 0.7 },
  { id: "R-gptoss-tuned", tier: "standard", provider: "openrouter", model: "openai/gpt-oss-20b", family: "gptOss", prompts: "tuned", temperature: 0.7 },
];

/** USD per 1M tokens. Corti from its model list; OpenRouter list prices at time of writing. */
export const PRICES: Record<string, { in: number; out: number; note?: string }> = {
  "anthropic/claude-haiku-4.5": { in: 1, out: 5 },
  "openai/gpt-oss-20b": { in: 0.04, out: 0.15, note: "approx. OpenRouter Cerebras/Groq" },
  "corti-s1": { in: 2, out: 8 },
  "corti-s1-instant": { in: 2, out: 8 },
  "corti-s1-mini": { in: 1, out: 4 },
  "corti-s1-mini-instant": { in: 1, out: 4 },
  "corti-s1-tiny": { in: 0, out: 0, note: "unpriced / undocumented" },
  "corti-s1-tiny-instant": { in: 0, out: 0, note: "unpriced / undocumented" },
};
