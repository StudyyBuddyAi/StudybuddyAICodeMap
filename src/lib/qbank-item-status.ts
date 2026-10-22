// What each item in a block is, for the item list, the review screen and the
// results. One vocabulary, so the rail, the End-block review and the summary
// never disagree about what "answered" means.

import type { PlayMode, SessionAnswer, SessionState } from "./qbank-types";

export type ItemStatus = "correct" | "incorrect" | "answered" | "unanswered" | "omitted" | "unwritten";

export interface ItemCell {
  index: number;
  status: ItemStatus;
  marked: boolean;
  current: boolean;
}

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  correct: "Correct",
  incorrect: "Incorrect",
  answered: "Answered",
  unanswered: "Unanswered",
  omitted: "Omitted",
  unwritten: "Being written",
};

/** "Question 4, incorrect, marked": the name a screen reader hears. */
export const itemAccessibleName = (cell: ItemCell): string =>
  `Question ${cell.index + 1}, ${ITEM_STATUS_LABEL[cell.status].toLowerCase()}${cell.marked ? ", marked" : ""}`;

/**
 * The cells of a live block. A generated set shows its planned length from the
 * start, so slots past the written questions are "unwritten".
 */
export const liveItemCells = (
  session: Pick<SessionState, "questions" | "answers" | "selections" | "currentIndex">,
  plannedTotal: number,
  mode: PlayMode,
  marked: ReadonlySet<string>
): ItemCell[] =>
  Array.from({ length: Math.max(plannedTotal, session.questions.length) }, (_, index) => {
    const q = session.questions[index];
    if (!q) return { index, status: "unwritten" as const, marked: false, current: false };
    let status: ItemStatus = "unanswered";
    if (mode === "timed") {
      if (session.selections[q.id]) status = "answered";
    } else {
      const a = session.answers.find((x) => x.question_id === q.id);
      if (a) status = a.is_correct ? "correct" : "incorrect";
    }
    return { index, status, marked: marked.has(q.id), current: index === session.currentIndex };
  });

/** The cells of a finished block, in review. */
export const reviewItemCells = (
  questionIds: string[],
  answers: Pick<SessionAnswer, "question_id" | "is_correct">[],
  marked: ReadonlySet<string>,
  currentIndex: number
): ItemCell[] =>
  questionIds.map((id, index) => {
    const a = answers.find((x) => x.question_id === id);
    return {
      index,
      status: a ? (a.is_correct ? "correct" : "incorrect") : "omitted",
      marked: marked.has(id),
      current: index === currentIndex,
    };
  });
