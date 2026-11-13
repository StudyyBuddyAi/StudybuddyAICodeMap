/**
 * The QBank's shared numbers: the old guest cap the edge function still
 * enforces, and the exam block the QBank page offers.
 *
 * No imports and no Deno API, so it bundles into the client unchanged (as
 * qbank-qa does).
 */

/**
 * Delivered questions an anonymous guest, from before accounts were required,
 * may generate per day. Every account is held only by the day's usage limit
 * (free access, 2026-11). Held-back items and retries of questions the
 * student already owns do not count.
 */
export const FREE_DAILY_QBANK_QUESTIONS = 10;

/** usage_records.kind the guest cap is counted under. */
export const QBANK_USAGE_KIND = "qbank_generate";

/** Seconds per question on the real exam: 20 items in a 30-minute block. */
export const EXAM_SECONDS_PER_QUESTION = 90;

/** The USMLE block since May 2026: 20 items, 30 minutes. */
export const EXAM_BLOCK_SIZE = 20;

/** The timed exam-block preset on the QBank page: the whole USMLE block. */
export const EXAM_BLOCK = {
  size: EXAM_BLOCK_SIZE,
  minutes: (EXAM_BLOCK_SIZE * EXAM_SECONDS_PER_QUESTION) / 60,
} as const;
