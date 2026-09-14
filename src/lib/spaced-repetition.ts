import {
  Rating,
  State,
  StrategyMode,
  GenSeedStrategyWithCardId,
  checkParameters,
  dateDiffInDays,
  default_w,
  forgetting_curve,
  fsrs,
  generatorParameters,
  migrateParameters,
  type Card as FsrsCard,
  type FSRS,
  type Grade,
} from "ts-fsrs";

/**
 * FSRS-6 scheduling for flashcards — the algorithm modern Anki uses.
 *
 * Every card carries a memory model: difficulty D (1–10), stability S (days
 * until recall probability falls to 90%) and, derived from those plus the time
 * since the last review, retrievability R. A review moves D and S according to
 * the rating and to how much the card had been forgotten, and the next due date
 * is the moment R is predicted to fall to the user's desired retention.
 *
 * New and lapsed cards first walk short (re)learning steps — 1m 10m and 10m,
 * Anki's defaults — before FSRS takes over at day granularity.
 *
 * Everything here is pure: the hook persists what these functions return, and
 * the server only validates it. One implementation serves both signed-in and
 * anonymous users.
 */

export type ReviewRating = "again" | "hard" | "good" | "easy";

export const RATINGS: readonly ReviewRating[] = ["again", "hard", "good", "easy"];

export { State as SrsState };

export const MINUTE_MS = 60 * 1000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

/** Lapses at which a card is flagged a leech (Anki default). */
export const LEECH_THRESHOLD = 8;
/** Stability at which a card counts as mastered — Anki's "mature" line. */
export const MATURE_STABILITY_DAYS = 21;
/** How early a learning card may be shown when nothing else is left (Anki default). */
export const LEARN_AHEAD_MS = 20 * MINUTE_MS;
/** Local hour at which a new study day begins (Anki default). */
export const DAY_ROLLOVER_HOUR = 4;

export const LEARNING_STEPS = ["1m", "10m"] as const;
export const RELEARNING_STEPS = ["10m"] as const;
export const MAXIMUM_INTERVAL_DAYS = 36500;

export const RETENTION_MIN = 0.8;
export const RETENTION_MAX = 0.97;

export interface SrsSettings {
  /** Target probability of recall at the moment a card comes due. */
  desiredRetention: number;
  newPerDay: number;
  maxReviewsPerDay: number;
  /** Per-user optimized FSRS weights, or null for the FSRS-6 defaults. */
  weights: number[] | null;
}

export const DEFAULT_SRS_SETTINGS: SrsSettings = {
  desiredRetention: 0.9,
  newPerDay: 50,
  maxReviewsPerDay: 500,
  weights: null,
};

/** The scheduling half of a card: what FSRS reads and writes. */
export interface SrsFields {
  state: State;
  stability: number;
  difficulty: number;
  /** Epoch ms at which the card is next due. */
  dueAt: number;
  /** Epoch ms of the last review, or null for a new card. */
  lastReviewed: number | null;
  scheduledDays: number;
  /** Index into the current (re)learning steps. */
  learningSteps: number;
  reps: number;
  lapses: number;
}

/** One review as persisted to `review_sessions`. */
export interface ReviewLogEntry {
  rating: ReviewRating;
  stateBefore: State;
  stabilityBefore: number;
  difficultyBefore: number;
  /** Calendar days since the previous review (0 for a first or same-day review). */
  elapsedDays: number;
  scheduledDays: number;
  stabilityAfter: number;
  difficultyAfter: number;
  dueAfter: number;
  reviewedAt: number;
}

export interface ReviewOutcome {
  next: SrsFields;
  log: ReviewLogEntry;
  /** True when this review took the card to the leech threshold or a multiple of half of it past there. */
  becameLeech: boolean;
}

const RATING_TO_GRADE: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export function ratingToGrade(rating: ReviewRating): Grade {
  return RATING_TO_GRADE[rating];
}

export function isReviewRating(value: unknown): value is ReviewRating {
  return typeof value === "string" && (RATINGS as readonly string[]).includes(value);
}

/**
 * Validate stored weights. Anything malformed falls back to the defaults
 * rather than breaking every review — a bad optimizer run must not lock a user
 * out of studying.
 */
export function resolveWeights(weights: readonly number[] | null | undefined): readonly number[] {
  if (!weights || !weights.length) return default_w;
  // migrateParameters clamps non-finite values to their lower bound instead of
  // rejecting them, so reject garbage before it gets a chance to look valid.
  if (![17, 19, 21].includes(weights.length) || !weights.every(Number.isFinite)) {
    return default_w;
  }
  try {
    return checkParameters(migrateParameters(weights.slice(), RELEARNING_STEPS.length, true));
  } catch {
    return default_w;
  }
}

export function clampRetention(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_SRS_SETTINGS.desiredRetention;
  return Math.min(RETENTION_MAX, Math.max(RETENTION_MIN, r));
}

const schedulerCache = new Map<string, FSRS>();

