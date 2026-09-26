/**
 * The per-section pieces of the sheet prompt's output contract: the line each
 * section contributes to the JSON skeleton, and the rules block for tables.
 *
 * Kept apart from medical-notes-prompts.ts, which imports Deno-only modules,
 * so the app's tests can check exactly what the model is shown.
 */
import type { PlannedSection } from "./sheet-plan.ts";

/**
 * One line of the JSON skeleton. A section's brief is written on a single line
 * with escaped newlines, matching how the placeholder has always been given —
 * a literal newline inside a JSON string value would break the shape the model
 * is being shown.
 */
export function schemaLine(section: PlannedSection): string {
  const brief = section.brief.replace(/\n/g, "\\n").replace(/"/g, "'");
  if (section.kind === "table") {
    // Placeholder cells name their column, so the shape shown is the shape
    // wanted; the brief rides in TABLE SECTIONS below, since a JSON row has
    // nowhere to carry it without being mistaken for a cell.
    const cols = section.columns ?? [];
    const row = (cell: (c: string) => string) => `[${cols.map((c) => `"${cell(c)}"`).join(", ")}]`;
    return `  "${section.key}": [\n    ${row((c) => `<${c}>`)},\n    ${row(() => "<...>")}\n  ],`;
  }
  if (section.kind === "list") {
    return `  "${section.key}": [\n    "<${brief} One item per element, no leading number.>",\n    "<...>"\n  ],`;
  }
  return `  "${section.key}": "<${brief}${LABELS_ON_OWN_LINES}>",`;
}

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
