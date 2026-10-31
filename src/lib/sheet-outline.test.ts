import { describe, it, expect } from "vitest";
import {
  DEFAULT_BLOCK_LABELS,
  DEFAULT_COLUMNS,
  attachBlocks,
  parseOutline as parseServerOutline,
  parseWarmup as parseServerWarmup,
  toWireOutline,
} from "../../supabase/functions/_shared/sheet-outline.ts";
import {
  MAX_SECTIONS,
  isShapedPlan,
  parsePlanHints,
  resolvePlanFromKeys,
  resolveShapedPlan,
  resolveSheetPlan,
  toWirePlan,
} from "../../supabase/functions/_shared/sheet-plan.ts";
import { GROUP_HOME, flowBlock, schemaLine } from "../../supabase/functions/_shared/sheet-schema.ts";
import { parseOutline, parseWarmup } from "./sheet-outline";
import { parsePlan, planHints } from "./sheet-plan";

/**
 * Topic-shaped sheets: a topic its outline reads as a group (a family, or a
 * set of look-alikes) is taught block by block — a map, a block per member
 * under the same labels, a table that tells them apart — while one thing keeps
 * its archetype's sections. These check the outline's validation, the plan it
 * produces, what the writer is shown, and the follow-up path for blocks.
 */

const neonatal = {
  shape: "survey",
  axis: "timing after birth",
  blocks: ["Neonatal assessment", "Respiratory distress — RDS, TTN", "Jaundice"],
  labels: ["Who and when", "Why it happens", "How it shows up", "How to confirm", "How to treat"],
  ownLabels: { "Neonatal assessment": ["What it is", "When", "How it is done", "What it changes"] },
  columns: ["Condition", "Timing", "Clue and workup"],
};

const jaundiceQ = {
  q: "Jaundice in the first 24 hours of life is…",
  options: ["Physiologic", "Pathologic until proven otherwise", "Breast-milk jaundice"],
  answer: 1,
  why: "Early jaundice means haemolysis until proven otherwise.",
  block: "Jaundice",
};

const outlineOf = (over: Record<string, unknown> = {}) => parseServerOutline(JSON.stringify({ ...neonatal, ...over }))!;

describe("parseOutline (server)", () => {
  it("reads a group: blocks in order, shared labels, a block's own labels, the table headers", () => {
    const o = outlineOf();
    expect(o.shape).toBe("survey");
    expect(o.blocks.map((b) => b.name)).toEqual(neonatal.blocks);
    expect(o.blocks[0].labels).toEqual(neonatal.ownLabels["Neonatal assessment"]);
    expect(o.blocks[2].labels).toEqual(neonatal.labels);
    expect(o.columns).toEqual(neonatal.columns);
  });

  it("falls back to illness-script labels when the outline's won't render as labels", () => {
    expect(outlineOf({ labels: ["who & when", "Why", "How it shows up"] }).blocks[1].labels).toEqual(DEFAULT_BLOCK_LABELS);
    expect(outlineOf({ labels: ["Who (age)", "Why it happens", "How to treat"] }).blocks[1].labels).toEqual(DEFAULT_BLOCK_LABELS);
    expect(outlineOf({ columns: ["Only one"] }).columns).toEqual(DEFAULT_COLUMNS);
  });

  it("reads a group with fewer than two blocks as one thing", () => {
    const o = outlineOf({ blocks: ["Jaundice"] });
    expect(o.shape).toBe("single");
    expect(o.blocks).toEqual([]);
  });

  it("caps a group at five blocks", () => {
    expect(outlineOf({ blocks: ["A1", "B1", "C1", "D1", "E1", "F1", "G1"] }).blocks).toHaveLength(5);
  });

  it("returns null for a reply it can't use", () => {
    expect(parseServerOutline("not json")).toBeNull();
    expect(parseServerOutline(JSON.stringify({ shape: "blob" }))).toBeNull();
  });

  it("sends the page the shape, the axis and the block names, nothing else", () => {
    expect(toWireOutline(outlineOf())).toEqual({ shape: "survey", axis: "timing after birth", blocks: neonatal.blocks });
  });
});

