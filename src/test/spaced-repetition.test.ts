import { describe, it, expect } from "vitest";
import { getNextReview, PROGRESSION, DAY_MS, AGAIN_DELAY_MS } from "@/lib/spaced-repetition";

const NOW = 1_700_000_000_000;

describe("getNextReview", () => {
  it("resets to a 10-minute delay on 'again'", () => {
    const next = getNextReview(7, "again", NOW);
    expect(next.interval).toBe(0);
    expect(next.dueAt).toBe(NOW + AGAIN_DELAY_MS);
    expect(next.lastReviewed).toBe(NOW);
  });

  it("moves a never-reviewed card to the first progression step on 'good'", () => {
    const next = getNextReview(0, "good", NOW);
    expect(next.interval).toBe(PROGRESSION[0]);
    expect(next.dueAt).toBe(NOW + PROGRESSION[0] * DAY_MS);
  });

  it("skips a step for 'easy' on a never-reviewed card", () => {
    const next = getNextReview(0, "easy", NOW);
    expect(next.interval).toBe(PROGRESSION[1]);
  });

  it("advances one step on 'good'", () => {
    expect(getNextReview(1, "good", NOW).interval).toBe(3);
    expect(getNextReview(3, "good", NOW).interval).toBe(7);
    expect(getNextReview(7, "good", NOW).interval).toBe(21);
    expect(getNextReview(21, "good", NOW).interval).toBe(60);
  });

  it("advances two steps on 'easy'", () => {
    expect(getNextReview(1, "easy", NOW).interval).toBe(7);
    expect(getNextReview(3, "easy", NOW).interval).toBe(21);
  });

  it("clamps at the last progression step", () => {
    expect(getNextReview(60, "good", NOW).interval).toBe(60);
    expect(getNextReview(60, "easy", NOW).interval).toBe(60);
    expect(getNextReview(21, "easy", NOW).interval).toBe(60);
  });

  it("falls back to the first step for an unknown interval", () => {
    expect(getNextReview(5, "good", NOW).interval).toBe(1);
  });
});
