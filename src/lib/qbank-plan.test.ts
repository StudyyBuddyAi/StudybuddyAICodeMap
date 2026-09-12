import { describe, it, expect } from "vitest";
import {
  buildBatchPlan,
  buildUserMessage,
  permuteToPlannedLetter,
  asChallengeLevel,
  asExamMode,
  type PermutableQuestion,
  type ChallengeLevel,
  type ReasoningOrder,
  type ExamTrack,
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

describe("buildBatchPlan challenge levels", () => {
  const ordersFor = (level: ChallengeLevel, count = 20) =>
    buildBatchPlan("renal", count, seeded(11), 1, level).questions.map(
      (q) => q.reasoningOrder
    );

  const count = (orders: ReasoningOrder[], of: ReasoningOrder) =>
    orders.filter((o) => o === of).length;

  it("defaults to the balanced mix when no level is given", () => {
    const withDefault = buildBatchPlan("renal", 20, seeded(11)).questions.map(
      (q) => q.reasoningOrder
    );
    expect(withDefault).toEqual(ordersFor("balanced"));
  });

  it("shifts toward 1st-order for foundations and 3rd-order for challenge", () => {
    const foundations = ordersFor("foundations");
    const challenge = ordersFor("challenge");

    // The dial has to actually move the thing it claims to move: more recall
    // at the easy end, more multi-step at the hard end, in both directions.
    expect(count(foundations, "1st")).toBeGreaterThan(count(challenge, "1st"));
    expect(count(challenge, "3rd")).toBeGreaterThan(count(foundations, "3rd"));
  });

  it("keeps every set to the size it was asked for, at every level", () => {
    for (const level of ["foundations", "balanced", "challenge"] as ChallengeLevel[]) {
      for (const size of [5, 10, 15, 20]) {
        expect(ordersFor(level, size)).toHaveLength(size);
      }
    }
  });

  it("records the level on the plan, so the prompt can name it", () => {
    expect(buildBatchPlan("renal", 5, seeded(1), 1, "challenge").challenge).toBe(
      "challenge"
    );
  });
});

describe("buildBatchPlan exam tracks", () => {
  const tracksFor = (mode: "step1" | "step2ck" | "mixed", count = 20, seed = 11, startIndex = 1) =>
    buildBatchPlan("renal", count, seeded(seed), startIndex, "balanced", mode).questions.map(
      (q) => q.examTrack
    );

  const count = (tracks: ExamTrack[], of: ExamTrack) => tracks.filter((t) => t === of).length;

  it("writes every item on the mode's own track for a concrete mode", () => {
    expect(new Set(tracksFor("step1"))).toEqual(new Set(["step1"]));
    expect(new Set(tracksFor("step2ck"))).toEqual(new Set(["step2ck"]));
  });

  it("defaults to step1 when no mode is given, and records the mode on the plan", () => {
    const plan = buildBatchPlan("renal", 5, seeded(1));
    expect(plan.examMode).toBe("step1");
    expect(plan.questions.every((q) => q.examTrack === "step1")).toBe(true);
    expect(buildBatchPlan("renal", 5, seeded(1), 1, "balanced", "mixed").examMode).toBe("mixed");
  });

  it("leaves a step1 plan exactly as it was before modes existed", () => {
    // The mixed branch is the only one that draws from `random`, so a step1
    // plan for a given seed has the same letters and orders it always had.
    const before = buildBatchPlan("renal", 5, seeded(7)).questions.map(
      ({ index, answerLetter, reasoningOrder }) => ({ index, answerLetter, reasoningOrder })
    );
    const after = buildBatchPlan("renal", 5, seeded(7), 1, "balanced", "step1").questions.map(
      ({ index, answerLetter, reasoningOrder }) => ({ index, answerLetter, reasoningOrder })
    );
    expect(after).toEqual(before);
  });

  it("splits a mixed wave as evenly as its size allows", () => {
    for (const size of [5, 8, 10, 20]) {
      const tracks = tracksFor("mixed", size);
      expect(tracks).toHaveLength(size);
      expect(Math.abs(count(tracks, "step1") - count(tracks, "step2ck"))).toBeLessThanOrEqual(1);
    }
  });

  it("does not put the same track first every time", () => {
    // Emitted in order, every mixed set would open on the same track and the
    // student would learn the pattern — the same reason orders are shuffled.
    const firsts = Array.from({ length: 24 }, (_, i) => tracksFor("mixed", 5, i + 1)[0]);
    expect(new Set(firsts).size).toBe(2);
  });

  it("gives an odd wave's spare item to either track, not always the same one", () => {
    const majorities = Array.from({ length: 24 }, (_, i) => {
      const tracks = tracksFor("mixed", 5, i + 1);
      return count(tracks, "step1") > count(tracks, "step2ck") ? "step1" : "step2ck";
    });
    expect(new Set(majorities).size).toBe(2);
  });

  it("keeps the split and the numbering stable under startIndex", () => {
    const plan = buildBatchPlan("renal", 5, seeded(3), 11, "balanced", "mixed");
    expect(plan.questions.map((q) => q.index)).toEqual([11, 12, 13, 14, 15]);
    const tracks = plan.questions.map((q) => q.examTrack);
    expect(Math.abs(count(tracks, "step1") - count(tracks, "step2ck"))).toBeLessThanOrEqual(1);
    // Same seed, different start: the tracks are the same, only the numbering moved.
    expect(tracks).toEqual(tracksFor("mixed", 5, 3, 1));
  });
});

describe("buildUserMessage exam modes", () => {
  it("names the track on every plan row of a mixed set, and on none of a concrete set", () => {
    const mixed = buildUserMessage({
      topic: "hyperkalaemia",
      plan: buildBatchPlan("renal", 5, seeded(2), 1, "balanced", "mixed"),
    });
    expect(mixed).toMatch(/- Question 1: Step (1|2 CK) item, reasoning order/);
    expect(mixed).toContain("(Step 1 track)");
    expect(mixed).toContain("(Step 2 CK track)");

    const step1 = buildUserMessage({
      topic: "hyperkalaemia",
      plan: buildBatchPlan("renal", 5, seeded(2), 1, "balanced", "step1"),
    });
    expect(step1).not.toMatch(/Step 1 item/);
    expect(step1).not.toContain("Step 2 CK Content Outline");
    // The Step 1 brief keeps v13's competency line, MOA guard included.
    expect(step1).toContain("never which protocol");
  });

  it("does not hand a Step 2 CK set the Step 1 competency guard", () => {
    const step2 = buildUserMessage({
      topic: "hyperkalaemia",
      plan: buildBatchPlan("renal", 5, seeded(2), 1, "balanced", "step2ck"),
    });
    expect(step2).toContain("Step 2 CK Content Outline");
    expect(step2).not.toContain("never which protocol");
    expect(step2).not.toContain("SYSTEM DRIFT TRAPS");
  });
});

describe("asExamMode", () => {
  it("passes the three real modes through", () => {
    expect(asExamMode("step1")).toBe("step1");
    expect(asExamMode("step2ck")).toBe("step2ck");
    expect(asExamMode("mixed")).toBe("mixed");
  });

  it("falls back to step1 for anything else", () => {
    // A client that predates the control sends nothing, and Step 1 is the
    // only thing it could have been asking for.
    for (const bad of [undefined, null, "", "step2", "Step 1", 1, {}, ["mixed"]]) {
      expect(asExamMode(bad)).toBe("step1");
    }
  });
});

describe("asChallengeLevel", () => {
  it("passes the three real levels through", () => {
    expect(asChallengeLevel("foundations")).toBe("foundations");
    expect(asChallengeLevel("balanced")).toBe("balanced");
    expect(asChallengeLevel("challenge")).toBe("challenge");
  });

  it("falls back to the default for anything else", () => {
    // A request body is untrusted input, and an unknown level must not be able
    // to fail a generation — it is a shape control, not a precondition.
    for (const bad of [undefined, null, "", "hard", 3, {}, ["challenge"]]) {
      expect(asChallengeLevel(bad)).toBe("balanced");
    }
  });
});
