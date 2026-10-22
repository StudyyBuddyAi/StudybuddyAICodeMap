// How a finished set is scored.
//
// An omitted question counts against the score, as it does on NBME forms and
// UWorld: the denominator is every question the set held, not only the ones
// the student chose to answer. Otherwise one right answer out of ten reads as
// 100%. end_qbank_session stores the same total (20261013000000).

import type { SessionAnswer } from "./qbank-types";

export interface SetScore {
  correct: number;
  incorrect: number;
  omitted: number;
  /** Every question the set held. */
  total: number;
  /** correct / total, rounded. 0 for an empty set. */
  pct: number;
}

/**
 * @param heldCount questions the set held. A stored total from before the fix
 *   counted attempts only, so the larger of the two is used.
 */
export const scoreSet = (answers: Pick<SessionAnswer, "is_correct">[], heldCount: number): SetScore => {
  const correct = answers.filter((a) => a.is_correct).length;
  const total = Math.max(heldCount, answers.length);
  return {
    correct,
    incorrect: answers.length - correct,
    omitted: total - answers.length,
    total,
    pct: total > 0 ? Math.round((correct / total) * 100) : 0,
  };
};
