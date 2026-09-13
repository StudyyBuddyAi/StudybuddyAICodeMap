// Pure session-state helpers for the QBank player.
//
// Everything here is a function of its arguments, so the rules that decide
// what gets saved, what a resumed session looks like, and how a timed block's
// clock behaves can be tested without React or Supabase. QBankContext is the
// only caller.

import type {
  HighlightRange,
  OptionKey,
  PlayMode,
  Question,
  SessionAnnotations,
  SessionAnswer,
  SessionGeneration,
  SessionState,
} from "./qbank-types";
import { TIMED_SECONDS_PER_QUESTION } from "./qbank-types";

const OPTION_KEYS: readonly OptionKey[] = ["a", "b", "c", "d", "e"];

const isOptionKey = (v: unknown): v is OptionKey =>
  typeof v === "string" && (OPTION_KEYS as readonly string[]).includes(v);

export const emptyAnnotations = (): SessionAnnotations => ({ struck: {}, highlights: {} });

export const asPlayMode = (v: unknown): PlayMode => (v === "timed" ? "timed" : "tutor");

/**
 * Reads annotations back from the server, which stores whatever a client sent.
 * Anything malformed is dropped rather than trusted: a bad highlight range must
 * not be able to break rendering of the stem.
 */
export const normalizeAnnotations = (raw: unknown): SessionAnnotations => {
  const out = emptyAnnotations();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as { struck?: unknown; highlights?: unknown };

  if (r.struck && typeof r.struck === "object") {
    for (const [qid, keys] of Object.entries(r.struck as Record<string, unknown>)) {
      if (!Array.isArray(keys)) continue;
      const valid = [...new Set(keys.filter(isOptionKey))];
      if (valid.length > 0) out.struck[qid] = valid;
    }
  }

  if (r.highlights && typeof r.highlights === "object") {
    for (const [qid, ranges] of Object.entries(r.highlights as Record<string, unknown>)) {
      if (!Array.isArray(ranges)) continue;
      const valid = ranges.filter(
        (x): x is HighlightRange =>
          Array.isArray(x) &&
          x.length === 2 &&
          Number.isInteger(x[0]) &&
          Number.isInteger(x[1]) &&
          x[0] >= 0 &&
          x[1] > x[0]
      );
      if (valid.length > 0) out.highlights[qid] = valid;
    }
  }

  return out;
};

// ── Clock ───────────────────────────────────────────────────────────────────

/** Time spent in the set, not counting any stretch the clock was paused. */
export const elapsedMs = (
  s: Pick<SessionState, "accumulatedMs" | "resumedAt" | "clockRunning">,
  now: number
): number => s.accumulatedMs + (s.clockRunning ? Math.max(0, now - s.resumedAt) : 0);

/** Banks the running stretch and stops the clock. A no-op if already stopped. */
export const pauseClock = <T extends Pick<SessionState, "accumulatedMs" | "resumedAt" | "clockRunning">>(
  s: T,
  now: number
): T => (s.clockRunning ? { ...s, accumulatedMs: elapsedMs(s, now), resumedAt: now, clockRunning: false } : s);

/** Starts the clock from `now`. A no-op if already running. */
export const resumeClock = <T extends Pick<SessionState, "resumedAt" | "clockRunning">>(
  s: T,
  now: number
): T => (s.clockRunning ? s : { ...s, resumedAt: now, clockRunning: true });

/** How many questions the set will end with — what "Q3 of N" counts to. */
export const plannedTotal = (s: Pick<SessionState, "questions" | "expectedTotal">): number =>
  Math.max(s.questions.length, s.expectedTotal);

/**
 * A timed block's allowance. Counted against the planned size rather than what
 * has been written so far: a generated set hands over question one while the
 * other nineteen are still being written, and budgeting 90s for "the set" at
 * that moment would end the block before question two existed. When a run ends
 * short, expectedTotal is reconciled down and the allowance shrinks with it.
 */
