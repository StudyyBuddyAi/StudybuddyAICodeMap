import { describe, it, expect } from "vitest";
import type { GeneratedSheet } from "@/types/generated-sheet";
import {
  addAddition,
  addCard,
  addHighlight,
  addNote,
  applyLayer,
  emptyLayer,
  highlightRanges,
  isEmptyLayer,
  layerNotesText,
  occurrenceBefore,
  originalLine,
  parseLayer,
  practiceFocus,
  removeEdit,
  setEdit,
  toggleHidden,
  toggleKnown,
  type SheetLayer,
} from "./sheet-layer";

const sheet: GeneratedSheet = {
  topic: "DKA",
  plan: [
    { key: "overview", title: "Overview", kind: "prose" },
    { key: "keyPoints", title: "Key Points", kind: "list" },
    { key: "differentials", title: "Differential Diagnosis", kind: "table", columns: ["Diagnosis", "Feature", "Confirm"] },
  ],
  sections: {
    overview: "Mechanism: **Insulin deficiency** drives ketogenesis.\n\nPathophysiology: ketones → acidosis.",
    keyPoints: ["Give potassium before insulin.", "Close the gap before stopping insulin."],
    differentials: [
      ["HHS", "No ketones", "Osmolality"],
      ["AKA", "Normal glucose", "History"],
    ],
  },
  overview: "Mechanism: **Insulin deficiency** drives ketogenesis.\n\nPathophysiology: ketones → acidosis.",
  keyPoints: ["Give potassium before insulin.", "Close the gap before stopping insulin."],
  memoryHooks: [],
  clinicalApproach: "",
  examTraps: [],
  flashcards: [{ tag: "Mechanism", question: "Why ketones?", answer: "No insulin." }],
  referenceNote: "General knowledge.",
};

describe("highlights", () => {
  it("marks a passage once, and re-marking changes its intent instead of stacking", () => {
    let layer = addHighlight(emptyLayer(), { anchor: "keyPoints:0", quote: "potassium", intent: "key" });
    layer = addHighlight(layer, { anchor: "keyPoints:0", quote: "potassium", intent: "memorize" });
    expect(layer.highlights).toHaveLength(1);
    expect(layer.highlights[0].intent).toBe("memorize");
  });

  it("finds the right occurrence, case-insensitively, and skips quotes that are gone", () => {
    const text = "insulin first, then Insulin again";
    const layer = addHighlight(
      addHighlight(emptyLayer(), { anchor: "overview:0", quote: "insulin", occurrence: 1, intent: "key" }),
      { anchor: "overview:0", quote: "not here", intent: "confusing" }
    );
    const ranges = highlightRanges(text, layer.highlights);
    expect(ranges).toEqual([{ start: 20, end: 27, id: layer.highlights[0].id, intent: "key" }]);
  });

  it("counts the occurrences before a selection", () => {
    expect(occurrenceBefore("insulin, then insulin and ", "insulin")).toBe(2);
    expect(occurrenceBefore("nothing", "insulin")).toBe(0);
  });

  it("rejects an anchor it cannot place", () => {
    expect(addHighlight(emptyLayer(), { anchor: "bad anchor", quote: "x", intent: "key" }).highlights).toHaveLength(0);
  });
});

describe("edits", () => {
  it("replaces a line, and writing it back to the original removes the edit", () => {
    let layer = setEdit(emptyLayer(), { anchor: "keyPoints:0", text: "K+ first.", source: "user", original: "Give potassium before insulin." });
    expect(layer.edits["keyPoints:0"].text).toBe("K+ first.");
    layer = setEdit(layer, { anchor: "keyPoints:0", text: "Give potassium before insulin.", source: "user", original: "Give potassium before insulin." });
    expect(layer.edits["keyPoints:0"]).toBeUndefined();
  });

  it("drops highlights whose words the edit removed, and keeps the rest", () => {
    let layer = addHighlight(emptyLayer(), { anchor: "keyPoints:0", quote: "potassium", intent: "key" });
    layer = addHighlight(layer, { anchor: "keyPoints:0", quote: "insulin", intent: "memorize" });
    layer = setEdit(layer, { anchor: "keyPoints:0", text: "Check **insulin** timing.", source: "ai", original: "Give potassium before insulin." });
    expect(layer.highlights.map((h) => h.quote)).toEqual(["insulin"]);
    expect(removeEdit(layer, "keyPoints:0").edits).toEqual({});
  });
});

