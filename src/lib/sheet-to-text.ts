import type { GeneratedSheet } from "@/types/generated-sheet";
import { bodyLines, isTableRows, resolvePlan, sectionBody } from "@/lib/sheet-plan";

/**
 * Flattens a generated sheet into plain text suitable for the clipboard or the
 * Web Share API. Legacy sheets are stored as a raw text blob, so those are
 * passed straight through.
 */
export function sheetToPlainText(
  sheet: GeneratedSheet | null,
  legacyOutput: string,
  topic: string,
  /** More sections, before the footer — the student's notes. */
  extra: string[] = [],
  /** Which sections' depth is on screen, and so goes with the text. */
  depthShown: (key: string) => boolean = () => false
): string {
  if (!sheet) return legacyOutput ?? "";

  const title = sheet.topic?.trim() || topic.trim() || "Study sheet";
  const parts: string[] = [`${title}\n${"=".repeat(title.length)}`];

  // Headings and order come from the sheet's own plan, so an exported sheet
  // always matches what was on screen — including archetype sections this
  // build has no name for.
  for (const { key, title, columns } of resolvePlan(sheet)) {
    // The section, then its depth under a heading of its own when shown.
    const bodies: [string, string][] = [[title, key]];
    if (depthShown(key)) bodies.push([`${title} — in depth`, `${key}_more`]);
    for (const [heading, bodyKey] of bodies) {
      const value = sectionBody(sheet, bodyKey);
      if (isTableRows(value)) {
        // Pipe-separated under its header line, which pastes legibly anywhere
        // and as a table into anything that reads Markdown.
        const header = columns?.length ? [columns.join(" | ")] : [];
        parts.push(`${heading}\n` + [...header, ...bodyLines(value)].join("\n"));
      } else if (Array.isArray(value)) {
        if (!value.length) continue;
        parts.push(
          `${heading}\n` + value.map((item, i) => `${i + 1}. ${item}`).join("\n")
        );
      } else if (typeof value === "string" && value.trim()) {
        parts.push(`${heading}\n${value.trim()}`);
      }
    }
  }

  if (sheet.flashcards?.length) {
    parts.push(
      "Flashcards\n" +
        sheet.flashcards
          .map((c) => `Q: [${c.tag}] ${c.question}\nA: ${c.answer}`)
          .join("\n\n")
    );
  }

  if (sheet.referenceNote?.trim()) {
    parts.push(`Sources\n${sheet.referenceNote.trim()}`);
  }

  parts.push(...extra.filter((s) => s.trim()));
  parts.push("Generated with StudyBuddy AI");

  return parts.join("\n\n");
}
