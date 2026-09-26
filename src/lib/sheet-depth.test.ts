import { afterEach, describe, it, expect, vi } from "vitest";
import {
  SectionOutdatedError,
  SectionQuotaError,
  baseKey,
  depthOf,
  hasBody,
  moreKey,
  runSectionRequest,
  weakenCoverage,
} from "./sheet-depth";
import { parseSheetOutput } from "./parse-partial-sheet";
import {
  addDepth,
  addHighlight,
  anchoredTo,
  applyLayer,
  emptyLayer,
  isEmptyLayer,
  parseLayer,
  removeLayerSection,
  rewriteSection,
  toggleKnown,
  withLayerSections,
} from "./sheet-layer";
import { sheetToPlainText } from "./sheet-to-text";
import type { GeneratedSheet } from "@/types/generated-sheet";

vi.mock("@/lib/callMedicalNotes", () => ({ callMedicalNotes: vi.fn() }));
import { callMedicalNotes } from "@/lib/callMedicalNotes";

const SHEET: GeneratedSheet = {
  topic: "DKA",
  plan: [
    { key: "overview", title: "Overview", kind: "prose" },
    { key: "keyPoints", title: "Key Points", kind: "list" },
  ],
  sections: {
    overview: "Mechanism: insulin deficiency.\nPathophysiology: lipolysis → ketones.",
    keyPoints: ["If K < 3.3 → hold insulin", "Add dextrose at 250"],
    keyPoints_more: ["Low-dose insulin halts ketogenesis"],
  },
  overview: "Mechanism: insulin deficiency.\nPathophysiology: lipolysis → ketones.",
  memoryHooks: [],
  clinicalApproach: "",
  keyPoints: ["If K < 3.3 → hold insulin", "Add dextrose at 250"],
  examTraps: [],
  flashcards: [],
  referenceNote: "",
};

describe("depth keys and settings", () => {
  it("names a section's depth and finds its section", () => {
    expect(moreKey("keyPoints")).toBe("keyPoints_more");
    expect(baseKey("keyPoints_more")).toBe("keyPoints");
    expect(baseKey("keyPoints")).toBe("keyPoints");
  });

  it("reads a saved sheet's depth, old lengths included", () => {
    expect(depthOf("comprehensive")).toBe("comprehensive");
    expect(depthOf("Detailed")).toBe("comprehensive");
    expect(depthOf("Moderate")).toBe("highYield");
    expect(depthOf(undefined)).toBe("highYield");
  });

  it("knows an empty body", () => {
    expect(hasBody(undefined)).toBe(false);
    expect(hasBody("  ")).toBe(false);
    expect(hasBody([])).toBe(false);
    expect(hasBody(["x"])).toBe(true);
  });
});

describe("the parser keeps depth and mends GPT-OSS's hyphens", () => {
  it("keeps a section's depth as its own key", () => {
    const parsed = parseSheetOutput(JSON.stringify({ overview: "a", overview_more: "Mechanism: b." }));
    expect(parsed?.sheet.sections?.overview_more).toBe("Mechanism: b.");
  });

  it("turns non-breaking hyphens into plain ones, so labels read as labels", () => {
    const parsed = parseSheetOutput(JSON.stringify({ clinicalApproach: "Second‑line: add an MRA." }));
    expect(parsed?.sheet.sections?.clinicalApproach).toBe("Second-line: add an MRA.");
  });

  it("never reads the sheet's own depth field as a section", () => {
    const parsed = parseSheetOutput(JSON.stringify({ overview: "a", depth: "comprehensive" }));
    expect(Object.keys(parsed?.sheet.sections ?? {})).toEqual(["overview"]);
  });
});

describe("coverage after depth", () => {
  it("only weakens: a section written without the passages joins uncovered", () => {
    expect(weakenCoverage({ level: "full", uncovered: [] }, ["overview_more"])).toEqual({
      level: "partial",
      uncovered: ["overview"],
    });
    expect(weakenCoverage({ level: "none", uncovered: ["overview"] }, ["overview_more"])).toEqual({
      level: "none",
      uncovered: ["overview"],
    });
    expect(weakenCoverage({ level: "full", uncovered: [] }, [])).toEqual({ level: "full", uncovered: [] });
  });
});

