import { describe, it, expect } from "vitest";
import {
  buildBatchPlan,
  permuteToPlannedLetter,
  type PermutableQuestion,
} from "../../supabase/functions/_shared/qbank-prompt.ts";

/** Deterministic stand-in for Math.random, so a plan is reproducible. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const question = (): PermutableQuestion => ({
  options: { a: "Alpha", b: "Bravo", c: "Charlie", d: "Delta", e: "Echo" },
  correctOption: "b",
  distractorExplanations: {
    a: "not alpha",
    c: "not charlie",
    d: "not delta",
    e: "not echo",
  },
});

describe("permuteToPlannedLetter", () => {
  it("moves the key onto the target letter and carries the text with it", () => {
    const moved = permuteToPlannedLetter(question(), "d");

    expect(moved.correctOption).toBe("d");
    // The two options traded places; the other three did not move.
    expect(moved.options.d).toBe("Bravo");
    expect(moved.options.b).toBe("Delta");
    expect(moved.options.a).toBe("Alpha");
    expect(moved.options.c).toBe("Charlie");
    expect(moved.options.e).toBe("Echo");
  });

  it("keeps each explanation attached to the option it describes", () => {
    const moved = permuteToPlannedLetter(question(), "d");

    // "not delta" describes the Delta option, which is now at b.
    expect(moved.distractorExplanations.b).toBe("not delta");
    // The new key must not carry a why-it-is-wrong entry — that is a block.
    expect(moved.distractorExplanations.d).toBeUndefined();
    expect(moved.distractorExplanations.a).toBe("not alpha");
  });

  it("is a no-op when the key already sits on the target", () => {
    expect(permuteToPlannedLetter(question(), "b")).toEqual(question());
  });

  it("does not mutate the question it was given", () => {
    const original = question();
    permuteToPlannedLetter(original, "e");
    expect(original.correctOption).toBe("b");
    expect(original.options.e).toBe("Echo");
  });
});

describe("buildBatchPlan", () => {
  it("keeps the 20/60/20 reasoning-order mix for a five-item batch", () => {
    const orders = buildBatchPlan("renal", 5, seeded(7)).questions.map((q) => q.reasoningOrder);
    expect(orders.filter((o) => o === "1st")).toHaveLength(1);
    expect(orders.filter((o) => o === "2nd")).toHaveLength(3);
    expect(orders.filter((o) => o === "3rd")).toHaveLength(1);
  });

  it("does not put the easy item first every time", () => {
    // The mix used to be emitted in order, so every batch ramped identically
    // and the model labelled Q1 Easy and Q5 Hard in all of them.
    const firsts = Array.from({ length: 24 }, (_, i) =>
      buildBatchPlan("renal", 5, seeded(i + 1)).questions[0].reasoningOrder
    );
    expect(new Set(firsts).size).toBeGreaterThan(1);
  });

  it("spreads the answer letters across all five before repeating", () => {
    const letters = buildBatchPlan("renal", 5, seeded(3)).questions.map((q) => q.answerLetter);
    expect(new Set(letters).size).toBe(5);
  });
});
