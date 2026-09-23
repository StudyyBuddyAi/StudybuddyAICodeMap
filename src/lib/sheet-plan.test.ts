import { describe, it, expect } from "vitest";
import {
  FLASHCARDS_SPEC,
  LEGACY_PLAN,
  REFERENCE_NOTE_SPEC,
  parsePlan,
  renderOrder,
  resolvePlan,
  sectionBody,
  sectionHasBody,
} from "./sheet-plan";
import { parseSheetOutput } from "./parse-partial-sheet";
import type { GeneratedSheet } from "@/types/generated-sheet";

const spec = (key: string, title: string, kind: "prose" | "list" = "prose") => ({
  key,
  title,
  kind,
});

describe("parsePlan", () => {
  it("accepts a well-formed plan", () => {
    expect(
      parsePlan([
        { key: "moa", title: "Mechanism of Action", kind: "prose", icon: "drug" },
        { key: "adverseEffects", title: "Adverse Effects", kind: "list", evidenceBacked: true },
      ])
    ).toEqual([
      { key: "moa", title: "Mechanism of Action", kind: "prose", icon: "drug", evidenceBacked: false },
      { key: "adverseEffects", title: "Adverse Effects", kind: "list", icon: undefined, evidenceBacked: true },
    ]);
  });

  it("returns null for anything that isn't a usable list", () => {
    expect(parsePlan(undefined)).toBeNull();
    expect(parsePlan({})).toBeNull();
    expect(parsePlan([])).toBeNull();
    // Every entry malformed is the same as no plan at all.
    expect(parsePlan([{ key: "x" }, { title: "y" }, null])).toBeNull();
  });

  it("drops entries with an unusable key, title or kind", () => {
    const out = parsePlan([
      spec("good", "Good"),
      { key: "", title: "Empty key", kind: "prose" },
      { key: "noTitle", title: "   ", kind: "prose" },
      { key: "badKind", title: "Bad kind", kind: "table" },
    ]);
    expect(out?.map((s) => s.key)).toEqual(["good"]);
  });

  it("rejects reserved keys, so a section can't collide with the deck or metadata", () => {
    const out = parsePlan([
      spec("flashcards", "Flashcards"),
      spec("referenceNote", "Reference Note"),
      spec("sourceCoverage", "Coverage"),
      spec("keeper", "Keeper"),
    ]);
    expect(out?.map((s) => s.key)).toEqual(["keeper"]);
  });

  it("keeps the first of a duplicated key rather than rendering it twice", () => {
    const out = parsePlan([spec("dupe", "First"), spec("dupe", "Second")]);
    expect(out).toHaveLength(1);
    expect(out?.[0].title).toBe("First");
  });
});

describe("resolvePlan / renderOrder", () => {
  const empty = { plan: undefined };

  it("falls back to the legacy six when a sheet has no plan", () => {
    expect(resolvePlan(empty).map((s) => s.key)).toEqual(
      LEGACY_PLAN.map((s) => s.key)
    );
  });

  it("uses the sheet's own plan when it has one", () => {
    const plan = [spec("moa", "Mechanism of Action")];
    expect(resolvePlan({ plan }).map((s) => s.key)).toEqual(["moa"]);
  });

  it("appends flashcards and the reference note after the content sections", () => {
    const order = renderOrder({ plan: [spec("moa", "Mechanism of Action")] });
    expect(order.map((s) => s.key)).toEqual([
      "moa",
      FLASHCARDS_SPEC.key,
      REFERENCE_NOTE_SPEC.key,
    ]);
  });

  it("lays a planless sheet out with the legacy sections, aids last", () => {
    // Content first, then the sections that summarise it. Memory Hooks used to
    // sit second, ahead of the Clinical Approach it summarises.
    expect(renderOrder(empty).map((s) => s.key)).toEqual([
      "overview",
      "clinicalApproach",
      "keyPoints",
      "memoryHooks",
      "examTraps",
      "flashcards",
      "referenceNote",
    ]);
  });
});

