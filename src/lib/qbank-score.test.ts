import { describe, expect, it } from "vitest";
import { scoreSet } from "./qbank-score";

const answers = (results: boolean[]) => results.map((is_correct) => ({ is_correct }));

describe("scoreSet", () => {
  it("counts an omitted question against the score", () => {
    // One right, nothing else answered, in a set of ten: 10%, not 100%.
    expect(scoreSet(answers([true]), 10)).toEqual({ correct: 1, incorrect: 0, omitted: 9, total: 10, pct: 10 });
  });

  it("scores a fully answered set on its answers", () => {
    expect(scoreSet(answers([true, true, false, true]), 4)).toEqual({
      correct: 3,
      incorrect: 1,
      omitted: 0,
      total: 4,
      pct: 75,
    });
  });

  it("never lets a stale, smaller total undercount the answers", () => {
    // A total stored before the fix counted attempts only.
    expect(scoreSet(answers([true, false, false]), 1).total).toBe(3);
  });

  it("is zero for an empty set", () => {
    expect(scoreSet([], 0)).toEqual({ correct: 0, incorrect: 0, omitted: 0, total: 0, pct: 0 });
  });
});
