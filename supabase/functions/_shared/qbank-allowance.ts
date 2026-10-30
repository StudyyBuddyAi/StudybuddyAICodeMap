/**
 * The free-tier QBank allowance, shared by the edge function that enforces it
 * and the pages that show it.
 *
 * One number in one place: the edge function reserves against it and the
 * QBank page sizes its set picker from it, and the two must never disagree
 * about how many questions a free student has left. No imports and no Deno
 * API, so it bundles into the client unchanged (as qbank-qa does).
 */

/**
 * Delivered questions a free account may generate per day (owner decision,
 * 2026-10-30). Pro is unlimited. Held-back items and retries of questions the
 * student already owns do not count.
 */
export const FREE_DAILY_QBANK_QUESTIONS = 10;

/** usage_records.kind the allowance is counted under. */
export const QBANK_USAGE_KIND = "qbank_generate";

/** Seconds per question on the real exam: 20 items in a 30-minute block. */
export const EXAM_SECONDS_PER_QUESTION = 90;

/** The USMLE block since May 2026: 20 items, 30 minutes. */
export const EXAM_BLOCK_SIZE = 20;

/**
 * The set sizes a student can pick given what they have left today.
 *
 * `remaining` is null for an unlimited (Pro) account. Otherwise sizes above the
 * allowance are dropped, and the allowance itself is offered when it falls
 * between the fixed sizes — a student with seven left can sit seven, rather
 * than being offered only five.
 */
export function allowedSetSizes(remaining: number | null, sizes: readonly number[]): number[] {
  if (remaining === null) return [...sizes];
  const left = Math.max(0, Math.floor(remaining));
  if (left === 0) return [];
  const fit = sizes.filter((s) => s <= left);
  const max = Math.max(...sizes);
  if (!fit.includes(left) && left < max) fit.push(left);
  return fit.sort((a, b) => a - b);
}

/**
 * The exam-block preset for this student: the full 20-item block for Pro,
 * a half block for a free account (owner decision), never more than they have
 * left today. Null when there is nothing left to sit.
 */
export function examBlockFor(remaining: number | null): { size: number; minutes: number } | null {
  const full = remaining === null ? EXAM_BLOCK_SIZE : Math.min(EXAM_BLOCK_SIZE / 2, Math.max(0, remaining));
  if (full <= 0) return null;
  return { size: full, minutes: (full * EXAM_SECONDS_PER_QUESTION) / 60 };
}
