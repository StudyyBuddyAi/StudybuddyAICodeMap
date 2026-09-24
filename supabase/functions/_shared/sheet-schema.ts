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
