import { describe, it, expect } from "vitest";
import {
  buildDistractorExplanations,
  permuteToPlannedLetter,
  type PermutableQuestion,
} from "../../supabase/functions/_shared/qbank-prompt.ts";

/**
 * The wrong-option explanations, as they reach the `questions` row.
 *
 * These used to be flattened into the single `explanation` column, so the only
 * thing that could go wrong was the prose. Now they are stored keyed by option
 * letter and rendered under the option they describe, which makes the LETTER
 * the thing that has to be right: an explanation filed against the wrong option
 * tells a student the answer they got correct was wrong.
 */

const question = (over: Partial<PermutableQuestion> = {}): PermutableQuestion => ({
  options: { a: "Alpha", b: "Bravo", c: "Charlie", d: "Delta", e: "Echo" },
  correctOption: "b",
  distractorExplanations: {
    a: "not alpha",
    c: "not charlie",
    d: "not delta",
    e: "not echo",
  },
  ...over,
});

describe("buildDistractorExplanations", () => {
  it("keeps every wrong option's explanation under its own letter", () => {
    expect(buildDistractorExplanations(question())).toEqual({
      a: "not alpha",
      c: "not charlie",
      d: "not delta",
      e: "not echo",
    });
  });

  it("never files an entry against the correct answer", () => {
    // The model is told not to write one and the QA gate blocks an item that
    // does (`distractor-explains-key`), but this is the last place it can be
    // stopped before it renders under the option the student got right.
    const built = buildDistractorExplanations(
      question({
        distractorExplanations: { a: "not alpha", b: "not bravo", c: "not charlie" },
      })
    );

    expect(built.b).toBeUndefined();
    expect(built.a).toBe("not alpha");
  });

  it("returns an empty object rather than null when none were written", () => {
    // Empty and absent mean different things downstream: empty is "this set
    // wrote none", null is "this row predates the column".
    expect(buildDistractorExplanations(question({ distractorExplanations: {} }))).toEqual(
      {}
    );
  });

  it("drops blank entries instead of storing an empty explanation", () => {
    const built = buildDistractorExplanations(
      question({ distractorExplanations: { a: "not alpha", c: "", d: undefined } })
    );

    expect(built).toEqual({ a: "not alpha" });
  });

  it("follows the key when the options are permuted onto the planned letter", () => {
    // permuteToPlannedLetter swaps two options and carries their explanations
    // with them. Building the column AFTER the permutation is what keeps each
    // sentence attached to the text it describes — and what keeps the new key
    // from carrying a why-it-is-wrong entry.
    const built = buildDistractorExplanations(permuteToPlannedLetter(question(), "d"));

    expect(built.d).toBeUndefined(); // d is the key now
    expect(built.b).toBe("not delta"); // Delta moved to b, its reason with it
    expect(built.a).toBe("not alpha");
  });
});
