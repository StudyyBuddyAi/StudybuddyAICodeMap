import { describe, expect, it } from "vitest";
import { itemAccessibleName, liveItemCells, reviewItemCells } from "./qbank-item-status";
import type { Question } from "./qbank-types";

const q = (id: string) => ({ id }) as Question;

describe("liveItemCells", () => {
  const session = {
    questions: [q("q1"), q("q2"), q("q3")],
    answers: [
      { question_id: "q1", selected_option: "a" as const, is_correct: true, time_taken_ms: 1 },
      { question_id: "q2", selected_option: "b" as const, is_correct: false, time_taken_ms: 1 },
    ],
    selections: { q3: "c" as const },
    currentIndex: 1,
  };

  it("grades tutor items and leaves planned slots unwritten", () => {
    const cells = liveItemCells(session, 5, "tutor", new Set(["q2"]));
    expect(cells.map((c) => c.status)).toEqual(["correct", "incorrect", "unanswered", "unwritten", "unwritten"]);
    expect(cells[1]).toMatchObject({ marked: true, current: true });
  });

  it("never reveals a grade in timed mode", () => {
    const cells = liveItemCells(session, 3, "timed", new Set());
    expect(cells.map((c) => c.status)).toEqual(["unanswered", "unanswered", "answered"]);
  });
});

describe("reviewItemCells", () => {
  it("marks what was left as omitted", () => {
    const cells = reviewItemCells(["q1", "q2"], [{ question_id: "q1", is_correct: true }], new Set(), 0);
    expect(cells.map((c) => c.status)).toEqual(["correct", "omitted"]);
  });
});

describe("itemAccessibleName", () => {
  it("says the number, the state and the mark", () => {
    expect(itemAccessibleName({ index: 3, status: "incorrect", marked: true, current: false })).toBe(
      "Question 4, incorrect, marked"
    );
  });
});