describe("the warm-up (server)", () => {
  const { block: _block, ...jaundiceDraft } = { ...jaundiceQ, about: "neonatal jaundice" };
  const read = (warmup: unknown[]) => parseServerWarmup(JSON.stringify({ warmup }));

  it("keeps a question that holds together, with what it is about", () => {
    expect(read([jaundiceDraft])).toEqual([jaundiceDraft]);
  });

  it("drops a question that doesn't hold together", () => {
    for (const bad of [
      { q: "One option?", options: ["a"], answer: 0, why: "x" },
      { q: "Answer out of range?", options: ["a", "b", "c"], answer: 3, why: "x" },
      { q: "Duplicate options?", options: ["a", "a", "b"], answer: 0, why: "x" },
      { q: "No why?", options: ["a", "b", "c"], answer: 0 },
    ]) {
      expect(read([bad]), bad.q).toEqual([]);
    }
  });

  it("reads two questions at most", () => {
    const two = read([
      { q: "Fine?", options: ["a", "b", "c"], answer: 2, why: "Because.", about: "x" },
      { q: "Also fine?", options: ["a", "b", "c", "d"], answer: 0, why: "So." },
      { q: "Third", options: ["a", "b", "c"], answer: 0, why: "x" },
    ]);
    expect(two.map((w) => w.q)).toEqual(["Fine?", "Also fine?"]);
    expect(two[1].about).toBe("");
    expect(parseServerWarmup("not json")).toEqual([]);
  });

  it("points each question at the block it is about, by name", () => {
    const blocks = ["Neonatal assessment — Apgar, screening", "Respiratory distress — RDS, TTN", "Jaundice — physiologic vs pathologic"];
    const [q] = attachBlocks([jaundiceDraft], blocks);
    expect(q.block).toBe("Jaundice — physiologic vs pathologic");
    expect("about" in q).toBe(false);
    const rds = attachBlocks([{ ...jaundiceDraft, q: "Which infants lack surfactant?", about: "respiratory distress syndrome" }], blocks);
    expect(rds[0].block).toBe("Respiratory distress — RDS, TTN");
  });

  it("names no block when nothing matches, or when the sheet has none", () => {
    expect(attachBlocks([{ ...jaundiceDraft, about: "kernicterus", q: "What causes kernicterus?" }], ["Croup", "Epiglottitis"])[0].block).toBeUndefined();
    expect(attachBlocks([jaundiceDraft], [])[0].block).toBeUndefined();
  });
});

describe("resolveShapedPlan", () => {
  const plan = resolveShapedPlan(outlineOf(), { examMode: "USMLE Step 2", difficulty: "Advanced" })!;

  it("teaches a group as map → blocks → table → hooks → traps", () => {
    expect(plan.map((s) => s.key)).toEqual(["map", "part1", "part2", "part3", "tellApart", "memoryHooks", "examTraps"]);
    expect(plan.length).toBeLessThanOrEqual(MAX_SECTIONS);
    expect(isShapedPlan(plan)).toBe(true);
  });

  it("names each block after its member and gives it the member's labels", () => {
    expect(plan.slice(1, 4).map((s) => s.title)).toEqual(neonatal.blocks);
    expect(plan[1].coreLabels).toEqual(neonatal.ownLabels["Neonatal assessment"]);
    expect(plan[3].coreLabels).toEqual(neonatal.labels);
    expect(plan[3].brief).toContain("Jaundice");
  });

  it("gives the table the outline's headers and room for a row per member", () => {
    const table = plan.find((s) => s.key === "tellApart")!;
    expect(table.columns).toEqual(neonatal.columns);
    expect(table.items).toEqual([3, 6]);
  });

  it("sends the block titles and headers to the page in the plan, which the page accepts", () => {
    const wire = parsePlan(toWirePlan(plan))!;
    expect(wire.map((s) => s.title)).toEqual(plan.map((s) => s.title));
    expect(wire.find((s) => s.key === "tellApart")?.columns).toEqual(neonatal.columns);
  });

  it("leaves one thing, one story or no outline to its archetype", () => {
    expect(resolveShapedPlan(outlineOf({ shape: "single" }))).toBeNull();
    expect(resolveShapedPlan(outlineOf({ shape: "linked" }))).toBeNull();
    expect(resolveShapedPlan(null)).toBeNull();
    expect(isShapedPlan(resolveSheetPlan({ archetype: "condition" }))).toBe(false);
  });
});

