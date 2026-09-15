import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Card } from "@/hooks/use-flashcard-deck";
import { useToast } from "@/hooks/use-toast";
import {
  LEECH_THRESHOLD,
  previewIntervals,
  scheduleReview,
  type IntervalPreview,
  type ReviewOutcome,
  type ReviewRating,
  type SrsSettings,
} from "@/lib/spaced-repetition";
import {
  afterRating,
  createSessionQueue,
  nextCard,
  remainingCount,
  shufflePending,
  type SessionQueue,
} from "@/lib/study-session";

/**
 * One study session, shared by the /flashcards review pane and the Library's
 * full-screen StudyMode.
 *
 * The queue is decided locally from the same FSRS computation the deck hook
 * persists, so the next card appears immediately while the write happens in
 * the background. A card rated Again comes back once its relearning step
 * elapses; the session only ends when nothing is left, including those.
 */

type ReviewFn = (id: string, rating: ReviewRating, opts?: { durationMs?: number }) => Promise<ReviewOutcome | null>;

export interface SessionTally {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

const EMPTY_TALLY: SessionTally = { again: 0, hard: 0, good: 0, easy: 0 };

export function useStudySession({
  liveCards,
  reviewCard,
  settings,
}: {
  /** The deck as it is now; cards are looked up here so previews use fresh state. */
  liveCards: Card[];
  reviewCard: ReviewFn;
  settings: Pick<SrsSettings, "desiredRetention" | "weights">;
}) {
  const { toast } = useToast();
  const [topic, setTopic] = useState<string | null>(null);
  const [queue, setQueue] = useState<SessionQueue>(() => createSessionQueue([]));
  const [snapshot, setSnapshot] = useState<Map<string, Card>>(() => new Map());
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [tally, setTally] = useState<SessionTally>(EMPTY_TALLY);
  const [now, setNow] = useState(() => Date.now());
  const shownAt = useRef(Date.now());

  const active = topic !== null;

  const liveById = useMemo(() => new Map(liveCards.map((c) => [c.id, c])), [liveCards]);
  const lookup = useCallback(
    (id: string) => liveById.get(id) ?? snapshot.get(id) ?? null,
    [liveById, snapshot]
  );

  const next = active ? nextCard(queue, now) : ({ kind: "done" } as const);
  const current = next.kind === "card" ? lookup(next.id) : null;
  const currentId = current?.id ?? null;

  // Learning cards come due while the student works; re-evaluate periodically
  // so a waiting session wakes up without a click.
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, [active]);

  useEffect(() => {
    shownAt.current = Date.now();
    setFlipped(false);
  }, [currentId]);

  const start = useCallback((cards: Card[], label: string) => {
    if (!cards.length) return false;
    setSnapshot(new Map(cards.map((c) => [c.id, c])));
    setSessionIds(cards.map((c) => c.id));
    setQueue(createSessionQueue(cards.map((c) => c.id)));
    setTally(EMPTY_TALLY);
    setFlipped(false);
    setNow(Date.now());
    setTopic(label);
    return true;
  }, []);

  const end = useCallback(() => {
    setTopic(null);
    setQueue(createSessionQueue([]));
    setSnapshot(new Map());
    setSessionIds([]);
    setTally(EMPTY_TALLY);
    setFlipped(false);
  }, []);

  /** Go through this session's cards again (they are reviewed again, early). */
  const restart = useCallback(() => {
    const cards = sessionIds.map(lookup).filter((c): c is Card => c !== null);
    if (topic) start(cards, topic);
  }, [sessionIds, lookup, topic, start]);

  const previews: Record<ReviewRating, IntervalPreview> | null = useMemo(() => {
    if (!current) return null;
    // Previews are computed at flip time; the fuzz is seeded per card and rep,
    // so the saved interval matches what the button showed.
    return previewIntervals(current.id, current, Date.now(), settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, flipped, settings]);

  const rate = useCallback(
    (rating: ReviewRating) => {
      if (!current) return;
      const at = Date.now();
      const local = scheduleReview(current.id, current, rating, at, settings);
      setQueue((q) => afterRating(q, current.id, local.next, at));
      setTally((t) => ({ ...t, [rating]: t[rating] + 1 }));
      setNow(at);
      // The same card can come straight back (a lone learning card), in which
      // case the id-keyed effect above never fires — reset here too.
      setFlipped(false);
      const durationMs = at - shownAt.current;
      shownAt.current = at;
      reviewCard(current.id, rating, { durationMs })
        .then((outcome) => {
          if (outcome?.becameLeech) {
            toast({
              title: "Leech detected",
              description: `You've forgotten this card ${outcome.next.lapses} times (leech threshold ${LEECH_THRESHOLD}). Try "Explain this card", or rewrite or delete it.`,
            });
          }
        })
        .catch((e) => {
          console.error("review failed", e);
          toast({
            title: "Couldn't save that review",
            description: "Check your connection — the card will come up again next time.",
            variant: "destructive",
          });
        });
    },
    [current, settings, reviewCard, toast]
  );

  /** Put the current card at the back of the queue without rating it. */
  const skip = useCallback(() => {
    if (!current) return;
    setQueue((q) =>
      q.pending[0] === current.id && q.pending.length > 1
        ? { ...q, pending: [...q.pending.slice(1), current.id] }
        : q
    );
  }, [current]);

  /** Take a card out of the session entirely (e.g. it was deleted). */
  const drop = useCallback((id: string) => {
    setQueue((q) => ({
      pending: q.pending.filter((p) => p !== id),
      learning: q.learning.filter((l) => l.id !== id),
    }));
    setSessionIds((ids) => ids.filter((x) => x !== id));
  }, []);

  const shuffle = useCallback(() => {
    setQueue((q) => shufflePending(q, currentId));
  }, [currentId]);

  /** Show learning cards now instead of waiting for their step to elapse. */
  const studyAhead = useCallback(() => {
    setQueue((q) => ({ ...q, learning: q.learning.map((l) => ({ ...l, dueAt: Date.now() })) }));
    setNow(Date.now());
  }, []);

  const reviewed = tally.again + tally.hard + tally.good + tally.easy;
  const remaining = active ? remainingCount(queue) : 0;

  return {
    active,
    topic,
    current,
    status: next.kind,
    waitUntil: next.kind === "wait" ? next.nextDueAt : null,
    flipped,
    flip: () => setFlipped((f) => !f),
    setFlipped,
    previews,
    rate,
    skip,
    drop,
    shuffle,
    studyAhead,
    start,
    end,
    restart,
    tally,
    reviewed,
    remaining,
    /** Cards in this session, including repeats still owed. */
    total: reviewed + remaining,
    sessionCards: sessionIds.map(lookup).filter((c): c is Card => c !== null),
    canSkip: queue.pending.length > 1 && queue.pending[0] === currentId,
  };
}

/** 1–4 rate, Space/Enter flips. Ignored while typing or when disabled. */
export function useRatingKeys({
  enabled,
  flipped,
  onFlip,
  onRate,
}: {
  enabled: boolean;
  flipped: boolean;
  onFlip: () => void;
  onRate: (rating: ReviewRating) => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " || e.key === "Enter") {
        if (target?.tagName === "BUTTON") return;
        e.preventDefault();
        onFlip();
        return;
      }
      if (!flipped) return;
      const rating = ({ "1": "again", "2": "hard", "3": "good", "4": "easy" } as const)[e.key as "1"];
      if (rating) {
        e.preventDefault();
        onRate(rating);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, flipped, onFlip, onRate]);
}