describe("depth and rewrites in the layer", () => {
  it("adds depth beside the sheet, never into it", () => {
    const layer = addDepth(emptyLayer(), { overview_more: "Mechanism: counterregulatory hormones." });
    expect(isEmptyLayer(layer)).toBe(false);
    const view = withLayerSections(SHEET, layer);
    expect(view.sections?.overview_more).toBe("Mechanism: counterregulatory hormones.");
    expect(SHEET.sections?.overview_more).toBeUndefined();
  });

  it("rewrites a section, taking what was anchored to its old lines — and only those", () => {
    let layer = emptyLayer();
    layer = addHighlight(layer, { anchor: "keyPoints:0", quote: "hold insulin", intent: "key" });
    layer = toggleKnown(layer, "keyPoints:1");
    layer = addHighlight(layer, { anchor: "overview:0", quote: "insulin", intent: "key" });
    expect(anchoredTo(layer, ["keyPoints", "keyPoints_more"])).toBe(2);

    const rewritten = rewriteSection(layer, { keyPoints: ["If K+ < 3.3 → replete first"] }, "exam");
    expect(rewritten.highlights.map((h) => h.anchor)).toEqual(["overview:0"]);
    expect(rewritten.known).toEqual([]);
    expect(withLayerSections(SHEET, rewritten).keyPoints).toEqual(["If K+ < 3.3 → replete first"]);

    // Back to the original.
    const undone = removeLayerSection(rewritten, ["keyPoints"]);
    expect(withLayerSections(SHEET, undone).keyPoints).toEqual(SHEET.keyPoints);
  });

  it("survives a round trip through storage, and drops what it cannot trust", () => {
    const layer = addDepth(emptyLayer(), { overview_more: "Mechanism: x.", keyPoints_more: ["a", "b"] });
    const back = parseLayer(JSON.parse(JSON.stringify({ ...layer, sections: { ...layer.sections, "bad key": { body: "x" } } })));
    expect(Object.keys(back.sections).sort()).toEqual(["keyPoints_more", "overview_more"]);
    expect(back.sections.keyPoints_more.kind).toBe("depth");
    // A layer from before sections had none.
    expect(parseLayer({ v: 1, highlights: [] }).sections).toEqual({});
  });

  it("exports the depth where it is shown, with the student's changes applied", () => {
    const layer = toggleKnown(addDepth(emptyLayer(), { overview_more: "Mechanism: counterregulatory hormones." }), "keyPoints:0");
    const text = sheetToPlainText(applyLayer(SHEET, layer), "", "DKA", [], (key) => key === "overview");
    expect(text).toContain("Overview — in depth\nMechanism: counterregulatory hormones.");
    expect(text).not.toContain("Key Points — in depth");
  });
});

// ── The request itself ─────────────────────────────────────────────────────

const sse = (frames: unknown[], status = 200) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const f of frames) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(f)}\n\n`));
        c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        c.close();
      },
    }),
    { status }
  );
const delta = (content: string) => ({ choices: [{ index: 0, delta: { content } }] });

describe("runSectionRequest", () => {
  const params = {
    action: "expand" as const,
    key: "overview",
    plan: ["overview", "keyPoints"],
    sections: {},
    topic: "DKA",
    sourceIds: [],
  };
  afterEach(() => vi.mocked(callMedicalNotes).mockReset());

  it("streams drafts and resolves to the finished depth", async () => {
    vi.mocked(callMedicalNotes).mockResolvedValue(
      sse([delta('{"overview_more": "Mechanism: glucagon'), delta(' drives it.", "covered": false}')])
    );
    const drafts: string[] = [];
    const result = await runSectionRequest(params, { onDraft: (d) => drafts.push(String(d.sections.overview_more ?? "")) });
    expect(result.sections.overview_more).toBe("Mechanism: glucagon drives it.");
    expect(result.covered).toBe(false);
    expect(drafts.length).toBeGreaterThan(0);
  });

  it("says when today's requests are used up", async () => {
    vi.mocked(callMedicalNotes).mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(runSectionRequest(params)).rejects.toBeInstanceOf(SectionQuotaError);
  });

  it("stops at once when the server answers with a sheet instead", async () => {
    vi.mocked(callMedicalNotes).mockResolvedValue(sse([{ __meta: { plan: [] } }]));
    await expect(runSectionRequest(params)).rejects.toBeInstanceOf(SectionOutdatedError);
  });

  it("fails on an empty reply, so the section can offer to retry", async () => {
    vi.mocked(callMedicalNotes).mockResolvedValue(sse([delta('{"overview_more": ""}')]));
    await expect(runSectionRequest(params)).rejects.toThrow(/nothing/);
  });
});
