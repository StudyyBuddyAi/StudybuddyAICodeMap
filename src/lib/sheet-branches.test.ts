import { afterEach, describe, it, expect, vi } from "vitest";
import {
  BranchOutdatedError,
  BranchQuotaError,
  comprehensivePicks,
  markdownBlocks,
  plainText,
  readBranch,
  readSuggestions,
  runBranchRequest,
} from "./sheet-branches";
import {
  addBranch,
  branchPath,
  editBranch,
  emptyLayer,
  isEmptyLayer,
  layerBranchesText,
  parseLayer,
  removeBranch,
  rewriteSection,
  setPills,
} from "./sheet-layer";
import type { GeneratedSheet } from "@/types/generated-sheet";

vi.mock("@/lib/callMedicalNotes", () => ({ callMedicalNotes: vi.fn() }));
import { callMedicalNotes } from "@/lib/callMedicalNotes";

const exists = (anchor: string) => ["clinicalApproach:1", "differentials:0", "overview:2"].includes(anchor);

describe("readSuggestions", () => {
  const reply = JSON.stringify({
    pills: [
      { section: "clinicalApproach", line: 1, type: "management", label: "Conservative trial", ask: "How long?" },
      { section: "differentials", line: 0, type: "compare", label: "vs ileus", ask: "How do they differ?", versus: "Paralytic ileus" },
      { section: "differentials", line: 0, type: "compare", label: "Side by side", ask: "Compare with?" },
      { section: "differentials", line: 0, type: "differential", label: "Mesenteric ischemia profile", ask: "How does it present?" },
      { section: "overview", line: 9, type: "mechanism", label: "Off the sheet", ask: "?" },
      { section: "overview", line: 2, type: "gossip", label: "Not a kind", ask: "?" },
    ],
  });

  it("keeps the pills tied to a line the sheet has, of a known kind, with what they compare", () => {
    const { pills, closed } = readSuggestions(reply, exists);
    expect(closed).toBe(true);
    expect(pills.map((p) => p.label)).toEqual(["Conservative trial", "vs ileus", "Mesenteric ischemia profile"]);
    expect(pills[0].anchor).toBe("clinicalApproach:1");
    expect(pills[1].versus).toBe("Paralytic ileus");
    // A pill that left out what it compares with says it in its label, or goes.
    expect(pills[2].versus).toBe("Mesenteric ischemia");
  });

  it("waits for a pill still being written", () => {
    const half = reply.slice(0, reply.indexOf('"vs ileus"') + 5);
    const { pills, closed } = readSuggestions(half, exists);
    expect(closed).toBe(false);
    expect(pills.map((p) => p.label)).toEqual(["Conservative trial"]);
  });

  it("holds the line of the pill being written, once its line number is whole", () => {
    const at = (marker: string) => readSuggestions(reply.slice(0, reply.indexOf(marker)), exists).pending;
    // Its number could still be growing ("1" of "12") until the next field starts.
    expect(at('"type":"compare","label":"vs ileus"')).toBeNull();
    expect(at('"label":"vs ileus"')).toBe("differentials:0");
    expect(readSuggestions(reply, exists).pending).toBeNull();
  });

  it("reads a reply in code fences", () => {
    expect(readSuggestions("```json\n" + reply + "\n```", exists).pills).toHaveLength(3);
  });
});

describe("readBranch", () => {
  const ctx = { topic: "SBO", versus: "Paralytic ileus" };

  it("keeps management as numbered steps and what to watch for", () => {
    const text = JSON.stringify({
      steps: ["**Decompress** — NG tube.", "**Resuscitate** — isotonic fluids."],
      watch: ["Rising lactate → operate."],
      next: [{ type: "case", label: "Lactate rises", ask: "Next step?" }],
      covered: false,
    });
    const b = readBranch(text, "management", ctx);
    expect(b.markdown).toBe("1. **Decompress** — NG tube.\n2. **Resuscitate** — isotonic fluids.\n\n#### Watch for\n- Rising lactate → operate.");
    expect(b.next).toEqual([{ type: "case", label: "Lactate rises", ask: "Next step?" }]);
    expect(b.covered).toBe(false);
  });

  it("keeps a comparison as a table under the two names, and its takeaway", () => {
    const text = JSON.stringify({ rows: [["Transition point", "Present", "Absent | none"]], takeaway: "CT settles it." });
    const md = readBranch(text, "compare", ctx).markdown;
    expect(md).toContain("| | SBO | Paralytic ileus |");
    expect(md).toContain("| Transition point | Present | Absent / none |");
    expect(md).toContain("> CT settles it.");
  });

  it("keeps a case's answer apart, to be revealed", () => {
    const text = JSON.stringify({ stem: "A 58-year-old man…", question: "Next step?", answer: "Operate.", reasoning: "Lactate is rising." });
    const blocks = markdownBlocks(readBranch(text, "case", ctx).markdown);
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph", "answer"]);
  });

  it("shows a branch as it streams, before it closes", () => {
    const half = '{"paragraphs": ["**Fluid lost to the lumen.** The bowel';
    const b = readBranch(half, "mechanism", ctx);
    expect(b.closed).toBe(false);
    expect(b.markdown).toBe("**Fluid lost to the lumen.** The bowel");
  });
});

