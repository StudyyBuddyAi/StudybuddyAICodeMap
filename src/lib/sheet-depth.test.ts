import { afterEach, describe, it, expect, vi } from "vitest";
import { SectionOutdatedError, SectionQuotaError, depthOf, hasBody, runSectionRequest } from "./sheet-depth";
import { parseSheetOutput } from "./parse-partial-sheet";
import {
  addHighlight,
  anchoredTo,
  emptyLayer,
  parseLayer,
  removeLayerSection,
  rewriteSection,
  toggleKnown,
  withLayerSections,
} from "./sheet-layer";
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
  },
  overview: "Mechanism: insulin deficiency.\nPathophysiology: lipolysis → ketones.",
  memoryHooks: [],
  clinicalApproach: "",
  keyPoints: ["If K < 3.3 → hold insulin", "Add dextrose at 250"],
  examTraps: [],
  flashcards: [],
  referenceNote: "",
};

describe("depth settings", () => {
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

describe("the parser mends GPT-OSS's hyphens", () => {
  it("turns non-breaking hyphens into plain ones, so labels read as labels", () => {
    const parsed = parseSheetOutput(JSON.stringify({ clinicalApproach: "Second‑line: add an MRA." }));
    expect(parsed?.sheet.sections?.clinicalApproach).toBe("Second-line: add an MRA.");
  });

  it("never reads the sheet's own depth field as a section", () => {
    const parsed = parseSheetOutput(JSON.stringify({ overview: "a", depth: "comprehensive" }));
    expect(Object.keys(parsed?.sheet.sections ?? {})).toEqual(["overview"]);
  });
});

describe("rewrites in the layer", () => {
  it("rewrites a section, taking what was anchored to its old lines — and only those", () => {
    let layer = emptyLayer();
    layer = addHighlight(layer, { anchor: "keyPoints:0", quote: "hold insulin", intent: "key" });
    layer = toggleKnown(layer, "keyPoints:1");
    layer = addHighlight(layer, { anchor: "overview:0", quote: "insulin", intent: "key" });
    expect(anchoredTo(layer, ["keyPoints"])).toBe(2);

    const rewritten = rewriteSection(layer, { keyPoints: ["If K+ < 3.3 → replete first"] }, "exam");
    expect(rewritten.highlights.map((h) => h.anchor)).toEqual(["overview:0"]);
    expect(rewritten.known).toEqual([]);
    expect(withLayerSections(SHEET, rewritten).keyPoints).toEqual(["If K+ < 3.3 → replete first"]);
    // The sheet itself is never changed.
    expect(SHEET.keyPoints).toEqual(["If K < 3.3 → hold insulin", "Add dextrose at 250"]);

    // Back to the original.
    const undone = removeLayerSection(rewritten, ["keyPoints"]);
    expect(withLayerSections(SHEET, undone).keyPoints).toEqual(SHEET.keyPoints);
  });

  it("survives a round trip through storage, and drops what it cannot trust", () => {
    const layer = rewriteSection(emptyLayer(), { keyPoints: ["a", "b"] }, "simpler");
    const back = parseLayer(JSON.parse(JSON.stringify({ ...layer, sections: { ...layer.sections, "bad key": { body: "x" } } })));
    expect(Object.keys(back.sections)).toEqual(["keyPoints"]);
    expect(back.sections.keyPoints).toMatchObject({ kind: "rewrite", style: "simpler" });
    // A layer from before sections had none.
    expect(parseLayer({ v: 1, highlights: [] }).sections).toEqual({});
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
    action: "regenerate" as const,
    key: "overview",
    style: "simpler" as const,
    plan: ["overview", "keyPoints"],
    sections: {},
    topic: "DKA",
    sourceIds: [],
    signature: null,
  };
  afterEach(() => vi.mocked(callMedicalNotes).mockReset());

  it("streams drafts and resolves to the finished section", async () => {
    vi.mocked(callMedicalNotes).mockResolvedValue(
      sse([delta('{"overview": "Mechanism: glucagon'), delta(' drives it.", "covered": false}')])
    );
    const drafts: string[] = [];
    const result = await runSectionRequest(params, { onDraft: (d) => drafts.push(String(d.sections.overview ?? "")) });
    expect(result.sections.overview).toBe("Mechanism: glucagon drives it.");
    expect(result.covered).toBe(false);
    expect(drafts.length).toBeGreaterThan(0);
  });

  it("keeps the server's signature on the rewrite, which is no sign of an old server", async () => {
    const sig = "a".repeat(43);
    vi.mocked(callMedicalNotes).mockResolvedValue(
      sse([delta('{"overview": "Rewritten."}'), { __meta: { signature: { v: 1, topic: "DKA", sections: { overview: sig } } } }])
    );
    const result = await runSectionRequest(params);
    expect(result.sections.overview).toBe("Rewritten.");
    expect(result.sigs).toEqual({ overview: sig });
  });

  it("says when today's requests are used up", async () => {
    vi.mocked(callMedicalNotes).mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(runSectionRequest(params)).rejects.toBeInstanceOf(SectionQuotaError);
  });

  it("stops at once when the server answers with a sheet instead", async () => {
    vi.mocked(callMedicalNotes).mockResolvedValue(sse([{ __meta: { plan: [] } }]));
    await expect(runSectionRequest(params)).rejects.toBeInstanceOf(SectionOutdatedError);
  });

  it("fails on an empty reply, so the section stays as it was", async () => {
    vi.mocked(callMedicalNotes).mockResolvedValue(sse([delta('{"overview": ""}')]));
    await expect(runSectionRequest(params)).rejects.toThrow(/nothing/);
  });
});
