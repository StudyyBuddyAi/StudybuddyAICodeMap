import { LEARN_AHEAD_MS, isLearningState, type SrsFields } from "@/lib/spaced-repetition";

/**
 * The in-session queue: which card to show next, and where a just-rated card
 * goes. Mirrors Anki's intraday learning queue — a card rated Again (or still
 * walking its learning steps) comes back in the same session once its step
 * elapses, instead of silently waiting for the next visit.
 */
export interface SessionQueue {
  /** Card ids not yet shown this session, in study order. */
  pending: string[];
  /** Cards in (re)learning that come back once `dueAt` passes. */
  learning: { id: string; dueAt: number }[];
}

export type NextCard =
  | { kind: "card"; id: string }
  /** Only learning cards remain and none is within the learn-ahead window. */
  | { kind: "wait"; nextDueAt: number; remaining: number }
  | { kind: "done" };

export function createSessionQueue(ids: readonly string[]): SessionQueue {
  return { pending: ids.slice(), learning: [] };
}

/** Remove a card from wherever it sits in the queue. */
function without(queue: SessionQueue, id: string): SessionQueue {
  return {
    pending: queue.pending.filter((p) => p !== id),
    learning: queue.learning.filter((l) => l.id !== id),
  };
}

/**
 * Record a rating: the card leaves the queue, and rejoins the learning list if
 * its new state is a (re)learning step due before the session could plausibly
 * end (anything scheduled a day or more out belongs to a future session).
 */
export function afterRating(
  queue: SessionQueue,
  id: string,
  next: Pick<SrsFields, "state" | "dueAt">,
  now: number
): SessionQueue {
  const rest = without(queue, id);
  if (isLearningState(next.state) && next.dueAt - now < 24 * 60 * 60 * 1000) {
    rest.learning = [...rest.learning, { id, dueAt: next.dueAt }].sort((a, b) => a.dueAt - b.dueAt);
  }
  return rest;
}

/**
 * The next card to show. Learning cards that are due win; otherwise the next
 * pending card; otherwise a learning card within the learn-ahead window;
 * otherwise wait for the earliest learning card, or finish.
 */
export function nextCard(queue: SessionQueue, now: number): NextCard {
  const dueLearning = queue.learning.find((l) => l.dueAt <= now);
  if (dueLearning) return { kind: "card", id: dueLearning.id };
  if (queue.pending.length) return { kind: "card", id: queue.pending[0] };
  const soonest = queue.learning[0];
  if (!soonest) return { kind: "done" };
  if (soonest.dueAt - now <= LEARN_AHEAD_MS) return { kind: "card", id: soonest.id };
  return { kind: "wait", nextDueAt: soonest.dueAt, remaining: queue.learning.length };
}

/** Cards still owed this session (pending plus learning). */
export function remainingCount(queue: SessionQueue): number {
  return queue.pending.length + queue.learning.length;
}

/** Move pending cards after the current one into random order. */
export function shufflePending(queue: SessionQueue, keepFirst: string | null, random = Math.random): SessionQueue {
  const head = keepFirst && queue.pending[0] === keepFirst ? [keepFirst] : [];
  const tail = queue.pending.slice(head.length);
  for (let i = tail.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tail[i], tail[j]] = [tail[j], tail[i]];
  }
  return { ...queue, pending: [...head, ...tail] };
}
