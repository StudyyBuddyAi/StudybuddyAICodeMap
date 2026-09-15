import { describe, it, expect } from "vitest";
import {
  buildProgressPayload,
  elapsedMs,
  endBlockStats,
  isWaitingForNext,
  moveTo,
  nextProgressSeq,
  normalizeAnnotations,
  pauseClock,
  resumeClock,
  resumeStartIndex,
  sessionFromResume,
  summaryQuestions,
  timeRemainingMs,
  type ResumeResult,
} from "./qbank-session-state";
import type { Question, SessionState } from "./qbank-types";

const q = (id: string): Question => ({
  id,
  subject: "Cardiovascular",
  domain: "Pathology",
  topic: "t",
  difficulty: "Medium",
  competency: "c",
  question_text: `stem ${id}`,
  option_a: "A",
  option_b: "B",
  option_c: "C",
  option_d: "D",
  option_e: "E",
});

const session = (over: Partial<SessionState> = {}): SessionState => ({
  sessionId: "s1",
  mode: "tutor",
  selections: {},
  annotations: { struck: {}, highlights: {} },
  progressSeq: 0,
  questions: [q("q1"), q("q2"), q("q3")],
  currentIndex: 0,
  answers: [],
  startedAt: 0,
  questionStartedAt: 0,
  accumulatedMs: 0,
  resumedAt: 0,
  clockRunning: true,
  skippedIds: [],
  flaggedIds: [],
  expectedTotal: 3,
  generation: null,
  ...over,
});

const generation = {
  generationId: "g1",
  topic: "aortic dissection",
  system: "cardio",
  systemName: "Cardiovascular",
  target: 20,
  challenge: "balanced" as const,
  examMode: "step1" as const,
  nextIndex: 6,
  covered: ["x"],
};

describe("buildProgressPayload", () => {
  it("always carries the generation and the planned size", () => {
    // Regression: the old flag and timer writes dropped both, so a set still
    // being written reloaded as finished and never resumed writing.
    const s = session({ expectedTotal: 20, generation });
    const p = buildProgressPayload(s, 5_000);

    expect(p.p_generation).toEqual(generation);
    expect(p.p_expected_total).toBe(20);
    expect(p.p_elapsed_ms).toBe(5_000);
  });

  it("carries the complete flag list", () => {
    const p = buildProgressPayload(session({ flaggedIds: ["q3", "q1"] }), 0);
    expect(p.p_flagged_ids).toEqual(["q3", "q1"]);
  });

  it("never reports a planned size below what is loaded", () => {
    const p = buildProgressPayload(session({ expectedTotal: 1 }), 0);
    expect(p.p_expected_total).toBe(3);
  });
});

describe("clock", () => {
  it("does not count a paused stretch", () => {
    let s = session({ accumulatedMs: 1_000, resumedAt: 0 });
    s = pauseClock(s, 4_000);
    expect(elapsedMs(s, 60_000)).toBe(5_000);
    s = resumeClock(s, 60_000);
    expect(elapsedMs(s, 62_000)).toBe(7_000);
  });

  it("budgets a timed block against the planned size, not what has been written", () => {
    const s = session({ mode: "timed", questions: [q("q1")], expectedTotal: 20 });
    expect(timeRemainingMs(s, 0)).toBe(20 * 90_000);
  });

  it("shrinks the budget when a set ends short", () => {
    const s = session({ mode: "timed", expectedTotal: 3 });
    expect(timeRemainingMs(s, 90_000)).toBe(180_000);
  });

  it("has no countdown in tutor mode", () => {
    expect(timeRemainingMs(session(), 0)).toBeNull();
  });
});

describe("isWaitingForNext", () => {
  it("waits only once the last written question has a response and more are coming", () => {
    const base = session({ questions: [q("q1")], expectedTotal: 5 });
    expect(isWaitingForNext(base)).toBe(false);

    const answered = { ...base, answers: [{ question_id: "q1", selected_option: "a" as const, is_correct: true, time_taken_ms: 1 }] };
    expect(isWaitingForNext(answered)).toBe(true);

    const timed = { ...base, mode: "timed" as const, selections: { q1: "b" as const } };
    expect(isWaitingForNext(timed)).toBe(true);

    expect(isWaitingForNext({ ...answered, expectedTotal: 1 })).toBe(false);
  });
});

