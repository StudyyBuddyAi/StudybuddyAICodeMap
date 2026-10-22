// The state of one answer on screen, and the words it is reported in.

import type { OptionKey, Question } from "./qbank-types";

export const OPTION_KEYS: OptionKey[] = ["a", "b", "c", "d", "e"];

export type AnswerState =
  | { status: "unanswered" }
  /** Tutor: picked, not yet submitted. Timed: the recorded choice. */
  | { status: "selected"; pending: OptionKey }
  | { status: "answered"; selected: OptionKey; correct: OptionKey; isCorrect: boolean }
  /** Review of a question the set left unanswered: the key, and no choice. */
  | { status: "revealed"; correct: OptionKey };

export const isGradedState = (s: AnswerState): s is Extract<AnswerState, { status: "answered" | "revealed" }> =>
  s.status === "answered" || s.status === "revealed";

/** "D. Regular insulin" */
export const choiceLabel = (q: Question, key: OptionKey) => `${key.toUpperCase()}. ${q[`option_${key}` as const]}`;

/** The sentence a result is announced with. Names the right answer in words. */
export const verdictSentence = (q: Question, correct: OptionKey, selected: OptionKey | null): string => {
  if (selected === correct) return `Correct. ${choiceLabel(q, correct)}.`;
  if (selected) return `Incorrect. The correct answer is ${choiceLabel(q, correct)}. You chose ${selected.toUpperCase()}.`;
  return `Not answered. The correct answer is ${choiceLabel(q, correct)}.`;
};

/** m:ss, or h:mm:ss past the hour: 0:42, 22:14, 1:05:09. */
export const formatClock = (ms: number): string => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
};
