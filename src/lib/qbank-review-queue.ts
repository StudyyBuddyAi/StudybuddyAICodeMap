/**
 * The review queue: missed and marked questions offered back to the student.
 *
 * The server decides what is due (get_qbank_review_queue, migration
 * 20261030000200): a miss once it is 20 hours old, a mark at once. This module
 * reads that answer and turns it into a set. Re-sits never count against the
 * free allowance — nothing is generated.
 */

/** qbank_sessions.system for a re-sit set, so other surfaces can tell it apart. */
export const REVIEW_SET_SYSTEM = "Review";

/** The most a review set holds — one exam block. */
export const MAX_REVIEW_SET = 20;

export type ReviewReason = "missed" | "marked" | "both";

export interface ReviewItem {
  questionId: string;
  reason: ReviewReason;
  lastSeenAt: string | null;
  subject: string | null;
  domain: string | null;
  topic: string | null;
}

export interface ReviewQueue {
  due: ReviewItem[];
  dueCount: number;
  missedDue: number;
  marked: number;
  /** Misses still inside the spacing window. */
  upcoming: number;
  /** When the earliest upcoming miss becomes due. */
  nextDueAt: string | null;
}

export const EMPTY_REVIEW_QUEUE: ReviewQueue = {
  due: [],
  dueCount: 0,
  missedDue: 0,
  marked: 0,
  upcoming: 0,
  nextDueAt: null,
};

const REASONS: ReviewReason[] = ["missed", "marked", "both"];
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** Reads the RPC's JSON defensively; anything malformed is dropped, not thrown. */
export function parseReviewQueue(raw: unknown): ReviewQueue {
  if (!raw || typeof raw !== "object") return EMPTY_REVIEW_QUEUE;
  const r = raw as Record<string, unknown>;
  const due = (Array.isArray(r.due) ? r.due : [])
    .map((e): ReviewItem | null => {
      const item = e as Record<string, unknown>;
      const questionId = str(item?.question_id);
      if (!questionId) return null;
      return {
        questionId,
        reason: REASONS.includes(item.reason as ReviewReason) ? (item.reason as ReviewReason) : "missed",
        lastSeenAt: str(item.last_seen_at),
        subject: str(item.subject),
        domain: str(item.domain),
        topic: str(item.topic),
      };
    })
    .filter((x): x is ReviewItem => x !== null);

  return {
    due,
    dueCount: Math.max(num(r.due_count), due.length),
    missedDue: num(r.missed_due),
    marked: num(r.marked),
    upcoming: num(r.upcoming),
    nextDueAt: str(r.next_due_at),
  };
}

/**
 * The questions for one review set: the longest-waiting first, as the server
 * orders them, capped at one block. A mark comes before a plain miss of the
 * same age only by the server's ordering — this keeps it, so a student who
 * sits the set daily works through the backlog oldest-first.
 */
export function pickReviewIds(queue: ReviewQueue, max = MAX_REVIEW_SET): string[] {
  return queue.due.slice(0, Math.max(0, max)).map((d) => d.questionId);
}

/** "9 missed · 3 marked", for the queue card. */
export function describeReviewQueue(queue: ReviewQueue): string {
  const parts: string[] = [];
  if (queue.missedDue > 0) parts.push(`${queue.missedDue} missed`);
  if (queue.marked > 0) parts.push(`${queue.marked} marked`);
  return parts.join(" · ");
}
