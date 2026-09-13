import { describe, it, expect } from "vitest";
import { addHighlight, normalizeRanges, removeHighlightAt, segmentText } from "./qbank-highlights";

describe("normalizeRanges", () => {
  it("sorts, merges overlaps and joins touching ranges", () => {
    expect(normalizeRanges([[10, 15], [0, 4], [3, 6], [6, 8]])).toEqual([[0, 8], [10, 15]]);
  });

  it("clamps to the text and drops empty ranges", () => {
    expect(normalizeRanges([[-2, 3], [8, 50], [4, 4]], 10)).toEqual([[0, 3], [8, 10]]);
  });
});

describe("addHighlight / removeHighlightAt", () => {
  it("adds into the merged set and removes by position", () => {
    let r = addHighlight([], [2, 5]);
    r = addHighlight(r, [4, 9]);
    expect(r).toEqual([[2, 9]]);
    expect(removeHighlightAt(r, 6)).toEqual([]);
    expect(removeHighlightAt(r, 9)).toEqual([[2, 9]]);
  });
});

describe("segmentText", () => {
  it("covers the whole text with alternating runs", () => {
    const text = "A 54-year-old man with chest pain";
    const segs = segmentText(text, [[2, 13], [23, 33]]);
    expect(segs.map((s) => s.text).join("")).toBe(text);
    expect(segs.filter((s) => s.highlighted).map((s) => s.text)).toEqual(["54-year-old", "chest pain"]);
    expect(segs[1].start).toBe(2);
  });

  it("returns the text unchanged when nothing is highlighted", () => {
    expect(segmentText("plain", [])).toEqual([{ text: "plain", start: 0, highlighted: false }]);
  });
});