describe("summaryQuestions", () => {
  it("returns the answered questions, not the first N", () => {
    const s = session({
      answers: [
        { question_id: "q2", selected_option: "a", is_correct: true, time_taken_ms: 1 },
        { question_id: "q3", selected_option: "b", is_correct: false, time_taken_ms: 1 },
      ],
    });
    expect(summaryQuestions(s).map((x) => x.id)).toEqual(["q2", "q3"]);
  });
});

describe("endBlockStats", () => {
  it("counts timed selections as answered and reports unwritten questions", () => {
    const s = session({
      mode: "timed",
      selections: { q1: "a" },
      flaggedIds: ["q2", "not-in-set"],
      expectedTotal: 10,
    });
    expect(endBlockStats(s)).toEqual({ answered: 1, unanswered: 2, flagged: 1, notWritten: 7 });
  });
});

describe("moveTo", () => {
  it("marks the question left behind as skipped and clears it when reopened", () => {
    let s = moveTo(session(), 2, 100);
    expect(s.currentIndex).toBe(2);
    expect(s.skippedIds).toEqual(["q1"]);

    s = moveTo(s, 0, 200);
    expect(s.skippedIds).toEqual(["q3"]);
  });

  it("ignores indices past what has been written", () => {
    const s = session();
    expect(moveTo(s, 3, 0)).toBe(s);
  });
});

describe("resumeStartIndex", () => {
  it("continues past rows an interrupted wave wrote after the last save", () => {
    expect(resumeStartIndex(6, 8)).toBe(9);
    expect(resumeStartIndex(6, 3)).toBe(6);
    expect(resumeStartIndex(6, null)).toBe(6);
  });
});

describe("nextProgressSeq", () => {
  it("is strictly increasing even when the clock is behind the last seq", () => {
    expect(nextProgressSeq(10, 5)).toBe(11);
    expect(nextProgressSeq(10, 1_000)).toBe(1_000);
  });
});

describe("normalizeAnnotations", () => {
  it("drops malformed marks", () => {
    const a = normalizeAnnotations({
      struck: { q1: ["a", "z", "a"], q2: "b" },
      highlights: { q1: [[0, 4], [5, 5], ["x", 2]], q2: [[-1, 3]] },
    });
    expect(a).toEqual({ struck: { q1: ["a"] }, highlights: { q1: [[0, 4]] } });
  });

  it("tolerates nothing at all", () => {
    expect(normalizeAnnotations(null)).toEqual({ struck: {}, highlights: {} });
  });
});

describe("sessionFromResume", () => {
  const result = (over: Partial<ResumeResult> = {}): ResumeResult => ({
    session: {
      id: "s9",
      mode: "tutor",
      started_at: "2026-09-13T10:00:00.000Z",
      current_index: 7,
      skipped_ids: ["q2", "gone"],
      elapsed_ms: 42_000,
      expected_total: 20,
      generation,
      annotations: { struck: { q1: ["c"] } },
      progress_seq: 99,
    },
    questions: [{ ...q("q1"), correct_option: "a", explanation: "because" }, q("q2")],
    answers: [{ question_id: "q1", selected_option: "a", is_correct: true, time_taken_ms: 3 }],
    selections: [],
    flagged: ["q2"],
    generation_max_index: 11,
    ...over,
  });

  it("rebuilds a tutor session where the student left it", () => {
    const s = sessionFromResume(result(), 1_000);

    expect(s.sessionId).toBe("s9");
    expect(s.currentIndex).toBe(1); // clamped to what is loaded
    expect(s.accumulatedMs).toBe(42_000);
    expect(s.expectedTotal).toBe(20);
    expect(s.skippedIds).toEqual(["q2"]);
    expect(s.flaggedIds).toEqual(["q2"]);
    expect(s.answers).toHaveLength(1);
    expect(s.questions[0].correct_option).toBe("a");
    expect(s.generation?.nextIndex).toBe(12);
    expect(s.annotations.struck).toEqual({ q1: ["c"] });
    expect(s.progressSeq).toBe(99);
  });

  it("never carries the key into a timed session", () => {
    const s = sessionFromResume(
      result({
        session: { ...result().session, mode: "timed" },
        selections: [
          { question_id: "q2", selected_option: "d" },
          { question_id: "q1", selected_option: "nope" },
        ],
      }),
      0
    );

    expect(s.mode).toBe("timed");
    expect(s.questions[0].correct_option).toBeUndefined();
    expect(s.questions[0].explanation).toBeUndefined();
    expect(s.answers).toEqual([]);
    expect(s.selections).toEqual({ q2: "d" });
  });
});
