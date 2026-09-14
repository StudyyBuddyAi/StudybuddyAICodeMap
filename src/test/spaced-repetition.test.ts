import { describe, it, expect } from "vitest";
import { State, fsrs, generatorParameters, Rating } from "ts-fsrs";
import {
  DAY_MS,
  DEFAULT_SRS_SETTINGS,
  LEECH_THRESHOLD,
  MINUTE_MS,
  buildStudyQueue,
  formatInterval,
  isMature,
  legacyToSrs,
  newSrsFields,
  previewIntervals,
  relativeWorkload,
  replayHistory,
  resolveWeights,
  retrievability,
  scheduleReview,
  studyDayStart,
  type ReviewRating,
  type SrsFields,
} from "@/lib/spaced-repetition";

// 2023-11-14T22:13:20Z — fixed so fuzz and day boundaries are deterministic.
const NOW = 1_700_000_000_000;
const S = DEFAULT_SRS_SETTINGS;

function rate(fields: SrsFields, rating: ReviewRating, at: number, cid = "card-1") {
  return scheduleReview(cid, fields, rating, at, S);
}

describe("scheduleReview — learning steps", () => {
  it("walks a new card through 1m → 10m → about a day on Good", () => {
    let f = newSrsFields(NOW);

    const first = rate(f, "good", NOW);
    expect(first.next.state).toBe(State.Learning);
    expect(first.next.dueAt - NOW).toBe(10 * MINUTE_MS);
    f = first.next;

    const t2 = f.dueAt;
    const second = rate(f, "good", t2);
    expect(second.next.state).toBe(State.Review);
    expect(second.next.scheduledDays).toBeGreaterThanOrEqual(1);
    expect(second.next.scheduledDays).toBeLessThanOrEqual(4);
  });

  it("sends Again on a new card to the first 1-minute step", () => {
    const { next } = rate(newSrsFields(NOW), "again", NOW);
    expect(next.state).toBe(State.Learning);
    expect(next.dueAt - NOW).toBe(1 * MINUTE_MS);
  });

  it("graduates a new card straight to review on Easy", () => {
    const { next } = rate(newSrsFields(NOW), "easy", NOW);
    expect(next.state).toBe(State.Review);
    expect(next.scheduledDays).toBeGreaterThanOrEqual(5);
  });

  it("orders first intervals again < hard < good < easy", () => {
    const p = previewIntervals("card-1", newSrsFields(NOW), NOW, S);
    expect(p.again.dueAt).toBeLessThan(p.hard.dueAt);
    expect(p.hard.dueAt).toBeLessThan(p.good.dueAt);
    expect(p.good.dueAt).toBeLessThan(p.easy.dueAt);
  });
});

function matureCard(): SrsFields {
  let f = newSrsFields(NOW);
  let t = NOW;
  for (let i = 0; i < 6; i++) {
    f = rate(f, "good", t).next;
    t = f.dueAt;
  }
  return f;
}

describe("scheduleReview — review cards", () => {
  it("grows intervals as stability grows", () => {
    let f = rate(newSrsFields(NOW), "easy", NOW).next;
    const intervals: number[] = [];
    for (let i = 0; i < 5; i++) {
      f = rate(f, "good", f.dueAt).next;
      intervals.push(f.scheduledDays);
    }
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    }
  });

  it("moves a review card to relearning on Again and counts the lapse", () => {
    const f = matureCard();
    expect(f.state).toBe(State.Review);
    const { next } = rate(f, "again", f.dueAt);
    expect(next.state).toBe(State.Relearning);
    expect(next.lapses).toBe(f.lapses + 1);
    expect(next.stability).toBeLessThan(f.stability);
    expect(next.dueAt - f.dueAt).toBe(10 * MINUTE_MS);
  });

  it("treats Hard as a pass: no lapse, card stays in review", () => {
    const f = matureCard();
    const { next } = rate(f, "hard", f.dueAt);
    expect(next.state).toBe(State.Review);
    expect(next.lapses).toBe(f.lapses);
  });

  it("gives more stability for a successful late review than an on-time one", () => {
    const f = matureCard();
    const onTime = rate(f, "good", f.dueAt).next;
    const late = rate(f, "good", f.dueAt + f.scheduledDays * DAY_MS).next;
    expect(late.stability).toBeGreaterThan(onTime.stability);
  });

  it("schedules roughly S days out at 90% desired retention, fewer at 95%", () => {
    const f = matureCard();
    const at90 = scheduleReview("c", f, "good", f.dueAt, { ...S, desiredRetention: 0.9 }).next;
    const at95 = scheduleReview("c", f, "good", f.dueAt, { ...S, desiredRetention: 0.95 }).next;
    // Fuzz spreads long intervals by up to ~5–15%.
    expect(at90.scheduledDays / at90.stability).toBeGreaterThan(0.8);
    expect(at90.scheduledDays / at90.stability).toBeLessThan(1.2);
    expect(at95.scheduledDays).toBeLessThan(at90.scheduledDays);
  });

  it("predicts 90% recall when a card is exactly S days old", () => {
    const f = matureCard();
    const r = retrievability(f, (f.lastReviewed as number) + f.stability * DAY_MS, S);
    expect(r).toBeCloseTo(0.9, 3);
    expect(retrievability(newSrsFields(NOW), NOW, S)).toBeNull();
  });

  it("previews exactly what the rating then saves", () => {
    const f = matureCard();
    const at = f.dueAt;
    const preview = previewIntervals("card-1", f, at, S);
    for (const rating of ["again", "hard", "good", "easy"] as const) {
      expect(rate(f, rating, at).next.dueAt).toBe(preview[rating].dueAt);
    }
  });

  it("writes a complete log entry", () => {
    const f = matureCard();
    const { log, next } = rate(f, "good", f.dueAt + 2 * DAY_MS);
    expect(log.stateBefore).toBe(State.Review);
    expect(log.stabilityBefore).toBe(f.stability);
    expect(log.stabilityAfter).toBe(next.stability);
    expect(log.elapsedDays).toBeGreaterThanOrEqual(f.scheduledDays + 2);
    expect(log.dueAfter).toBe(next.dueAt);
  });
});

