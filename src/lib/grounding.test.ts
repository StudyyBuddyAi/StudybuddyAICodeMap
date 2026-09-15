import { describe, it, expect } from "vitest";
import {
  groundingLevelFromCards,
  parseSourceCoverage,
  presentedGrounding,
  reconcileGroundingLevel,
  resolveGroundingLevel,
} from "./grounding";
import { parseSheetOutput } from "./parse-partial-sheet";
import type {
  GeneratedSheet,
  GroundingLevel,
  SheetSectionKey,
  SourceCoverage,
} from "@/types/generated-sheet";

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

describe("groundingLevelFromCards", () => {
  const g = (n: number) => Array.from({ length: n }, () => ({ grounded: true }));
  const u = (n: number) => Array.from({ length: n }, () => ({ grounded: false }));

  it("returns none when nothing was retrieved, whatever the cards claim", () => {
    expect(groundingLevelFromCards(0, g(5))).toBe("none");
  });

  it("returns none when there are no cards", () => {
    expect(groundingLevelFromCards(8, [])).toBe("none");
  });

  it("returns none when retrieval matched but no card used it", () => {
    expect(groundingLevelFromCards(8, u(5))).toBe("none");
  });

  it("returns full when every card is grounded", () => {
    expect(groundingLevelFromCards(8, g(5))).toBe("full");
  });

  it("returns partial when only some cards are grounded", () => {
    expect(groundingLevelFromCards(8, [...g(3), ...u(2)])).toBe("partial");
  });
});

describe("presentedGrounding", () => {
  const coverage = (uncovered: SheetSectionKey[] = []): SourceCoverage => ({
    level: "full",
    uncovered,
  });

  it("leaves a sheet without figures completely untouched", () => {
    const input = coverage(["keyPoints"]);
    const result = presentedGrounding("full", input, false);
    expect(result.level).toBe("full");
    expect(result.coverage).toBe(input);
  });

  it("downgrades full to partial once figures are present", () => {
    expect(presentedGrounding("full", coverage(), true).level).toBe("partial");
  });

  it("names figures as uncovered so the notice can say what is unverified", () => {
    const result = presentedGrounding("full", coverage(), true);
    expect(result.coverage?.uncovered).toContain("figures");
  });

  it("keeps the sections the model already reported uncovered", () => {
    const result = presentedGrounding("partial", coverage(["examTraps"]), true);
    expect(result.coverage?.uncovered).toEqual(["examTraps", "figures"]);
  });

  it("does not duplicate figures if already listed", () => {
    const result = presentedGrounding("partial", coverage(["figures"]), true);
    expect(result.coverage?.uncovered).toEqual(["figures"]);
  });

  it("never upgrades none to partial", () => {
    expect(presentedGrounding("none", coverage(), true).level).toBe("none");
  });

  it("stays null for a legacy sheet that reports no grounding at all", () => {
    expect(presentedGrounding(null, null, true).level).toBeNull();
  });

  it("builds coverage even when the model sent none", () => {
    const result = presentedGrounding("full", null, true);
    expect(result.coverage).toEqual({ level: "partial", uncovered: ["figures"] });
  });
});

describe("the figures downgrade must not reach a saved flashcard deck", () => {
  // Pins SheetGenerator's save path (sheet -> saveCards): the per-card
  // `grounded` flag is computed from the level and whether flashcards were
  // reported uncovered. Clamping for figures must not disturb either.
  const cardsGrounded = (level: GroundingLevel, coverage: SourceCoverage | null) =>
    level === "full" ||
    (level === "partial" && !(coverage?.uncovered?.includes("flashcards") ?? false));

  it("leaves cards grounded when only figures forced the downgrade", () => {
    const stored: SourceCoverage = { level: "full", uncovered: [] };
    const shown = presentedGrounding("full", stored, true);

    // What the deck must inherit is the stored, unclamped content level.
    expect(cardsGrounded("full", stored)).toBe(true);
    // And the clamped presentation must still not implicate flashcards.
    expect(shown.coverage?.uncovered).not.toContain("flashcards");
    expect(cardsGrounded(shown.level!, shown.coverage)).toBe(true);
  });

  it("still un-grounds cards the model itself reported uncovered", () => {
    const stored: SourceCoverage = { level: "partial", uncovered: ["flashcards"] };
    expect(cardsGrounded("partial", stored)).toBe(false);
  });
});
