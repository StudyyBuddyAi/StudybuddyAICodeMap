import { afterEach, describe, it, expect, vi } from "vitest";
import {
  BranchHttpError,
  BranchIncompleteError,
  BranchOutdatedError,
  BranchQuotaError,
  comprehensivePicks,
  bestAnchor,
  branchMarkdown,
  isTransient,
  namedLabel,
  markdownBlocks,
  plainText,
  readBranch,
  readSuggestions,
  runBranchRequest,
} from "./sheet-branches";
import {
  addBranch,
  branchPath,
  descendantCount,
  editBranch,
  emptyLayer,
  isEmptyLayer,
  layerBranchesText,
  parseLayer,
  removeBranch,
  replaceSectionPills,
  rewriteSection,
  setPills,
} from "./sheet-layer";
import { requestSignature } from "./sheet-signature";
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
      "My deep dives\n\n# Clinical Approach\n\n## Conservative trial\n\n1. Decompress.\n\n### Gastrografin\n\nDose\n100 mL."
    );
    expect(layerBranchesText(sheet, emptyLayer())).toBe("");
  });
});

// ── The request itself ─────────────────────────────────────────────────────

const sse = (frames: unknown[], done = true) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const f of frames) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(f)}\n\n`));
        if (done) c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        c.close();
      },
    })
  );
const delta = (content: string) => ({ choices: [{ index: 0, delta: { content } }] });

describe("runBranchRequest", () => {
  const sheet = { plan: ["overview"], sections: { overview: "Mechanism: x." }, topic: "SBO", sourceIds: [], signature: null, examMode: "USMLE Step 2" };
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

  it("never takes a reply that ended without [DONE] for a whole one", async () => {
    vi.mocked(callMedicalNotes).mockResolvedValue(sse([delta('{"paragraphs": ["**Half a head.** cut off in the mid')], false));
    const err = await runBranchRequest(sheet, { action: "suggest" }).catch((e) => e);
    expect(err).toBeInstanceOf(BranchIncompleteError);
    expect(isTransient(err)).toBe(true);
  });

  it("hands on the review: checking, then its verdict — neither a sign of an old server", async () => {
    const review = { verdict: "corrected", fixes: ["peaked T waves → hyperkalemia"], branch: { steps: ["**Hold K+** — now."] } };
    vi.mocked(callMedicalNotes).mockResolvedValue(
      sse([delta('{"steps": ["x"]}'), { __meta: { stage: "reviewing" } }, { __meta: { review } }])
    );
    const seen: string[] = [];
    await runBranchRequest(sheet, { action: "suggest" }, { onReviewing: () => seen.push("reviewing"), onReview: (r) => seen.push(r.verdict) });
    expect(seen).toEqual(["reviewing", "corrected"]);
  });

  it("marks a server error as worth one more try, a bad request not", async () => {
    vi.mocked(callMedicalNotes).mockResolvedValue(new Response("{}", { status: 500 }));
    const err = await runBranchRequest(sheet, { action: "suggest" }).catch((e) => e);
    expect(err).toBeInstanceOf(BranchHttpError);
    expect(isTransient(err)).toBe(true);
    expect(isTransient(new BranchHttpError(400))).toBe(false);
    expect(isTransient(new BranchQuotaError())).toBe(false);
  });
});

describe("what a grow reply says besides its branch", () => {
  it("passes on a declined question, keeping nothing", () => {
    const r = readBranch('{"offTopic": true, "message": "I can help with DKA here."}', "ask", { topic: "DKA" });
    expect(r.offTopic).toBe("I can help with DKA here.");
    expect(r.markdown).toBe("");
  });

  it("names the student's own question by what the answer covers", () => {
    const r = readBranch('{"label": "Why magnesium comes first", "paragraphs": ["Replace Mg."]}', "ask", { topic: "DKA" });
    expect(r.label).toBe("Magnesium comes first");
  });

  it("drops a Why or How opener from a label, but not How to", () => {
    expect(namedLabel("Why fat breakdown makes acid")).toBe("Fat breakdown makes acid");
    expect(namedLabel("How insulin shifts K+?")).toBe("Insulin shifts K+");
    expect(namedLabel("How to dose insulin")).toBe("How to dose insulin");
    expect(namedLabel("Potassium before insulin")).toBe("Potassium before insulin");
  });
});

describe("the layer's newer parts", () => {
  const q = { type: "mechanism" as const, label: "x", ask: "x?" };

  it("replaces only a rewritten section's suggestions", () => {
    const l = setPills(emptyLayer(), [
      { ...q, anchor: "overview:0" },
      { ...q, label: "y", anchor: "clinicalApproach:1" },
    ]);
    const next = replaceSectionPills(l, ["clinicalApproach"], [{ ...q, label: "new", anchor: "clinicalApproach:0" }]);
    expect(next.pills.map((p) => `${p.anchor}:${p.label}`)).toEqual(["overview:0:x", "clinicalApproach:0:new"]);
  });

  it("counts every branch below one, at any depth", () => {
    let l = emptyLayer();
    const b = (id: string, parentId?: string) => ({ id, anchor: "overview:0", ...(parentId ? { parentId } : {}), ...q, text: "t", next: [], source: "ai" as const });
    l = addBranch(l, b("a"));
    l = addBranch(l, b("b", "a"));
    l = addBranch(l, b("c", "b"));
    l = addBranch(l, b("d", "a"));
    expect(descendantCount(l, "a")).toBe(3);
  });

  it("keeps a branch's review, and a rewrite's signature, through saving", () => {
    const sig = "s".repeat(43);
    let l = addBranch(emptyLayer(), { id: "a", anchor: "overview:0", ...q, text: "t", next: [], source: "ai", review: { verdict: "corrected", fixes: ["x → y"] } });
    l = rewriteSection(l, { overview: "New." }, "simpler", { overview: sig });
    const back = parseLayer(JSON.parse(JSON.stringify(l)));
    expect(back.branches[0].review).toEqual({ verdict: "corrected", fixes: ["x → y"] });
    expect(back.sections.overview.sig).toBe(sig);
  });

  it("sends a rewritten section's own signature, and leaves one without unsigned", () => {
    const sheet = { signature: { v: 1 as const, topic: "DKA", sections: { overview: "o".repeat(43), clinicalApproach: "c".repeat(43) } } } as unknown as GeneratedSheet;
    let l = rewriteSection(emptyLayer(), { overview: "New." }, "simpler", { overview: "n".repeat(43) });
    l = rewriteSection(l, { clinicalApproach: "New too." }, "simpler");
    const sig = requestSignature(sheet, l)!;
    expect(sig.sections.overview).toBe("n".repeat(43));
    expect(sig.sections.clinicalApproach).toBeUndefined();
    expect(requestSignature({} as GeneratedSheet, l)).toBeNull();
  });
});

describe("the student's own question, in the shape they asked for", () => {
  const ctx = { topic: "DKA" };

  it("reads a table with its own column headings", () => {
    const md = branchMarkdown("ask", { columns: ["Score", "Cut-off"], rows: [["BISAP", "≥3"], ["Ranson", "≥3 | severe"]], takeaway: "Both use 3." }, ctx);
    expect(md).toBe("| Score | Cut-off |\n| --- | --- |\n| BISAP | ≥3 |\n| Ranson | ≥3 / severe |\n\n> Both use 3.");
    expect(markdownBlocks(md)[0]).toMatchObject({ kind: "table", header: ["Score", "Cut-off"] });
  });

  it("reads a mnemonic: the word bold, each part bold before what it stands for", () => {
    const md = branchMarkdown("ask", { mnemonic: "BISAP", lines: ["B — BUN > 25", "I: Impaired mental status"], tip: "3 or more is severe." }, ctx);
    expect(md).toBe("**BISAP**\n\n- **B** — BUN > 25\n- **I** — Impaired mental status\n\n> 3 or more is severe.");
  });

  it("reads steps, a drug card and a case as their kinds do", () => {
    expect(branchMarkdown("ask", { steps: ["**Give fluids** — 1 L."] }, ctx)).toBe("1. **Give fluids** — 1 L.");
    expect(branchMarkdown("ask", { profile: ["Class: insulin"] }, ctx)).toBe("- **Class:** insulin");
    expect(branchMarkdown("ask", { stem: "A man.", question: "Next?", answer: "Fluids." }, ctx)).toContain("> **Answer:** Fluids.");
    expect(branchMarkdown("ask", { paragraphs: ["Plain."] }, ctx)).toBe("Plain.");
  });
});

describe("where a question of the whole sheet goes", () => {
  const sections = {
    overview: "Mechanism: insulin deficiency drives ketogenesis.\n\nPathophysiology: osmotic diuresis dehydrates.",
    clinicalApproach: ["Give isotonic fluids first.", "Start the insulin infusion once potassium is above 3.3."],
    memoryHooks: ["Potassium potassium potassium"],
  };
  const keys = ["overview", "clinicalApproach", "memoryHooks"];

  it("finds the line that shares most of its words, counting lines as the page anchors them", () => {
    expect(bestAnchor(sections, keys, "When can the insulin infusion start given potassium?")).toBe("clinicalApproach:1");
    expect(bestAnchor(sections, keys, "Why does osmotic diuresis happen?")).toBe("overview:2");
  });

  it("never picks the mnemonics, and gives up when nothing matches", () => {
    expect(bestAnchor(sections, keys, "potassium")).toBe("clinicalApproach:1");
    expect(bestAnchor(sections, keys, "What about the weather today?")).toBeNull();
  });
});