describe("leeches", () => {
  it("flags a card on its 8th lapse and again every 4 lapses after", () => {
    let f = matureCard();
    let t = f.dueAt;
    const flaggedAt: number[] = [];
    for (let lapse = 1; lapse <= 16; lapse++) {
      const fail = rate(f, "again", t);
      if (fail.becameLeech) flaggedAt.push(fail.next.lapses);
      f = fail.next;
      t = f.dueAt;
      f = rate(f, "good", t).next;
      t = f.dueAt;
    }
    expect(flaggedAt).toEqual([LEECH_THRESHOLD, 12, 16]);
  });
});

describe("replayHistory", () => {
  it("matches applying each review in order", () => {
    const history = [
      { rating: "good" as const, reviewedAt: NOW },
      { rating: "good" as const, reviewedAt: NOW + 10 * MINUTE_MS },
      { rating: "again" as const, reviewedAt: NOW + 3 * DAY_MS },
      { rating: "good" as const, reviewedAt: NOW + 3 * DAY_MS + 10 * MINUTE_MS },
      { rating: "easy" as const, reviewedAt: NOW + 6 * DAY_MS },
    ];
    let expected = newSrsFields(NOW);
    for (const h of history) expected = rate(expected, h.rating, h.reviewedAt).next;

    // Out-of-order input is sorted first.
    const replayed = replayHistory("card-1", history.slice().reverse(), S, NOW);
    expect(replayed).toEqual(expected);
    expect(replayed.reps).toBe(5);
    expect(replayed.lapses).toBe(1);
  });

  it("agrees with ts-fsrs used directly (no fuzz)", () => {
    const direct = fsrs(generatorParameters({ enable_fuzz: false, learning_steps: ["1m", "10m"], relearning_steps: ["10m"] }));
    let card = direct.next(
      { due: new Date(NOW), stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: State.New },
      new Date(NOW),
      Rating.Good
    ).card;
    card = direct.next(card, new Date(NOW + 10 * MINUTE_MS), Rating.Good).card;
    const ours = replayHistory(
      "c",
      [
        { rating: "good", reviewedAt: NOW },
        { rating: "good", reviewedAt: NOW + 10 * MINUTE_MS },
      ],
      S,
      NOW
    );
    expect(ours.stability).toBeCloseTo(card.stability, 6);
    expect(ours.difficulty).toBeCloseTo(card.difficulty, 6);
  });

  it("returns a new card for an empty history", () => {
    expect(replayHistory("c", [], S, NOW).state).toBe(State.New);
  });
});

describe("legacyToSrs", () => {
  it("keeps never-reviewed cards new", () => {
    expect(legacyToSrs({ interval: 0, dueAt: NOW, lastReviewed: null, reviewCount: 0 }).state).toBe(State.New);
  });

  it("maps a ladder interval to a review card with that stability", () => {
    const f = legacyToSrs({ interval: 21, dueAt: NOW + 21 * DAY_MS, lastReviewed: NOW, reviewCount: 4 });
    expect(f.state).toBe(State.Review);
    expect(f.stability).toBe(21);
    expect(f.reps).toBe(4);
    expect(isMature(f)).toBe(true);
  });

  it("maps a just-failed card to relearning", () => {
    expect(legacyToSrs({ interval: 0, dueAt: NOW, lastReviewed: NOW, reviewCount: 2 }).state).toBe(State.Relearning);
  });
});