// The assembled prompt (medical-notes-prompts-corti.ts) imports Deno-only
// modules, so these check the pieces it is built from, as the other prompt
// tests do: the skeleton line per section and the flow rules it appends.
describe("what the writer is shown", () => {
  const shaped = resolveShapedPlan(outlineOf(), { examMode: "USMLE Step 2" })!;

  it("asks a group sheet for its map in paragraphs and its blocks under their own labels", () => {
    const map = schemaLine(shaped[0]);
    expect(map).toContain('"map": "<How this group fits together');
    expect(map).toContain("Every paragraph starts on its own line");
    expect(map).not.toContain("Every label above");
    const jaundice = schemaLine(shaped[3]);
    expect(jaundice).toContain("Who and when: …");
    expect(jaundice).toContain("Every label above starts on its own line");
  });

  it("opens a sheet without a map with what ties it together, and connects its lines by difficulty", () => {
    expect(flowBlock("Basic", { opener: true })).toContain('"In short:"');
    expect(flowBlock("Basic", { opener: true })).toContain("every term defined the first time it appears");
    expect(flowBlock("Advanced", { opener: false })).toContain("Write compactly");
    expect(flowBlock("Advanced", { opener: false })).not.toContain('"In short:"');
    expect(flowBlock(undefined, { opener: false })).toContain("Write in full, connected sentences");
    expect(GROUP_HOME).toContain("Each block holds everything about its own member");
  });

  it("keeps the labelled-line rule for every archetype section", () => {
    for (const s of resolveSheetPlan({ archetype: "condition", examMode: "USMLE Step 2", difficulty: "Advanced" })) {
      if (s.kind === "prose") expect(schemaLine(s)).toContain("Every label above starts on its own line");
    }
  });
});

describe("follow-ups on a group sheet", () => {
  const keys = ["map", "part1", "part2", "part3", "tellApart", "memoryHooks", "examTraps"];
  const sections = { part3: "Who and when: after 24 h.\nWhy it happens: immature UGT.\nHow to treat: phototherapy." };

  it("takes block titles and table headers from the page, and a block's labels from its own lines", () => {
    const hints = parsePlanHints({ titles: { part3: "Jaundice" }, columns: { tellApart: ["Condition", "Timing", "Clue"] } });
    const plan = resolvePlanFromKeys(keys, "USMLE Step 2", hints, sections);
    const part3 = plan.find((s) => s.key === "part3")!;
    expect(part3.title).toBe("Jaundice");
    expect(part3.coreLabels).toEqual(["Who and when", "Why it happens", "How to treat"]);
    expect(plan.find((s) => s.key === "tellApart")!.columns).toEqual(["Condition", "Timing", "Clue"]);
  });

  it("reads hints only for a group's own sections, trimmed", () => {
    const hints = parsePlanHints({
      titles: { overview: "Renamed", part1: `  ${"x".repeat(200)}  ` },
      columns: { tellApart: ["only one"], differentials: ["A", "B", "C"] },
    });
    expect(hints.titles).toEqual({ part1: "x".repeat(120) });
    expect(hints.columns).toEqual({});
    expect(parsePlanHints("nonsense")).toEqual({});
  });

  it("is what the page sends: every title and every table's headers", () => {
    const plan = parsePlan(toWirePlan(resolveShapedPlan(outlineOf())!))!;
    const hints = planHints(plan);
    expect(hints.titles.part3).toBe("Jaundice");
    expect(hints.columns.tellApart).toEqual(neonatal.columns);
  });
});

describe("the page's frames", () => {
  it("accepts the server's outline and warm-up", () => {
    expect(parseOutline(toWireOutline(outlineOf()))).toEqual(toWireOutline(outlineOf()));
    expect(parseWarmup([jaundiceQ], neonatal.blocks)).toEqual([jaundiceQ]);
  });

  it("ignores a frame that isn't an outline, and a question that doesn't hold together", () => {
    expect(parseOutline(null)).toBeNull();
    expect(parseOutline({ shape: "nope" })).toBeNull();
    expect(parseWarmup([{ q: "x?", options: ["a", "b"], answer: 0, why: "y" }], [])).toEqual([]);
    expect(parseWarmup("nonsense", [])).toEqual([]);
  });

  it("drops a block a question names when the sheet has no such block", () => {
    expect(parseWarmup([jaundiceQ], [])[0].block).toBeUndefined();
  });
});
