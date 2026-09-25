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
  topic: string
): string {
  if (!sheet) return legacyOutput ?? "";

  const title = sheet.topic?.trim() || topic.trim() || "Study sheet";
  const parts: string[] = [`${title}\n${"=".repeat(title.length)}`];

  // Headings and order come from the sheet's own plan, so an exported sheet
  // always matches what was on screen — including archetype sections this
  // build has no name for.
  for (const { key, title, columns } of resolvePlan(sheet)) {
    const value = sectionBody(sheet, key);
    if (isTableRows(value)) {
      // Pipe-separated under its header line, which pastes legibly anywhere
      // and as a table into anything that reads Markdown.
      const header = columns?.length ? [columns.join(" | ")] : [];
      parts.push(`${title}\n` + [...header, ...bodyLines(value)].join("\n"));
    } else if (Array.isArray(value)) {
      if (!value.length) continue;
      parts.push(
        `${title}\n` + value.map((item, i) => `${i + 1}. ${item}`).join("\n")
      );
    } else if (typeof value === "string" && value.trim()) {
      parts.push(`${title}\n${value.trim()}`);
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

  parts.push("Generated with StudyBuddy AI");

  return parts.join("\n\n");
}