/** A configured ts-fsrs instance, memoized per retention + weights. */
export function getScheduler(settings: Pick<SrsSettings, "desiredRetention" | "weights">): FSRS {
  const w = resolveWeights(settings.weights);
  const retention = clampRetention(settings.desiredRetention);
  const key = `${retention}|${w.join(",")}`;
  let scheduler = schedulerCache.get(key);
  if (!scheduler) {
    scheduler = fsrs(
      generatorParameters({
        request_retention: retention,
        maximum_interval: MAXIMUM_INTERVAL_DAYS,
        w,
        enable_fuzz: true,
        enable_short_term: true,
        learning_steps: LEARNING_STEPS,
        relearning_steps: RELEARNING_STEPS,
      })
      // Seeding fuzz from card id + reps (instead of the review timestamp) makes
      // the interval previewed on a button the interval that rating then saves.
    ).useStrategy(StrategyMode.SEED, GenSeedStrategyWithCardId("cid"));
    schedulerCache.set(key, scheduler);
  }
  return scheduler;
}

type SeededCard = FsrsCard & { cid: string };

function toFsrsCard(cid: string, f: SrsFields, now: number): SeededCard {
  return {
    cid,
    due: new Date(f.dueAt),
    stability: f.stability,
    difficulty: f.difficulty,
    elapsed_days: f.lastReviewed === null ? 0 : dateDiffInDays(new Date(f.lastReviewed), new Date(now)),
    scheduled_days: f.scheduledDays,
    learning_steps: f.learningSteps,
    reps: f.reps,
    lapses: f.lapses,
    state: f.state,
    last_review: f.lastReviewed === null ? undefined : new Date(f.lastReviewed),
  };
}

function fromFsrsCard(c: FsrsCard): SrsFields {
  return {
    state: c.state,
    stability: c.stability,
    difficulty: c.difficulty,
    dueAt: c.due.getTime(),
    lastReviewed: c.last_review ? c.last_review.getTime() : null,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
  };
}

export function newSrsFields(now: number): SrsFields {
  return {
    state: State.New,
    stability: 0,
    difficulty: 0,
    dueAt: now,
    lastReviewed: null,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
  };
}

/** Apply one rating to a card. */
export function scheduleReview(
  cid: string,
  fields: SrsFields,
  rating: ReviewRating,
  now: number,
  settings: Pick<SrsSettings, "desiredRetention" | "weights">
): ReviewOutcome {
  const scheduler = getScheduler(settings);
  const input = toFsrsCard(cid, fields, now);
  const { card } = scheduler.next(input, new Date(now), ratingToGrade(rating));
  const next = fromFsrsCard(card);
  const lapsed = next.lapses > fields.lapses;
  const half = Math.ceil(LEECH_THRESHOLD / 2);
  const becameLeech =
    lapsed &&
    next.lapses >= LEECH_THRESHOLD &&
    (next.lapses - LEECH_THRESHOLD) % half === 0;
  return {
    next,
    becameLeech,
    log: {
      rating,
      stateBefore: fields.state,
      stabilityBefore: fields.stability,
      difficultyBefore: fields.difficulty,
      elapsedDays: input.elapsed_days,
      scheduledDays: next.scheduledDays,
      stabilityAfter: next.stability,
      difficultyAfter: next.difficulty,
      dueAfter: next.dueAt,
      reviewedAt: now,
    },
  };
}

export interface IntervalPreview {
  dueAt: number;
  /** Anki-style short label: "<1m", "10m", "1d", "3.5mo", "1.2y". */
  label: string;
}

/** What each of the four buttons would do, for the labels under them. */
export function previewIntervals(
  cid: string,
  fields: SrsFields,
  now: number,
  settings: Pick<SrsSettings, "desiredRetention" | "weights">
): Record<ReviewRating, IntervalPreview> {
  const scheduler = getScheduler(settings);
  const preview = scheduler.repeat(toFsrsCard(cid, fields, now), new Date(now));
  const out = {} as Record<ReviewRating, IntervalPreview>;
  for (const rating of RATINGS) {
    const dueAt = preview[ratingToGrade(rating)].card.due.getTime();
    out[rating] = { dueAt, label: formatInterval(dueAt - now) };
  }
  return out;
}