export const timedBudgetMs = (s: Pick<SessionState, "questions" | "expectedTotal">): number =>
  plannedTotal(s) * TIMED_SECONDS_PER_QUESTION * 1000;

export const timeRemainingMs = (s: SessionState, now: number): number | null =>
  s.mode === "timed" ? Math.max(0, timedBudgetMs(s) - elapsedMs(s, now)) : null;

// ── Answers ─────────────────────────────────────────────────────────────────

/** Whether the student has committed something to this question. */
export const hasResponse = (
  s: Pick<SessionState, "mode" | "answers" | "selections">,
  questionId: string
): boolean =>
  s.mode === "timed"
    ? !!s.selections[questionId]
    : s.answers.some((a) => a.question_id === questionId);

/**
 * Standing at the end of what has been written, having done everything there
 * is to do, with more questions still to come. The clock pauses here: time the
 * generator spends writing is not time the student spent answering.
 */
export const isWaitingForNext = (s: SessionState): boolean => {
  if (s.questions.length >= s.expectedTotal) return false;
  if (s.currentIndex < s.questions.length - 1) return false;
  const current = s.questions[s.currentIndex];
  return !!current && hasResponse(s, current.id);
};

export interface EndBlockStats {
  answered: number;
  unanswered: number;
  flagged: number;
  /** Questions planned for the set that have not been written yet. */
  notWritten: number;
}

export const endBlockStats = (s: SessionState): EndBlockStats => {
  const answered = s.questions.filter((q) => hasResponse(s, q.id)).length;
  return {
    answered,
    unanswered: s.questions.length - answered,
    flagged: s.flaggedIds.filter((id) => s.questions.some((q) => q.id === id)).length,
    notWritten: Math.max(0, s.expectedTotal - s.questions.length),
  };
};

/**
 * The questions a tutor-mode summary covers: the ones answered, in set order.
 *
 * Positions and answers are not interchangeable. Taking the first N questions
 * for N answers — what the summary used to do — shows the wrong questions as
 * soon as anything before the end was skipped.
 */
export const summaryQuestions = (s: Pick<SessionState, "questions" | "answers">): Question[] => {
  const answered = new Set(s.answers.map((a) => a.question_id));
  return s.questions.filter((q) => answered.has(q.id));
};

/** Adds a question to the seen-but-unanswered list when the student leaves it. */
export const markSkippedIfUnanswered = (s: SessionState): SessionState => {
  const q = s.questions[s.currentIndex];
  if (!q || hasResponse(s, q.id) || s.skippedIds.includes(q.id)) return s;
  return { ...s, skippedIds: [...s.skippedIds, q.id] };
};

/** Moves to a loaded question. Out-of-range indices leave the session as it is. */
export const moveTo = (s: SessionState, index: number, now: number): SessionState => {
  if (index < 0 || index >= s.questions.length || index === s.currentIndex) return s;
  const left = markSkippedIfUnanswered(s);
  const target = s.questions[index];
  return {
    ...left,
    currentIndex: index,
    questionStartedAt: now,
    // Answering a skipped question later is the point of skipping it; once it
    // is open again it is no longer "skipped", merely unanswered.
    skippedIds: left.skippedIds.filter((id) => id !== target.id),
  };
};

// ── Server round trip ───────────────────────────────────────────────────────

/** Orders progress saves across tabs and devices. See save_qbank_progress. */
export const nextProgressSeq = (lastSeq: number, now: number): number =>
  Math.max(lastSeq + 1, Math.floor(now));

export interface ProgressPayload {
  p_current_index: number;
  p_skipped_ids: string[];
  p_elapsed_ms: number;
  p_expected_total: number;
  p_generation: SessionGeneration | null;
  p_annotations: SessionAnnotations;
  /**
   * The set's complete flag list. The server reconciles flagged_questions to
   * it, so flags share this snapshot's ordering instead of racing as separate
   * requests.
   */
  p_flagged_ids: string[];
}

