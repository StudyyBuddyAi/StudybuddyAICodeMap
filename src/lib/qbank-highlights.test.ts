import { describe, it, expect } from "vitest";
import {
  addHighlight,
  findingsOf,
  leadInStart,
  normalizeRanges,
  removeHighlightAt,
  segmentText,
  splitSegmentsAt,
} from "./qbank-highlights";

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

describe("findingsOf", () => {
  it("lists highlighted phrases in reading order, whitespace folded", () => {
    const text = "A 19-year-old man.\nGlucose 520 mg/dL, pH 7.08.";
    expect(findingsOf(text, [[19, 36], [2, 13]])).toEqual([
      { start: 2, text: "19-year-old" },
      { start: 19, text: "Glucose 520 mg/dL" },
    ]);
  });
});

describe("leadInStart", () => {
  it("finds the question paragraph", () => {
    const text = "History.\n\nWhich of the following is most likely?";
    expect(leadInStart(text)).toBe(10);
  });

  it("leaves a stem without a separate question alone", () => {
    expect(leadInStart("One paragraph. Which drug?")).toBeNull();
    expect(leadInStart("History.\n\nMore history.")).toBeNull();
  });
});

describe("splitSegmentsAt", () => {
  it("cuts a run at the offset and keeps every run's start", () => {
    const segs = splitSegmentsAt(segmentText("abcdef", [[1, 4]]), 3);
    expect(segs.map((s) => [s.start, s.text, s.highlighted])).toEqual([
      [0, "a", false],
      [1, "bc", true],
      [3, "d", true],
      [4, "ef", false],
    ]);
  });
});
