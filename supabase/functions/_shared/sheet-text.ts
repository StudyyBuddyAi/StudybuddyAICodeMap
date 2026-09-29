/**
 * A sheet's text as its sections — read the same way on both sides.
 *
 * The page parses the sheet a writer streams, and keeps what it parsed. The
 * edge function signs each section of a finished sheet (sheet-signature.ts)
 * and later checks that what a follow-up request sends is what it wrote. For
 * those to agree byte for byte, both read the text with this one module:
 * src/lib/parse-partial-sheet.ts builds its sections here, and so does the
 * handler.
 *
 * No imports and no Deno or DOM APIs, so Deno and Vite both load it.
 */
import { repairLlmJson } from "./repair-llm-json.ts";

/** A section's body: prose, a list, or a table's rows. */
export type SheetSectionBody = string | string[] | string[][];

/**
 * Strip the markdown fence some models wrap around JSON output.
 *
 * The opening and closing fences are handled independently, so this works on
 * partial stream text (where the closing fence hasn't been emitted yet) as
 * well as on a finished response.
 */
export function stripFences(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
  }
  // The closing fence only exists once the model has finished.
  return cleaned.replace(/\s*```$/, "").trim();
}

/**
 * Top-level keys of the sheet JSON that carry metadata rather than a section
 * body. Everything else becomes a section.
 */
export const RESERVED_SHEET_KEYS: ReadonlySet<string> = new Set([
  "topic",
  "topicEmoji",
  "plan",
  "sections",
  "flashcards",
  "referenceNote",
  "sourceCoverage",
  "enhancements",
  "grounded",
  "sources",
  "groundingLevel",
  "retrievedChunks",
  "premium",
  "premiumGrant",
  "signature",
  "depth",
  "depthFailed",
  "covered",
]);

/**
 * GPT-OSS writes some labels with a non-breaking hyphen ("Second‑line"), which
 * the renderer's label pattern — and a reader's search — miss.
 */
const dashes = (s: string) => s.replace(/[‐‑]/g, "-");

const asStringArray = (v: unknown[]): string[] => v.filter((item): item is string => typeof item === "string");

/**
 * A table's rows when the array holds arrays, list items otherwise. Mid-stream
 * the last row may be short a cell or two; it is kept, and the renderer pads.
 */
function asItemsOrRows(value: unknown[]): string[] | string[][] {
  const rows = value.filter((v): v is unknown[] => Array.isArray(v));
  if (rows.length && rows.length === value.length) {
    return rows.map((row) => row.map((cell) => (typeof cell === "string" ? dashes(cell) : "")));
  }
  return asStringArray(value).map(dashes);
}

/**
 * Every top-level key that isn't reserved metadata, coerced by the shape it
 * arrived in.
 *
 * This is what lets a sheet carry sections the six-field interface never named.
 * The old allowlist silently discarded them, so loosening the prompt alone
 * would have produced sheets with sections missing and no error anywhere.
 */
export function sheetSections(raw: Record<string, unknown>): Record<string, SheetSectionBody> {
  const sections: Record<string, SheetSectionBody> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (RESERVED_SHEET_KEYS.has(key)) continue;
    if (typeof value === "string") sections[key] = dashes(value);
    else if (Array.isArray(value)) sections[key] = asItemsOrRows(value);
  }
  return sections;
}

function tryParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * A finished sheet's sections, as the page reads a complete one: exactly as
 * sent, or with the model's escaping repaired. Null when neither parses — the
 * page salvages what it can from such a sheet, and the server signs nothing.
 */
export function finishedSheetSections(text: string): Record<string, SheetSectionBody> | null {
  const clean = stripFences(text);
  if (!clean.startsWith("{")) return null;
  const parsed = tryParse(clean) ?? tryParse(repairLlmJson(clean));
  return parsed ? sheetSections(parsed) : null;
}