function trimFixed(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

export function formatInterval(ms: number): string {
  const minutes = ms / MINUTE_MS;
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = ms / DAY_MS;
  if (days < 30) return `${Math.round(days)}d`;
  const months = days / 30;
  if (months < 12) return `${trimFixed(months)}mo`;
  return `${trimFixed(days / 365)}y`;
}

/** Predicted probability of recall right now. New cards have none. */
export function retrievability(
  fields: SrsFields,
  now: number,
  settings: Pick<SrsSettings, "weights">
): number | null {
  if (fields.state === State.New || fields.lastReviewed === null || fields.stability <= 0) {
    return null;
  }
  const elapsedDays = Math.max(0, (now - fields.lastReviewed) / DAY_MS);
  return forgetting_curve(resolveWeights(settings.weights), elapsedDays, fields.stability);
}

/**
 * Review load at retention `r` relative to 90%. Every interval scales by the
 * same factor when retention changes — I(r) = S/F · (r^(1/−decay) − 1) — so
 * this ratio holds across the whole deck: 0.95 means roughly 2× the reviews.
 */
export function relativeWorkload(r: number, weights: readonly number[] | null = null): number {
  const w = resolveWeights(weights);
  const decay = -w[20];
  const factor = Math.pow(0.9, 1 / decay) - 1;
  const intervalAt = (x: number) => (Math.pow(x, 1 / decay) - 1) / factor;
  return intervalAt(0.9) / intervalAt(clampRetention(r));
}

export function isMature(fields: SrsFields): boolean {
  return fields.state === State.Review && fields.stability >= MATURE_STABILITY_DAYS;
}

/** One past review, in the shape `review_sessions` stores it. */
export interface HistoryReview {
  rating: ReviewRating;
  reviewedAt: number;
}

/**
 * Rebuild a card's state by running its review history through FSRS in order.
 * This is how cards scheduled by the old fixed ladder join FSRS: their ratings
 * and timestamps are all FSRS needs.
 */
export function replayHistory(
  cid: string,
  reviews: readonly HistoryReview[],
  settings: Pick<SrsSettings, "desiredRetention" | "weights">,
  createdAt: number
): SrsFields {
  const ordered = reviews.slice().sort((a, b) => a.reviewedAt - b.reviewedAt);
  let fields = newSrsFields(Math.min(createdAt, ordered[0]?.reviewedAt ?? createdAt));
  for (const review of ordered) {
    fields = scheduleReview(cid, fields, review.rating, review.reviewedAt, settings).next;
  }
  return fields;
}

/**
 * Best-effort conversion for a ladder-scheduled card with no review history
 * (anonymous users never logged reviews). The ladder interval is the closest
 * thing it has to a stability; difficulty starts at the middle of the scale.
 */
export function legacyToSrs(legacy: {
  interval: number;
  dueAt: number;
  lastReviewed: number | null;
  reviewCount: number;
}): SrsFields {
  if (legacy.reviewCount <= 0 || legacy.lastReviewed === null) {
    return newSrsFields(legacy.dueAt);
  }
  if (legacy.interval <= 0) {
    // Last rated "again": treat it as a card partway through relearning.
    return {
      state: State.Relearning,
      stability: 0.5,
      difficulty: 7,
      dueAt: legacy.dueAt,
      lastReviewed: legacy.lastReviewed,
      scheduledDays: 0,
      learningSteps: 0,
      reps: legacy.reviewCount,
      lapses: 1,
    };
  }
  return {
    state: State.Review,
    stability: legacy.interval,
    difficulty: 5,
    dueAt: legacy.dueAt,
    lastReviewed: legacy.lastReviewed,
    scheduledDays: legacy.interval,
    learningSteps: 0,
    reps: legacy.reviewCount,
    lapses: 0,
  };
}

/** Epoch ms at which the current study day began (the last local 4 am). */
export function studyDayStart(now: number, rolloverHour = DAY_ROLLOVER_HOUR): number {
  const d = new Date(now);
  d.setHours(rolloverHour, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

export function nextStudyDayStart(now: number, rolloverHour = DAY_ROLLOVER_HOUR): number {
  const d = new Date(studyDayStart(now, rolloverHour));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function isLearningState(state: State): boolean {
  return state === State.Learning || state === State.Relearning;
}

export interface QueueCard extends SrsFields {
  id: string;
  createdAt: number;
}

export interface StudyQueue<T extends QueueCard> {
  /** Cards to study now, in order: learning, reviews, then new cards. */
  cards: T[];
  counts: { learning: number; review: number; new: number };
}

/**
 * Today's queue, Anki-style. Learning and relearning cards come first (they
 * are mid-acquisition and time-sensitive), then review cards due today (oldest
 * first), then new cards — each capped by what is left of the daily limits.
 */
export function buildStudyQueue<T extends QueueCard>(
  cards: readonly T[],
  now: number,
  limits: Pick<SrsSettings, "newPerDay" | "maxReviewsPerDay">,
  doneToday: { newCards: number; reviews: number }
): StudyQueue<T> {
  const dayEnd = nextStudyDayStart(now);
  const learning: T[] = [];
  const reviews: T[] = [];
  const fresh: T[] = [];
  for (const card of cards) {
    if (isLearningState(card.state)) {
      if (card.dueAt <= now + LEARN_AHEAD_MS) learning.push(card);
    } else if (card.state === State.Review) {
      if (card.dueAt < dayEnd) reviews.push(card);
    } else {
      fresh.push(card);
    }
  }
  learning.sort((a, b) => a.dueAt - b.dueAt);
  reviews.sort((a, b) => a.dueAt - b.dueAt);
  fresh.sort((a, b) => a.createdAt - b.createdAt);

  const reviewRoom = Math.max(0, limits.maxReviewsPerDay - doneToday.reviews);
  const newRoom = Math.max(0, limits.newPerDay - doneToday.newCards);
  const dueReviews = reviews.slice(0, reviewRoom);
  const newCards = fresh.slice(0, newRoom);

  return {
    cards: [...learning, ...dueReviews, ...newCards],
    counts: { learning: learning.length, review: dueReviews.length, new: newCards.length },
  };
}
