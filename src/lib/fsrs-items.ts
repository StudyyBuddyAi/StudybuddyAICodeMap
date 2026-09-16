/**
 * Review logs → FSRS optimizer training items.
 *
 * Mirrors fsrs-rs's own Anki conversion: a card's reviews are placed on study
 * days (which begin at the rollover hour in the student's timezone), delta_t is
 * the number of study days since the previous review (0 for the first review
 * and for same-day repeats), and every review after the first yields one item
 * holding the card's history up to and including that review. Items with no
 * review on a later day teach the long-term model nothing and are dropped.
 *
 * All of these train the model. Only items whose last review is on a later day
 * can be scored (fsrs-rs's evaluate rejects the rest), so callers filter for
 * that before evaluating.
 *
 * Pure and dependency-free: shared by the optimizer function (api/) and tests.
 * No path aliases, so it resolves outside the Vite build too.
 */

export type OptimizerRating = 1 | 2 | 3 | 4;

export interface LogRow {
  card_id: string;
  rating: string;
  reviewed_at: string;
}

export interface TrainingReview {
  rating: OptimizerRating;
  deltaT: number;
}

const RATING_VALUE: Record<string, OptimizerRating> = { again: 1, hard: 2, good: 3, easy: 4 };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Offset of `timeZone` from UTC at instant `ms`, in minutes (e.g. +180 for UTC+3). */
export function timeZoneOffsetMinutes(ms: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
  } catch {
    return 0;
  }
}

export function studyDayIndex(ms: number, timeZone: string, rolloverHour = 4): number {
  const local = ms + timeZoneOffsetMinutes(ms, timeZone) * 60000;
  return Math.floor((local - rolloverHour * 60 * 60 * 1000) / DAY_MS);
}

/** Group rows by card, oldest review first. Unknown ratings are skipped. */
export function groupByCard(rows: readonly LogRow[]): Map<string, { rating: OptimizerRating; at: number }[]> {
  const byCard = new Map<string, { rating: OptimizerRating; at: number }[]>();
  for (const row of rows) {
    const rating = RATING_VALUE[row.rating];
    const at = Date.parse(row.reviewed_at);
    if (!rating || !Number.isFinite(at)) continue;
    const list = byCard.get(row.card_id) ?? [];
    list.push({ rating, at });
    byCard.set(row.card_id, list);
  }
  for (const list of byCard.values()) list.sort((a, b) => a.at - b.at);
  return byCard;
}

export function buildTrainingItems(
  rows: readonly LogRow[],
  timeZone: string,
  rolloverHour = 4
): TrainingReview[][] {
  const items: TrainingReview[][] = [];
  for (const reviews of groupByCard(rows).values()) {
    const history: TrainingReview[] = [];
    let prevDay: number | null = null;
    for (const r of reviews) {
      const day = studyDayIndex(r.at, timeZone, rolloverHour);
      const deltaT = prevDay === null ? 0 : Math.max(0, day - prevDay);
      prevDay = day;
      history.push({ rating: r.rating, deltaT });
      if (history.length >= 2 && history.slice(1).some((h) => h.deltaT > 0)) {
        items.push(history.slice());
      }
    }
  }
  return items;
}

/** Reviews needed before optimizing is worth it (below this, defaults win). */
export const MIN_REVIEWS_TO_OPTIMIZE = 400;

/**
 * Whether to nudge a student to optimize: enough history, and either never
 * optimized, a month since the last run, or twice the reviews it was fitted on.
 */
export function shouldSuggestOptimize(
  totalReviews: number | null,
  weightsUpdatedAt: number | null,
  weightsReviewCount: number | null,
  now = Date.now()
): boolean {
  if (totalReviews === null || totalReviews < MIN_REVIEWS_TO_OPTIMIZE) return false;
  if (weightsUpdatedAt === null) return true;
  if (now - weightsUpdatedAt > 30 * 24 * 60 * 60 * 1000) return true;
  return weightsReviewCount !== null && totalReviews >= 2 * weightsReviewCount;
}
