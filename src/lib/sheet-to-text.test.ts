import { describe, it, expect } from "vitest";
import { sheetToPlainText } from "./sheet-to-text";
import { figureToText } from "./figures";
import type { GeneratedSheet } from "@/types/generated-sheet";
import type { Figure } from "@/types/figure";

const SHEET: GeneratedSheet = {
  topic: "Heart Failure",
  overview: "Mechanism: reduced output",
  memoryHooks: ["FACES"],
  clinicalApproach: "Diagnosis: echo",
  keyPoints: ["If S3 then volume overload"],
  examTraps: ["HFpEF is not HFrEF"],
  flashcards: [{ tag: "Next Step", question: "What next?", answer: "Start an ACEi." }],
  referenceNote: "Standard references.",
};

const FIGURE: Figure = {
  kind: "compare",
  title: "Nephrotic vs nephritic",
  columns: ["Nephrotic", "Nephritic"],
  rows: [{ label: "Proteinuria", cells: [">3.5 g/day", "<3.5 g/day"] }],
};

describe("sheetToPlainText — figures", () => {
  it("includes figures so they do not vanish from a share", () => {
    const text = sheetToPlainText({ ...SHEET, figures: [FIGURE] }, "", "Heart Failure");
    expect(text).toContain("Figures");
    expect(text).toContain("Nephrotic vs nephritic");
    expect(text).toContain(">3.5 g/day");
  });

  it("uses the same serialiser the renderers give screen readers", () => {
    const text = sheetToPlainText({ ...SHEET, figures: [FIGURE] }, "", "Heart Failure");
    expect(text).toContain(figureToText(FIGURE));
  });

  it("is byte-identical to the pre-figures output for a sheet without them", () => {
    const withField = sheetToPlainText({ ...SHEET, figures: [] }, "", "Heart Failure");
    const without = sheetToPlainText(SHEET, "", "Heart Failure");
    expect(withField).toBe(without);
    expect(without).not.toContain("Figures");
  });

  it("keeps figures ahead of the reference note", () => {
    const text = sheetToPlainText({ ...SHEET, figures: [FIGURE] }, "", "Heart Failure");
    expect(text.indexOf("Figures")).toBeLessThan(text.indexOf("Reference Note"));
  });

  it("passes a legacy text blob straight through, figures or not", () => {
    expect(sheetToPlainText(null, "LEGACY BLOB", "Topic")).toBe("LEGACY BLOB");
  });
});
