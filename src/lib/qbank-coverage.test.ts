import { describe, it, expect } from "vitest";
import { memoryNote, mergeCoverage, parseCoverage, topicStandings } from "./qbank-coverage";
import type { TopicCoverage } from "./qbank-types";
import type { BlueprintRow } from "./qbank-wave-runner";

const row = (mode: BlueprintRow["mode"], index = 1): BlueprintRow => ({ index, reasoningOrder: "2nd", focus: null, mode });
const cov = (over: Partial<TopicCoverage> = {}): TopicCoverage => ({
  topic: "Warfarin",
  examTrack: "step1",
  total: 20,
  covered: 5,
  exhausted: false,
  broader: "Anticoagulants",
  ...over,
});

describe("memoryNote", () => {
  it("says nothing when the writer chose freely", () => {
    expect(memoryNote([])).toBeNull();
    expect(memoryNote([row(null), row(null)])).toBeNull();
  });

  it("names a wave of unmet concepts as such", () => {
    expect(memoryNote([row("new"), row("new")])).toBe("Built from your history: concepts you haven't been asked yet.");
  });

  it("counts each kind when the wave mixes them", () => {
    expect(memoryNote([row("new"), row("revisit"), row("retest"), row("retest"), row(null)])).toBe(
      "Built from your history: 1 new concept, a concept you missed before, asked a new way, 2 concepts from a while back."
    );
  });

  it("describes a lone revisit on an otherwise free wave", () => {
    expect(memoryNote([row(null), row("revisit")])).toBe("Built from your history: a concept you missed before, asked a new way.");
  });
});

describe("parseCoverage", () => {
  it("keeps well-formed entries and drops the rest", () => {
    expect(parseCoverage([cov(), { topic: "" }, { topic: "X", total: "many" }, null, "x"])).toEqual([cov()]);
    expect(parseCoverage(undefined)).toEqual([]);
  });

  it("defaults an unknown track and an empty broader", () => {
    const [c] = parseCoverage([{ ...cov(), examTrack: "mixed", broader: "" }]);
    expect(c.examTrack).toBe("step1");
    expect(c.broader).toBeNull();
  });
});

describe("mergeCoverage", () => {
  it("replaces a topic's report per track and keeps other topics", () => {
    const merged = mergeCoverage(
      [cov({ covered: 5 }), cov({ topic: "DKA", covered: 3 }), cov({ examTrack: "step2ck", covered: 1 })],
      [cov({ topic: "warfarin", covered: 10 })]
    );
    expect(merged.map((c) => [c.topic, c.examTrack, c.covered])).toEqual([
      ["warfarin", "step1", 10],
      ["DKA", "step1", 3],
      ["Warfarin", "step2ck", 1],
    ]);
  });
});

describe("topicStandings", () => {
  it("combines a topic's tracks and calls it used up only when every track is", () => {
    const [s] = topicStandings([cov({ covered: 20, exhausted: true }), cov({ examTrack: "step2ck", covered: 4, total: 15 })]);
    expect(s).toEqual({ topic: "Warfarin", covered: 24, total: 35, exhausted: false, broader: "Anticoagulants" });
  });

  it("puts used-up topics first, and never counts past the total", () => {
    const list = topicStandings([cov({ topic: "DKA" }), cov({ covered: 25, exhausted: true })]);
    expect(list.map((s) => [s.topic, s.covered, s.exhausted])).toEqual([
      ["Warfarin", 20, true],
      ["DKA", 5, false],
    ]);
  });

  it("is empty without coverage", () => {
    expect(topicStandings(undefined)).toEqual([]);
    expect(topicStandings([cov({ total: 0 })])).toEqual([]);
  });
});