/** Flags or unflags one question, from whatever the state is right now. */
export const toggleFlagged = (flaggedIds: string[], questionId: string): string[] =>
  flaggedIds.includes(questionId)
    ? flaggedIds.filter((id) => id !== questionId)
    : [...flaggedIds, questionId];

/**
 * The one progress snapshot. Every save goes through here, so no save can omit
 * a field — the old localStorage writes built three different payloads by hand,
 * and two of them dropped the generation, which left a half-written set
 * looking finished after a reload.
 */
export const buildProgressPayload = (s: SessionState, now: number): ProgressPayload => ({
  p_current_index: s.currentIndex,
  p_skipped_ids: s.skippedIds,
  p_elapsed_ms: Math.round(elapsedMs(s, now)),
  p_expected_total: plannedTotal(s),
  p_generation: s.generation,
  p_annotations: s.annotations,
  p_flagged_ids: s.flaggedIds,
});

/** Where a resumed generation continues numbering its questions. */
export const resumeStartIndex = (nextIndex: number, generationMaxIndex: number | null | undefined): number =>
  typeof generationMaxIndex === "number" && Number.isFinite(generationMaxIndex)
    ? Math.max(nextIndex, generationMaxIndex + 1)
    : nextIndex;

const KEY_FIELDS = ["correct_option", "explanation", "teaching_point", "distractor_explanations"] as const;

const withoutKey = (q: Question): Question => {
  const copy = { ...q };
  for (const f of KEY_FIELDS) delete (copy as Record<string, unknown>)[f];
  return copy;
};

export interface ResumeResult {
  session: {
    id: string;
    mode: string;
    started_at: string;
    current_index: number;
    skipped_ids: string[] | null;
    elapsed_ms: number;
    expected_total: number | null;
    generation: SessionGeneration | null;
    annotations: unknown;
    progress_seq: number;
  };
  questions: Question[];
  answers: SessionAnswer[];
  selections?: { question_id: string; selected_option: string }[];
  flagged: string[] | null;
  generation_max_index: number | null;
}

/**
 * Rebuilds the player's session from resume_qbank_session.
 *
 * Defensive about the key even though the server already withholds it: a timed
 * set must never render a correct answer, so any key field that does arrive on
 * one is stripped here as well.
 */
export const sessionFromResume = (r: ResumeResult, now: number): SessionState => {
  const mode = asPlayMode(r.session.mode);
  const questions = (r.questions ?? []).map((q) => (mode === "timed" ? withoutKey(q) : q));
  const ids = new Set(questions.map((q) => q.id));

  const selections: Record<string, OptionKey> = {};
  if (mode === "timed") {
    for (const sel of r.selections ?? []) {
      if (ids.has(sel.question_id) && isOptionKey(sel.selected_option)) {
        selections[sel.question_id] = sel.selected_option;
      }
    }
  }

  const generation = r.session.generation
    ? {
        ...r.session.generation,
        nextIndex: resumeStartIndex(r.session.generation.nextIndex ?? 1, r.generation_max_index),
      }
    : null;

  const lastIndex = Math.max(0, questions.length - 1);
  const startedAt = Date.parse(r.session.started_at);

  return {
    sessionId: r.session.id,
    mode,
    questions,
    currentIndex: Math.min(Math.max(0, r.session.current_index ?? 0), lastIndex),
    answers: mode === "timed" ? [] : (r.answers ?? []).filter((a) => ids.has(a.question_id)),
    selections,
    startedAt: Number.isFinite(startedAt) ? startedAt : now,
    questionStartedAt: now,
    accumulatedMs: Math.max(0, Number(r.session.elapsed_ms) || 0),
    resumedAt: now,
    clockRunning: true,
    skippedIds: (r.session.skipped_ids ?? []).filter((id) => ids.has(id)),
    flaggedIds: (r.flagged ?? []).filter((id) => ids.has(id)),
    expectedTotal: Math.max(questions.length, r.session.expected_total ?? questions.length),
    generation,
    annotations: normalizeAnnotations(r.session.annotations),
    progressSeq: Number(r.session.progress_seq) || 0,
  };
};