describe("relativeWorkload", () => {
  it("is 1 at 90% and grows steeply above it", () => {
    expect(relativeWorkload(0.9)).toBeCloseTo(1, 6);
    expect(relativeWorkload(0.85)).toBeLessThan(1);
    expect(relativeWorkload(0.95)).toBeGreaterThan(1.8);
    expect(relativeWorkload(0.97)).toBeGreaterThan(relativeWorkload(0.95));
  });

  it("tracks the stability-to-interval ratio ts-fsrs schedules with", () => {
    const f = matureCard();
    const at = f.dueAt;
    const i90 = scheduleReview("c", f, "good", at, { ...S, desiredRetention: 0.9 }).next;
    const i95 = scheduleReview("c", f, "good", at, { ...S, desiredRetention: 0.95 }).next;
    // Same stability either way; only the interval differs, by up to fuzz.
    expect(i90.stability).toBeCloseTo(i95.stability, 6);
    const ratio = i90.scheduledDays / i95.scheduledDays;
    expect(ratio / relativeWorkload(0.95)).toBeGreaterThan(0.8);
    expect(ratio / relativeWorkload(0.95)).toBeLessThan(1.25);
  });
});

describe("resolveWeights", () => {
  it("falls back to defaults for missing or malformed weights", () => {
    const defaults = resolveWeights(null);
    expect(defaults).toHaveLength(21);
    expect(resolveWeights([1, 2, 3])).toEqual(defaults);
    expect(resolveWeights(Array(21).fill(Number.NaN))).toEqual(defaults);
  });
});

describe("formatInterval", () => {
  it("renders Anki-style labels", () => {
    expect(formatInterval(30 * 1000)).toBe("<1m");
    expect(formatInterval(10 * MINUTE_MS)).toBe("10m");
    expect(formatInterval(3 * 60 * MINUTE_MS)).toBe("3h");
    expect(formatInterval(4 * DAY_MS)).toBe("4d");
    expect(formatInterval(105 * DAY_MS)).toBe("3.5mo");
    expect(formatInterval(365 * DAY_MS)).toBe("1y");
  });
});

describe("studyDayStart", () => {
  it("starts the study day at 4 am local time", () => {
    const threeAm = new Date(2026, 8, 14, 3, 30).getTime();
    const fiveAm = new Date(2026, 8, 14, 5, 0).getTime();
    expect(studyDayStart(threeAm)).toBe(new Date(2026, 8, 13, 4, 0).getTime());
    expect(studyDayStart(fiveAm)).toBe(new Date(2026, 8, 14, 4, 0).getTime());
  });
});

describe("buildStudyQueue", () => {
  const base = (id: string, over: Partial<SrsFields> & { createdAt?: number }) => ({
    ...newSrsFields(NOW),
    id,
    createdAt: NOW,
    ...over,
  });

  it("orders learning, then due reviews oldest-first, then new cards", () => {
    const cards = [
      base("new-b", { createdAt: NOW + 2 }),
      base("rev-late", { state: State.Review, dueAt: NOW - DAY_MS }),
      base("learn", { state: State.Learning, dueAt: NOW - MINUTE_MS }),
      base("new-a", { createdAt: NOW + 1 }),
      base("rev-early", { state: State.Review, dueAt: NOW - 3 * DAY_MS }),
      base("rev-future", { state: State.Review, dueAt: NOW + 5 * DAY_MS }),
      base("learn-later", { state: State.Relearning, dueAt: NOW + 2 * 60 * MINUTE_MS }),
    ];
    const q = buildStudyQueue(cards, NOW, { newPerDay: 50, maxReviewsPerDay: 500 }, { newCards: 0, reviews: 0 });
    expect(q.cards.map((c) => c.id)).toEqual(["learn", "rev-early", "rev-late", "new-a", "new-b"]);
    expect(q.counts).toEqual({ learning: 1, review: 2, new: 2 });
  });

  it("applies what is left of the daily limits", () => {
    const cards = [
      ...Array.from({ length: 5 }, (_, i) => base(`n${i}`, { createdAt: NOW + i })),
      ...Array.from({ length: 5 }, (_, i) => base(`r${i}`, { state: State.Review, dueAt: NOW - i })),
    ];
    const q = buildStudyQueue(cards, NOW, { newPerDay: 3, maxReviewsPerDay: 4 }, { newCards: 1, reviews: 1 });
    expect(q.counts).toEqual({ learning: 0, review: 3, new: 2 });
  });
});
