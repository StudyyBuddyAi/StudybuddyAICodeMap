import { describe, it, expect } from "vitest";
import {
  describeReviewQueue,
  EMPTY_REVIEW_QUEUE,
  parseReviewQueue,
  pickReviewIds,
} from "./qbank-review-queue";

const raw = {
  due: [
    { question_id: "q1", reason: "missed", last_seen_at: "2026-10-27T10:00:00Z", subject: "Renal & Urinary", domain: "Physiology", topic: "RTA" },
    { question_id: "q2", reason: "marked", last_seen_at: "2026-10-28T10:00:00Z", subject: null, domain: null, topic: null },
    { question_id: "q3", reason: "both", last_seen_at: null },
    { reason: "missed" }, // no id: dropped
  ],
  due_count: 3,
  missed_due: 2,
  marked: 2,
  upcoming: 4,
  next_due_at: "2026-10-31T06:00:00Z",
};

describe("parseReviewQueue", () => {
  it("reads the server's queue and drops malformed items", () => {
    const q = parseReviewQueue(raw);
    expect(q.due.map((d) => d.questionId)).toEqual(["q1", "q2", "q3"]);
    expect(q.due[0]).toMatchObject({ reason: "missed", subject: "Renal & Urinary", topic: "RTA" });
    expect(q.due[2]).toMatchObject({ reason: "both", lastSeenAt: null });
    expect(q).toMatchObject({ dueCount: 3, missedDue: 2, marked: 2, upcoming: 4, nextDueAt: "2026-10-31T06:00:00Z" });
  });

  it("treats anything that is not a queue as an empty one", () => {
    expect(parseReviewQueue(null)).toEqual(EMPTY_REVIEW_QUEUE);
    expect(parseReviewQueue("nope")).toEqual(EMPTY_REVIEW_QUEUE);
    expect(parseReviewQueue({ due: "x" }).due).toEqual([]);
  });

  it("never reports fewer due than it lists", () => {
    expect(parseReviewQueue({ ...raw, due_count: 0 }).dueCount).toBe(3);
  });
});

describe("pickReviewIds", () => {
  it("takes the longest-waiting questions first, capped at one block", () => {
    const q = parseReviewQueue(raw);
    expect(pickReviewIds(q)).toEqual(["q1", "q2", "q3"]);
    expect(pickReviewIds(q, 2)).toEqual(["q1", "q2"]);

    const many = parseReviewQueue({ due: Array.from({ length: 30 }, (_, i) => ({ question_id: `q${i}` })) });
    expect(pickReviewIds(many)).toHaveLength(20);
  });
});

describe("describeReviewQueue", () => {
  it("names what is waiting", () => {
    expect(describeReviewQueue(parseReviewQueue(raw))).toBe("2 missed · 2 marked");
    expect(describeReviewQueue({ ...EMPTY_REVIEW_QUEUE, marked: 1 })).toBe("1 marked");
    expect(describeReviewQueue(EMPTY_REVIEW_QUEUE)).toBe("");
  });
});
