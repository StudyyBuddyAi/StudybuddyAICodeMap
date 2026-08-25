import { describe, it, expect } from "vitest";
import {
  parseSourceCoverage,
  reconcileGroundingLevel,
  resolveGroundingLevel,
} from "./grounding";
import { parseSheetOutput } from "./parse-partial-sheet";
import type { GeneratedSheet } from "@/types/generated-sheet";

describe("parseSourceCoverage", () => {
  it("accepts a well-formed coverage object", () => {
    expect(parseSourceCoverage({ level: "partial", uncovered: ["keyPoints"] })).toEqual({
      level: "partial",
      uncovered: ["keyPoints"],
    });
  });

  it("returns null for a missing or unrecognized level rather than throwing", () => {
    expect(parseSourceCoverage(undefined)).toBeNull();
    expect(parseSourceCoverage({ uncovered: [] })).toBeNull();
    expect(parseSourceCoverage({ level: "mostly" })).toBeNull();
  });

  it("drops section names that aren't real sheet sections", () => {
    const out = parseSourceCoverage({ level: "partial", uncovered: ["keyPoints", "nonsense"] });
    expect(out).toEqual({ level: "partial", uncovered: ["keyPoints"] });
  });
});

describe("reconcileGroundingLevel", () => {
  it("forces 'none' when nothing was retrieved, whatever the model claimed", () => {
    expect(reconcileGroundingLevel(0, { level: "full", uncovered: [] })).toBe("none");
  });

  it("falls back to 'partial' — never 'full' — when coverage is missing", () => {
    expect(reconcileGroundingLevel(5, null)).toBe("partial");
  });

  it("honours the model's own level when chunks were retrieved", () => {
    expect(reconcileGroundingLevel(5, { level: "full", uncovered: [] })).toBe("full");
    expect(reconcileGroundingLevel(5, { level: "partial", uncovered: ["examTraps"] })).toBe(
      "partial"
    );
  });
});

describe("resolveGroundingLevel", () => {
  it("returns null for legacy sheets that predate grounding entirely", () => {
    expect(resolveGroundingLevel({ overview: "x" } as GeneratedSheet)).toBeNull();
  });

  it("maps the deprecated boolean onto the three-level scale", () => {
    expect(resolveGroundingLevel({ grounded: true } as GeneratedSheet)).toBe("full");
    expect(resolveGroundingLevel({ grounded: false } as GeneratedSheet)).toBe("none");
  });

  it("prefers groundingLevel over the deprecated boolean", () => {
    expect(
      resolveGroundingLevel({ grounded: true, groundingLevel: "partial" } as GeneratedSheet)
    ).toBe("partial");
  });
});

describe("grounding notice reason", () => {
  // Mirrors the ternary in SheetGenerator: the three "none" cases are told
  // apart by retrievedChunks, so a sheet built with grounding off never
  // claims the library simply lacked the topic.
  const reasonFor = (sheet: GeneratedSheet) =>
    sheet.groundingLevel !== "none"
      ? undefined
      : sheet.retrievedChunks === undefined
      ? "disabled"
      : sheet.retrievedChunks === 0
      ? "no-match"
      : "not-relevant";

  it("says 'disabled' when grounding was off (retrievedChunks never set)", () => {
    expect(reasonFor({ groundingLevel: "none" } as GeneratedSheet)).toBe("disabled");
  });

  it("says 'no-match' when retrieval ran and found nothing", () => {
    expect(reasonFor({ groundingLevel: "none", retrievedChunks: 0 } as GeneratedSheet)).toBe(
      "no-match"
    );
  });

  it("says 'not-relevant' when chunks came back but the model rejected them", () => {
    expect(reasonFor({ groundingLevel: "none", retrievedChunks: 6 } as GeneratedSheet)).toBe(
      "not-relevant"
    );
  });

  it("has no reason when the sheet is grounded", () => {
    expect(
      reasonFor({ groundingLevel: "full", retrievedChunks: 6 } as GeneratedSheet)
    ).toBeUndefined();
  });
});

describe("parseSheetOutput preserves sourceCoverage", () => {
  // normalize() rebuilds the sheet from known fields only, so sourceCoverage
  // has to be carried explicitly or the caller can never reconcile it.
  const sheetJson = JSON.stringify({
    overview: "o",
    memoryHooks: [],
    clinicalApproach: "c",
    keyPoints: [],
    examTraps: [],
    flashcards: [],
    referenceNote: "r",
    sourceCoverage: { level: "partial", uncovered: ["examTraps"] },
  });

  it("survives normalize() instead of being silently dropped", () => {
    const result = parseSheetOutput(sheetJson);
    expect(result?.sheet.sourceCoverage).toEqual({
      level: "partial",
      uncovered: ["examTraps"],
    });
  });

  it("leaves sourceCoverage undefined when the model omits it", () => {
    const without = parseSheetOutput(
      JSON.stringify({ overview: "o", referenceNote: "r", flashcards: [] })
    );
    expect(without?.sheet.sourceCoverage).toBeUndefined();
  });
});
