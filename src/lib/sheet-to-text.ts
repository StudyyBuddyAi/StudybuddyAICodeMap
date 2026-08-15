import type { GeneratedSheet } from "@/types/generated-sheet";

/** Section order and headings, matching how OutputSection renders the document. */
const SECTIONS: Array<{
  key: keyof GeneratedSheet;
  heading: string;
}> = [
  { key: "overview", heading: "Overview" },
  { key: "memoryHooks", heading: "Memory Hooks" },
  { key: "clinicalApproach", heading: "Clinical Approach" },
  { key: "keyPoints", heading: "Key Points" },
  { key: "examTraps", heading: "Exam Traps" },
];

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

  for (const { key, heading } of SECTIONS) {
    const value = sheet[key];
    if (Array.isArray(value)) {
      if (!value.length) continue;
      parts.push(
        `${heading}\n` + value.map((item, i) => `${i + 1}. ${item}`).join("\n")
      );
    } else if (typeof value === "string" && value.trim()) {
      parts.push(`${heading}\n${value.trim()}`);
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
    parts.push(`Reference Note\n${sheet.referenceNote.trim()}`);
  }

  parts.push("Generated with StudyBuddy AI");

  return parts.join("\n\n");
}
