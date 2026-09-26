/**
 * The per-section pieces of the sheet prompt's output contract: the line each
 * section contributes to the JSON skeleton, and the rules block for tables.
 *
 * Kept apart from medical-notes-prompts.ts, which imports Deno-only modules,
 * so the app's tests can check exactly what the model is shown.
 */
import type { PlannedSection } from "./sheet-plan.ts";
import { moreKey, type ExamMode } from "./sheet-sections.ts";

/**
 * One line of the JSON skeleton: a section's high-yield core, or — `more` —
 * what a comprehensive sheet adds to it under `<key>_more`. A brief is written
 * on a single line with escaped newlines, matching how the placeholder has
 * always been given — a literal newline inside a JSON string value would break
 * the shape the model is being shown.
 */
export function schemaLine(section: PlannedSection, part: "core" | "more" = "core"): string {
  const key = part === "core" ? section.key : moreKey(section.key);
  const text = part === "core" ? section.brief : section.moreBrief;
  const brief = text.replace(/\n/g, "\\n").replace(/"/g, "'");
  if (section.kind === "table") {
    // Placeholder cells name their column, so the shape shown is the shape
    // wanted; the brief rides in TABLE SECTIONS below, since a JSON row has
    // nowhere to carry it without being mistaken for a cell.
    const cols = section.columns ?? [];
    const row = (cell: (c: string) => string) => `[${cols.map((c) => `"${cell(c)}"`).join(", ")}]`;
    return `  "${key}": [\n    ${row((c) => `<${c}>`)},\n    ${row(() => "<...>")}\n  ],`;
  }
  if (section.kind === "list") {
    return `  "${key}": [\n    "<${brief} One item per element, no leading number.>",\n    "<...>"\n  ],`;
  }
  return `  "${key}": "<${brief}${part === "core" ? LABELS_ON_OWN_LINES : MORE_LINES_APART}>",`;
}

/**
 * A prose depth adds lines under whichever labels need them, so it is not
 * told to write every label — only to keep each line apart.
 */
const MORE_LINES_APART =
  " Every line starts with its label, on its own line, after a \\n. Do not merge them into a paragraph.";

/**
 * What each exam tests most. "High-yield" was the one word every sheet prompt
 * used and none defined, so a short sheet held the first facts the model
 * thought of rather than the ones the exam asks about. AMBOSS makes the same
 * call relative to the student's exam; the exam mode is the nearest thing a
 * sheet has to that.
 */
const TESTED: Record<ExamMode, string> = {
  "USMLE Step 1":
    "USMLE Step 1 tests it often — the mechanism, the classic association or buzzword, the enzyme, receptor or gene involved, a drug's target and its signature adverse effect",
  "USMLE Step 2":
    "USMLE Step 2 tests it often — the likeliest diagnosis from a presentation, the best initial and the most accurate test, the next best step (including what to do when first-line fails), first-line treatment, the contraindication",
  General:
    "a clinician must know it — the red flags, the first-line management, the numbers that change management",
};

/** The test a fact must pass to be high-yield, for this exam. */
export function highYieldTest(exam: ExamMode): string {
  return `WHAT COUNTS AS HIGH-YIELD — a fact is high-yield only if at least one of these is true:
- ${TESTED[exam]}.
- It separates this topic from what it is most often confused with.
- It changes a decision: a threshold, a cut-off, a first-line choice.
- Missing it harms a patient: a can't-miss complication or contraindication.
Not high-yield unless the exam tests it directly: prevalence figures, history and eponym origins, rare variants, third-line options, and pathophysiology beyond the one causal chain that explains the presentation.`;
}

/**
 * Every sheet is written high-yield. A comprehensive sheet is this sheet plus
 * a second call that writes each section's depth from it — asked for both in
 * one pass, the writer shared the facts out between core and depth, so the
 * core stopped being the high-yield sheet (see sheet-section-prompts.ts).
 */
export const HIGH_YIELD_ONLY = `DEPTH — High-yield. Write only the facts that pass the test above. Leave out everything that does not, even where a count below would allow more. A short sheet of the right facts beats a full one padded with the wrong ones.`;

/**
 * Appended to every prose section's brief.
 *
 * Measured across topic kinds, the sections that reliably produced all their
 * labelled lines were the two whose briefs said this outright; the archetype
 * sections, which only said "Structure it as:", wrote the first label and then
 * ran on in prose — Microbiology gave Morphology but not Culture or
 * Identification, Technique gave Preparation but not Landmarks or Steps.
 * Saying it once here beats repeating it in seventeen briefs.
 */
const LABELS_ON_OWN_LINES =
  " Every label above starts on its own line, after a \\n. Write all of them. Do not merge them into a paragraph.";

/**
 * Each fact on the sheet has one home.
 *
 * Nothing in the prompt used to say so, and each section's brief is read on
 * its own, so the model re-served the same dozen facts in every format the
 * plan offered: a mechanism, then an "If X → Y" line, then a mnemonic, then a
 * trap. Measured on thirteen topics, about a quarter of a sheet's facts
 * repeated an earlier section, and most of those repeats were not the facts
 * worth repeating. On a Concise sheet they crowded out facts it never got to.
 *
 * The one repetition kept on purpose is a Memory Hook that encodes a central
 * fact: re-encoding is the hook's job, and a central fact is the one worth it.
 */
export const ONE_HOME_PER_FACT = `ONE HOME PER FACT — the sheet must not repeat itself:
- Write each fact once, in the first section whose brief it fits. A later section must not state it again — not reworded, not recast as an "If X → Y" line, not re-listed in a table row or an exam trap.
- The study aids at the end are not a summary of the sheet. Key Points carry high-yield facts the sections above did not state. Exam Traps name a specific wrong answer or misconception and why it is wrong.
- The one deliberate exception: a Memory Hook may encode one of the sheet's two or three most central facts, because the hook itself — the mnemonic, analogy or image — is the new thing. A hook that only restates a fact is not a hook.
- Before writing each section, check what the sheet has already said, and spend that section's items on what is not yet on the page.`;


/**
 * The rules for the plan's table sections, or nothing when it has none — so a
 * sheet without a table is prompted exactly as it was before tables existed.
 */
export function tableRulesBlock(plan: PlannedSection[]): string {
  const tables = plan.filter((s) => s.kind === "table" && s.columns?.length);
  if (!tables.length) return "";
  const lines = tables
    .map((s) => `- ${s.key} (${s.columns!.join(" | ")}): ${s.brief}`)
    .join("\n");
  return `

TABLE SECTIONS — each of these keys holds an array of rows, and each row is an
array of strings, one per column, in the column order given. Exactly one string
per column in every row: no header row, no empty cells, no extra cells. Keep a
cell to a short phrase; **bold** its key term where it helps.
${lines}`;
}
