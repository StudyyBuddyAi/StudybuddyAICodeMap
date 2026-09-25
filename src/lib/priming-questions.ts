import type { SheetSectionSpec } from "@/types/generated-sheet";

/**
 * The question asked while a sheet is being prepared, before it can be read.
 *
 * Trying to answer a question before reading the material makes the answer
 * stick better afterwards, even when the attempt is wrong (the pretesting
 * effect — Richland, Kornell & Kao, 2009). The wait before a sheet's first
 * words is exactly that moment, so it is spent on a real question about the
 * reader's own topic rather than a generic tip.
 *
 * Once the plan has arrived the question is about the sheet's first section
 * that has one — the mechanism for a drug, the lab picture for an organism —
 * so the answer is the first thing the reader then reads. Before the plan, it
 * is about the topic as a whole.
 */

/** What a topic was read as, for a sentence. Keyed by archetype id. */
export const ARCHETYPE_PHRASES: Record<string, { a: string; this: string }> = {
  condition: { a: "a condition", this: "this condition" },
  drug: { a: "a drug", this: "this drug" },
  organism: { a: "an organism", this: "this organism" },
  anatomy: { a: "a structure", this: "this structure" },
  pathway: { a: "a pathway", this: "this pathway" },
  physiology: { a: "a process", this: "this process" },
  procedure: { a: "a procedure", this: "this procedure" },
  investigation: { a: "a test", this: "this test" },
  concept: { a: "a concept", this: "this concept" },
};

/**
 * A name short enough to put in a question: the topic as typed when it is a
 * name ("Lithium"), otherwise its kind ("this drug"). Pasted notes and
 * questions don't fit inside a sentence.
 */
export function topicName(input: string, archetype?: string): string {
  const line = input.trim().split("\n")[0].trim();
  if (line && line.length <= 40 && !/[?.!:;]$/.test(line)) return line;
  return (archetype && ARCHETYPE_PHRASES[archetype]?.this) || "this topic";
}

/** One question per content section, worded to read with a name or "this …". */
const QUESTIONS: Record<string, (t: string) => string> = {
  overview: (t) => `What goes wrong in ${t}, at the level of cells or molecules?`,
  clinicalApproach: (t) => `What's the first test you'd order for ${t}, and the first-line treatment?`,
  differentials: (t) => `What else could present like ${t}, and what would tell them apart?`,
  complications: (t) => `What goes wrong if ${t} is missed or undertreated?`,
  moa: (t) => `How does ${t} work — what does it act on, and what follows?`,
  pharmacokinetics: (t) => `How is ${t} cleared from the body, and what would change that?`,
  indications: (t) => `What is ${t} actually used for, first-line?`,
  adverseEffects: (t) => `Which side effects of ${t} would worry you most, and why?`,
  interactions: (t) => `Which drugs or conditions make ${t} dangerous?`,
  monitoring: (t) => `What would you monitor in a patient on ${t}, and how often?`,
  microbiology: (t) => `How would the lab identify ${t}?`,
  virulence: (t) => `How does ${t} cause disease?`,
  transmission: (t) => `How does ${t} spread, and who is most at risk?`,
  clinicalSyndromes: (t) => `Which diseases does ${t} cause?`,
  treatment: (t) => `What would you treat ${t} with — and what if it's resistant?`,
  structure: (t) => `Where exactly is ${t}, and what lies around it?`,
  bloodSupply: (t) => `What supplies ${t}, and what happens if that supply is cut?`,
  clinicalCorrelates: (t) => `What deficit would damage to ${t} produce?`,
  pathwaySteps: (t) => `What goes into ${t}, what comes out, and where in the cell does it run?`,
  regulation: (t) => `What is the rate-limiting step of ${t}, and what controls it?`,
  cofactors: (t) => `Which vitamins or cofactors does ${t} depend on?`,
  deficiencies: (t) => `What happens when an enzyme in ${t} is missing?`,
  normalFunction: (t) => `What is ${t} for, and how does it work?`,
  controlLoops: (t) => `What senses a change in ${t}, and what corrects it?`,
  curves: (t) => `What shifts the key curve in ${t}, and which way?`,
  dysfunction: (t) => `What does it look like when ${t} fails?`,
  contraindications: (t) => `When should ${t} never be done?`,
  technique: (t) => `Walk through ${t} step by step — where do you start?`,
  aftercare: (t) => `What would you check after ${t}?`,
  principle: (t) => `What does ${t} actually measure?`,
  interpretation: (t) => `What result on ${t} would change what you do?`,
  pitfalls: (t) => `When would ${t} give you a misleading answer?`,
  definition: (t) => `How would you define ${t} in one sentence?`,
  formula: (t) => `Can you write out the formula for ${t}?`,
  application: (t) => `Where does ${t} change a real clinical decision?`,
};

export function primingQuestion(
  input: string,
  plan: readonly SheetSectionSpec[] | null | undefined,
  archetype?: string
): string {
  const t = topicName(input, archetype);
  const section = plan?.find((s) => QUESTIONS[s.key]);
  if (section) return QUESTIONS[section.key](t);
  return `What do you already know about ${t}? Name three things — the sheet will show you how you did.`;
}

/** Whether a section has its own question — for tests and the catalogue check. */
export const hasPrimingQuestion = (key: string) => key in QUESTIONS;