describe("sectionBody", () => {
  it("reads the sections map on a freshly parsed sheet", () => {
    const sheet = { sections: { moa: "Blocks the receptor." } } as unknown as GeneratedSheet;
    expect(sectionBody(sheet, "moa")).toBe("Blocks the receptor.");
  });

  it("falls back to the legacy named field for a sheet loaded from history", () => {
    // parseStoredSheet is a plain JSON.parse, so a saved sheet reaches the
    // renderer with named fields and no sections map.
    const stored = JSON.parse(
      JSON.stringify({ overview: "Mechanism: **x**", keyPoints: ["a", "b"] })
    ) as GeneratedSheet;
    expect(sectionBody(stored, "overview")).toBe("Mechanism: **x**");
    expect(sectionBody(stored, "keyPoints")).toEqual(["a", "b"]);
  });

  it("is undefined for a section the sheet does not have", () => {
    expect(sectionBody({} as GeneratedSheet, "nothingHere")).toBeUndefined();
  });
});

describe("sectionHasBody", () => {
  const sheet = {
    sections: { prose: "text", emptyProse: "   ", list: ["a"], emptyList: [] },
    flashcards: [],
  } as unknown as GeneratedSheet;

  it("distinguishes filled sections from empty ones", () => {
    expect(sectionHasBody(sheet, "prose")).toBe(true);
    expect(sectionHasBody(sheet, "emptyProse")).toBe(false);
    expect(sectionHasBody(sheet, "list")).toBe(true);
    expect(sectionHasBody(sheet, "emptyList")).toBe(false);
  });

  it("reads flashcards from the deck, not the sections map", () => {
    expect(sectionHasBody(sheet, "flashcards")).toBe(false);
    const withCards = {
      ...sheet,
      flashcards: [{ tag: "Mechanism", question: "q?", answer: "a" }],
    } as GeneratedSheet;
    expect(sectionHasBody(withCards, "flashcards")).toBe(true);
  });
});

describe("sections the six-field interface never named", () => {
  it("survives parsing instead of being silently discarded", () => {
    // The old normalize() kept an allowlist of six keys, so a section the
    // model invented was dropped before anything could render it — loosening
    // the prompt alone would have produced sheets with sections missing and
    // no error anywhere.
    const raw = JSON.stringify({
      topic: "Warfarin",
      moa: "Inhibits **vitamin K epoxide reductase**.",
      monitoring: ["INR 2-3 for most indications", "Check at 3 days"],
      flashcards: [],
      referenceNote: "General knowledge.",
    });

    const parsed = parseSheetOutput(raw);
    expect(parsed?.status).toBe("ok");
    expect(parsed?.sheet.sections?.moa).toBe("Inhibits **vitamin K epoxide reductase**.");
    expect(parsed?.sheet.sections?.monitoring).toEqual([
      "INR 2-3 for most indications",
      "Check at 3 days",
    ]);
  });

  it("keeps metadata out of the sections map", () => {
    const raw = JSON.stringify({
      topic: "Warfarin",
      topicEmoji: "💊",
      overview: "text",
      sourceCoverage: { level: "none", uncovered: [] },
      flashcards: [],
      referenceNote: "note",
    });

    const sections = parseSheetOutput(raw)?.sheet.sections ?? {};
    expect(Object.keys(sections)).toEqual(["overview"]);
  });
});

describe("server/client plan agreement", () => {
  it("keeps the client's fallback plan in step with the server's default", async () => {
    // The server decides the plan and the client validates it, so the two
    // shapes have to agree. Until the settings drive the plan, the server's
    // default is also what the prompt's JSON skeleton asks the model for — if
    // these drift, sheets arrive with sections nothing renders.
    const server = await import(
      "../../supabase/functions/_shared/sheet-plan.ts"
    );
    expect(server.DEFAULT_SHEET_PLAN).toEqual(LEGACY_PLAN);
  });
});