describe("applyLayer", () => {
  it("returns the sheet untouched when there is no layer", () => {
    expect(applyLayer(sheet, emptyLayer())).toBe(sheet);
  });

  it("applies edits, removals and additions by the renderer's own line indices", () => {
    let layer: SheetLayer = setEdit(emptyLayer(), {
      anchor: "overview:2",
      text: "Pathophysiology: ketoacids → high anion gap.",
      source: "user",
      original: "Pathophysiology: ketones → acidosis.",
    });
    layer = toggleHidden(layer, "keyPoints:1");
    layer = toggleHidden(layer, "differentials:0");
    layer = addAddition(layer, "keyPoints", "Recheck K+ every 2 hours.");
    layer = addAddition(layer, "overview", "My point: watch cerebral edema in kids.");
    layer = addCard(layer, { question: "K+ before insulin?", answer: "Yes, if < 3.3.", anchor: "keyPoints:0" });

    const out = applyLayer(sheet, layer);
    expect(out.sections!.overview).toBe(
      "Mechanism: **Insulin deficiency** drives ketogenesis.\n\nPathophysiology: ketoacids → high anion gap.\nMy point: watch cerebral edema in kids."
    );
    expect(out.sections!.keyPoints).toEqual(["Give potassium before insulin.", "Recheck K+ every 2 hours."]);
    // The legacy field a stored sheet renders from moves with it.
    expect(out.keyPoints).toEqual(out.sections!.keyPoints);
    expect(out.sections!.differentials).toEqual([["AKA", "Normal glucose", "History"]]);
    expect(out.flashcards.map((c) => c.tag)).toEqual(["Mechanism", "Mine"]);
    // The generated sheet itself is never changed.
    expect(sheet.sections!.keyPoints).toHaveLength(2);
  });
});

describe("originalLine", () => {
  it("reads a prose line, a list item or a table row by anchor", () => {
    expect(originalLine(sheet, "overview:2")).toBe("Pathophysiology: ketones → acidosis.");
    expect(originalLine(sheet, "overview:1")).toBeNull(); // the blank line
    expect(originalLine(sheet, "keyPoints:1")).toBe("Close the gap before stopping insulin.");
    expect(originalLine(sheet, "differentials:0")).toBe("HHS | No ketones | Osmolality");
    expect(originalLine(sheet, "keyPoints:9")).toBeNull();
    expect(originalLine(sheet, "keyPoints:end")).toBeNull();
  });
});

describe("parseLayer", () => {
  it("round-trips a layer", () => {
    let layer = addNote(emptyLayer(), "overview:end", "Ask about euglycemic DKA.");
    layer = toggleKnown(layer, "keyPoints:0");
    layer = addHighlight(layer, { anchor: "overview:0", quote: "Insulin deficiency", intent: "confusing" });
    expect(parseLayer(JSON.parse(JSON.stringify(layer)))).toEqual(layer);
  });

  it("drops malformed entries one by one instead of the whole layer", () => {
    const parsed = parseLayer({
      highlights: [
        { anchor: "overview:0", quote: "ok", intent: "key", id: "a" },
        { anchor: "overview:0", quote: "", intent: "key" },
        { anchor: "nope", quote: "x", intent: "key" },
        { anchor: "overview:1", quote: "x", intent: "purple" },
      ],
      edits: { "keyPoints:0": { text: "fine" }, "<script>": { text: "no" } },
      known: ["keyPoints:0", "keyPoints:0", 7, "bad"],
      notes: "not a list",
    });
    expect(parsed.highlights.map((h) => h.id)).toEqual(["a"]);
    expect(Object.keys(parsed.edits)).toEqual(["keyPoints:0"]);
    expect(parsed.known).toEqual(["keyPoints:0"]);
    expect(parsed.notes).toEqual([]);
    expect(isEmptyLayer(parseLayer(null))).toBe(true);
  });
});

describe("text for export and practice", () => {
  it("lists notes under their section titles", () => {
    const layer = addNote(addNote(emptyLayer(), "keyPoints:0", "Why 3.3?"), "overview:end", "Mechanism.", "ai");
    expect(layerNotesText(sheet, layer)).toBe(
      "My notes\n- Key Points: Why 3.3?\n- Overview (AI explanation): Mechanism."
    );
  });

  it("builds a practice focus from what was marked confusing or to memorise, newest first", () => {
    let layer = addHighlight(emptyLayer(), { anchor: "keyPoints:0", quote: "potassium before insulin", intent: "memorize" });
    layer = addHighlight(layer, { anchor: "overview:0", quote: "Insulin deficiency", intent: "key" });
    layer = addHighlight(layer, { anchor: "overview:2", quote: "ketones → acidosis", intent: "confusing" });
    expect(practiceFocus(layer)).toBe("ketones → acidosis; potassium before insulin");
    expect(practiceFocus(emptyLayer())).toBe("");
  });
});
