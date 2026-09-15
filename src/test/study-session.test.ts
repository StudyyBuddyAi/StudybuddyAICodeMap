import { describe, it, expect } from "vitest";
import { State } from "ts-fsrs";
import { DAY_MS, MINUTE_MS } from "@/lib/spaced-repetition";
import {
  afterRating,
  createSessionQueue,
  nextCard,
  remainingCount,
  shufflePending,
} from "@/lib/study-session";

const NOW = 1_700_000_000_000;

describe("study session queue", () => {
  it("shows pending cards in order and finishes when empty", () => {
    let q = createSessionQueue(["a", "b"]);
    expect(nextCard(q, NOW)).toEqual({ kind: "card", id: "a" });
    q = afterRating(q, "a", { state: State.Review, dueAt: NOW + 3 * DAY_MS }, NOW);
    expect(nextCard(q, NOW)).toEqual({ kind: "card", id: "b" });
    q = afterRating(q, "b", { state: State.Review, dueAt: NOW + DAY_MS }, NOW);
    expect(nextCard(q, NOW)).toEqual({ kind: "done" });
  });

  it("brings an Again card back once its step elapses, ahead of pending cards", () => {
    let q = createSessionQueue(["a", "b", "c"]);
    q = afterRating(q, "a", { state: State.Relearning, dueAt: NOW + 10 * MINUTE_MS }, NOW);
    expect(nextCard(q, NOW + MINUTE_MS)).toEqual({ kind: "card", id: "b" });
    expect(nextCard(q, NOW + 11 * MINUTE_MS)).toEqual({ kind: "card", id: "a" });
    expect(remainingCount(q)).toBe(3);
  });

  it("learns ahead up to 20 minutes when only learning cards remain", () => {
    let q = createSessionQueue(["a"]);
    q = afterRating(q, "a", { state: State.Learning, dueAt: NOW + 10 * MINUTE_MS }, NOW);
    expect(nextCard(q, NOW)).toEqual({ kind: "card", id: "a" });
  });

  it("waits when the only learning card is further out than the learn-ahead limit", () => {
    let q = createSessionQueue(["a"]);
    q = afterRating(q, "a", { state: State.Learning, dueAt: NOW + 60 * MINUTE_MS }, NOW);
    expect(nextCard(q, NOW)).toEqual({ kind: "wait", nextDueAt: NOW + 60 * MINUTE_MS, remaining: 1 });
  });

  it("drops a learning card that graduates", () => {
    let q = createSessionQueue(["a"]);
    q = afterRating(q, "a", { state: State.Learning, dueAt: NOW + MINUTE_MS }, NOW);
    q = afterRating(q, "a", { state: State.Review, dueAt: NOW + DAY_MS }, NOW + MINUTE_MS);
    expect(nextCard(q, NOW + MINUTE_MS)).toEqual({ kind: "done" });
  });

  it("shuffles pending cards but keeps the current one first", () => {
    const q = createSessionQueue(["a", "b", "c", "d"]);
    let i = 0;
    const seq = [0.1, 0.9, 0.5];
    const shuffled = shufflePending(q, "a", () => seq[i++ % seq.length]);
    expect(shuffled.pending[0]).toBe("a");
    expect([...shuffled.pending].sort()).toEqual(["a", "b", "c", "d"]);
  });
});