describe("markdownBlocks", () => {
  it("reads the markdown a branch is kept in, and a student may write", () => {
    const md = "Intro **bold**.\n\n#### Watch for\n- one\n- two\n\n1. first\n2. second\n\n| | A | B |\n| --- | --- | --- |\n| x | 1 | 2 |\n\n> takeaway";
    expect(markdownBlocks(md)).toEqual([
      { kind: "paragraph", text: "Intro **bold**." },
      { kind: "heading", text: "Watch for" },
      { kind: "bullets", items: ["one", "two"] },
      { kind: "ordered", items: ["first", "second"] },
      { kind: "table", header: ["", "A", "B"], rows: [["x", "1", "2"]] },
      { kind: "callout", lines: ["takeaway"] },
    ]);
    expect(plainText(md)).not.toContain("**");
  });
});

describe("comprehensivePicks", () => {
  it("takes the first two of each content section, in the order ranked, and none of the study aids", () => {
    const pills = ["overview:1", "overview:2", "overview:3", "keyPoints:0", "clinicalApproach:1"].map((anchor, i) => ({ anchor, i }));
    expect(comprehensivePicks(pills, ["overview", "clinicalApproach"]).map((p) => p.i)).toEqual([0, 1, 4]);
  });
});

describe("branches in the layer", () => {
  const branch = (extra: Partial<Parameters<typeof addBranch>[1]> = {}) => ({
    anchor: "clinicalApproach:1",
    type: "management" as const,
    label: "Conservative trial",
    ask: "How long?",
    text: "1. Decompress.",
    next: [],
    source: "ai" as const,
    ...extra,
  });

  it("keeps a pill's streamed id, so a branch grown mid-stream stays tied to it", () => {
    const layer = setPills(emptyLayer(), [{ id: "p1", anchor: "overview:1", type: "mechanism", label: "Fluid", ask: "?" }]);
    expect(layer.pills[0].id).toBe("p1");
    expect(layer.suggestedAt).toBeTruthy();
    expect(isEmptyLayer(layer)).toBe(false);
  });

  it("grows, replaces, edits and removes a branch with every branch grown from it", () => {
    let layer = addBranch(emptyLayer(), branch({ id: "a" }));
    layer = addBranch(layer, branch({ id: "b", parentId: "a", label: "Gastrografin" }));
    layer = addBranch(layer, branch({ id: "c", parentId: "b", label: "Contrast passes" }));
    layer = addBranch(layer, branch({ id: "d", label: "Another" }));
    expect(branchPath(layer, "c").map((b) => b.id)).toEqual(["a", "b"]);

    // Grown again under the same id, it replaces rather than duplicates.
    layer = addBranch(layer, branch({ id: "a", text: "1. Decompress first." }));
    expect(layer.branches.filter((b) => b.id === "a")).toHaveLength(1);

    layer = editBranch(layer, "a", "My version.");
    expect(layer.branches.find((b) => b.id === "a")).toMatchObject({ text: "My version.", edited: true, source: "ai" });

    expect(removeBranch(layer, "a").branches.map((b) => b.id)).toEqual(["d"]);
    // Writing a branch empty removes it.
    expect(editBranch(layer, "d", "  ").branches.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  it("survives a round trip through storage, dropping what it cannot trust", () => {
    let layer = setPills(emptyLayer(), [{ anchor: "overview:1", type: "mechanism", label: "Fluid", ask: "?" }]);
    layer = addBranch(layer, branch({ id: "a", next: [{ type: "case", label: "Next", ask: "?" }] }));
    layer = addBranch(layer, branch({ id: "b", parentId: "a" }));
    const raw = JSON.parse(JSON.stringify(layer));
    raw.branches.push({ ...raw.branches[0], id: "orphan", parentId: "gone" });
    raw.branches.push({ ...raw.branches[0], id: "bad", type: "gossip" });
    raw.pills.push({ id: "q", anchor: "overview:2", type: "note", label: "A student's type", ask: "" });
    const back = parseLayer(raw);
    expect(back.branches.map((b) => b.id)).toEqual(["a", "b"]);
    expect(back.branches[0].next).toEqual([{ type: "case", label: "Next", ask: "?" }]);
    expect(back.pills).toHaveLength(1);
    expect(back.suggestedAt).toBe(layer.suggestedAt);
    // A layer from before branches has none.
    expect(parseLayer({ v: 1 }).branches).toEqual([]);
  });

  it("keeps a rewritten section's branches, hung from the section, and drops its suggestions", () => {
    let layer = setPills(emptyLayer(), [
      { anchor: "clinicalApproach:1", type: "management", label: "Trial", ask: "?" },
      { anchor: "overview:1", type: "mechanism", label: "Fluid", ask: "?" },
    ]);
    layer = addBranch(layer, branch({ id: "a" }));
    const rewritten = rewriteSection(layer, { clinicalApproach: "Management: new." }, "simpler");
    expect(rewritten.branches[0].anchor).toBe("clinicalApproach:end");
    expect(rewritten.pills.map((p) => p.anchor)).toEqual(["overview:1"]);
  });

  it("exports the branches under their sections, each under the one it grew from", () => {
    const sheet = {
      plan: [{ key: "clinicalApproach", title: "Clinical Approach", kind: "prose" }],
    } as unknown as GeneratedSheet;
    let layer = addBranch(emptyLayer(), branch({ id: "a" }));
    layer = addBranch(layer, branch({ id: "b", parentId: "a", label: "Gastrografin", text: "#### Dose\n100 mL." }));
    expect(layerBranchesText(sheet, layer)).toBe(
      "My branches\n\n# Clinical Approach\n\n## Conservative trial\n\n1. Decompress.\n\n### Gastrografin\n\nDose\n100 mL."
    );
    expect(layerBranchesText(sheet, emptyLayer())).toBe("");
  });
});

// ── The request itself ─────────────────────────────────────────────────────

const sse = (frames: unknown[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const f of frames) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(f)}\n\n`));
        c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        c.close();
      },
    })
  );
const delta = (content: string) => ({ choices: [{ index: 0, delta: { content } }] });

describe("runBranchRequest", () => {
  const sheet = { plan: ["overview"], sections: { overview: "Mechanism: x." }, topic: "SBO", sourceIds: [], examMode: "USMLE Step 2" };
  afterEach(() => vi.mocked(callMedicalNotes).mockReset());

  it("sends the sheet and the request, and streams the reply", async () => {
    vi.mocked(callMedicalNotes).mockResolvedValue(sse([delta('{"pills": '), delta("[]}")]));
    const seen: string[] = [];
    const text = await runBranchRequest(sheet, { action: "suggest" }, { onText: (t) => seen.push(t) });
    expect(text).toBe('{"pills": []}');
    expect(seen).toEqual(['{"pills": ', '{"pills": []}']);
    const body = vi.mocked(callMedicalNotes).mock.calls[0][0];
    expect(body).toMatchObject({ notes: "SBO", examMode: "USMLE Step 2", useMemory: false, branch: { action: "suggest", plan: ["overview"] } });
  });

  it("says when today's branches are used up", async () => {
    vi.mocked(callMedicalNotes).mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(runBranchRequest(sheet, { action: "suggest" })).rejects.toBeInstanceOf(BranchQuotaError);
  });

  it("stops at once when the server answers with a sheet instead", async () => {
    vi.mocked(callMedicalNotes).mockResolvedValue(sse([{ __meta: { plan: [] } }]));
    await expect(runBranchRequest(sheet, { action: "suggest" })).rejects.toBeInstanceOf(BranchOutdatedError);
  });
});
