export type ReviewRating = "again" | "good" | "easy";

/** Day intervals the deck walks through after successful reviews. */
export const PROGRESSION = [1, 3, 7, 21, 60];

export const DAY_MS = 24 * 60 * 60 * 1000;
export const AGAIN_DELAY_MS = 10 * 60 * 1000;

export interface NextReview {
  /** New interval in days. */
  interval: number;
  /** Epoch ms at which the card is next due. */
  dueAt: number;
  /** Epoch ms of this review. */
  lastReviewed: number;
}

/**
 * SM-2-lite scheduling for one flashcard review.
 *
 * `again` resets the card to a 10-minute relearn delay. Otherwise the interval
 * advances one step along `PROGRESSION` (`easy` advances two steps), clamped to
 * the last value. Cards at interval 0 (never successfully reviewed) move to the
 * first step on `good`, or the second on `easy`. Unknown intervals fall back to
 * the first step.
 *
 * Pure and deterministic — extracted from `use-flashcard-deck` so the schedule
 * can be unit-tested without React.
 */
export function getNextReview(
  interval: number,
  rating: ReviewRating,
  now = Date.now()
): NextReview {
  if (rating === "again") {
    return { interval: 0, dueAt: now + AGAIN_DELAY_MS, lastReviewed: now };
  }

  const idx = PROGRESSION.indexOf(interval);
  let nextIdx: number;
  if (interval === 0) {
    nextIdx = rating === "easy" ? 1 : 0;
  } else if (idx === -1) {
    nextIdx = 0;
  } else {
    nextIdx =
      rating === "easy"
        ? Math.min(idx + 2, PROGRESSION.length - 1)
        : Math.min(idx + 1, PROGRESSION.length - 1);
  }

  const nextInterval = PROGRESSION[nextIdx];
  return { interval: nextInterval, dueAt: now + nextInterval * DAY_MS, lastReviewed: now };
}
