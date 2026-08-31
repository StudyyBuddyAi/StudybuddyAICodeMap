import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * The roadmap now claims a topic is "covered". That claim has to be right.
 *
 * Overstating progress on a study tool is the worst failure mode here — a
 * student trusting a green tick on a topic they never studied is worse than
 * one seeing an honest blank. So the matcher is conservative by design, and
 * these tests pin the boundary in both directions.
 */

const history: Array<{ topic: string }> = [];
const cards: Array<{ topic: string }> = [];

vi.mock("@/hooks/use-study-history", () => ({
  useStudyHistory: () => ({ history, isLoading: false }),
}));
vi.mock("@/hooks/use-flashcard-deck", () => ({
  useFlashcardDeck: () => ({ allCards: cards, stats: { due: 0, total: 0, mastered: 0 } }),
}));

const { useCurriculumProgress } = await import("@/hooks/use-curriculum-progress");

const run = (titles: string[]) =>
  renderHook(() => useCurriculumProgress(titles)).result.current;

beforeEach(() => {
  history.length = 0;
  cards.length = 0;
});

describe("curriculum coverage matching", () => {
  it("marks a topic untouched when nothing matches", () => {
    expect(run(["Heart failure"]).get("Heart failure")?.state).toBe("untouched");
  });

  it("matches case and punctuation differences", () => {
    history.push({ topic: "heart failure" });
    expect(run(["Heart Failure"]).get("Heart Failure")?.state).toBe("studied");
  });

  it("matches a more specific saved sheet to its curriculum topic", () => {
    history.push({ topic: "Chronic heart failure" });
    expect(run(["Heart failure"]).get("Heart failure")?.state).toBe("studied");
  });

  it("refuses to match on a single shared word", () => {
    // "failure" appears across renal, respiratory and cardiac topics. Matching
    // on it would light up half the curriculum from one sheet.
    history.push({ topic: "failure" });
    expect(run(["Heart failure"]).get("Heart failure")?.state).toBe("untouched");
  });

  it("does not match merely related topics", () => {
    history.push({ topic: "Asthma" });
    expect(run(["Heart failure"]).get("Heart failure")?.state).toBe("untouched");
  });

  it("ranks a built deck above a saved sheet", () => {
    history.push({ topic: "Heart failure" });
    cards.push({ topic: "Heart failure" }, { topic: "Heart failure" });
    const p = run(["Heart failure"]).get("Heart failure");
    expect(p?.state).toBe("drilled");
    expect(p?.cards).toBe(2);
  });

  it("counts only cards belonging to the matched topic", () => {
    cards.push(
      { topic: "Heart failure" },
      { topic: "Asthma" },
      { topic: "Heart failure" }
    );
    expect(run(["Heart failure"]).get("Heart failure")?.cards).toBe(2);
  });

  it("ignores empty topic names on either side", () => {
    history.push({ topic: "" });
    cards.push({ topic: "" });
    expect(run([""]).get("")?.state).toBe("untouched");
  });
});
