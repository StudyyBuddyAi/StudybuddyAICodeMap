import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type {
  Question,
  OptionKey,
  SessionAnswer,
  SessionState,
  SessionGeneration,
  ChallengeLevel,
  ExamMode,
  PlayMode,
  HighlightRange,
} from "@/lib/qbank-types";
import {
  runQbankGeneration,
  MIN_SET_SIZE,
  MAX_SET_SIZE,
  type GenerationOutcome,
  type GenerationStatus,
  type HeldBackItem,
} from "@/lib/qbank-wave-runner";
import {
  buildProgressPayload,
  elapsedMs as elapsedAt,
  emptyAnnotations,
  endBlockStats as computeEndBlockStats,
  hasResponse,
  isWaitingForNext as computeWaitingForNext,
  moveTo,
  nextProgressSeq,
  pauseClock,
  plannedTotal as computePlannedTotal,
  resumeClock,
  sessionFromResume,
  summaryQuestions,
  timeRemainingMs as computeTimeRemaining,
  toggleFlagged,
  type EndBlockStats,
  type ResumeResult,
} from "@/lib/qbank-session-state";
import { addHighlight as mergeHighlight, removeHighlightAt } from "@/lib/qbank-highlights";

/** Debounce for progress saves after a change. */
const SAVE_DEBOUNCE_MS = 1500;
/** Heartbeat, so elapsed time is banked even while nothing else changes. */
const SAVE_HEARTBEAT_MS = 30_000;

/**
 * Identifies one generated set across every wave that writes it.
 *
 * Minted here rather than server-side because the client has to know it BEFORE
 * the first request, so that a request which never returns still leaves rows
 * the client can find. The fallback covers insecure contexts, where
 * crypto.randomUUID is not exposed.
 */
const newGenerationId = (): string => {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

export interface SessionConfig {
  domains: string[];
  limit: number;
  system?: string;
  questionIds?: string[];
  mode?: PlayMode;
  /**
   * Generated sessions only: how many questions the set will END with, which is
   * more than it starts with. A curated session leaves this alone and is
   * complete from the first render.
   */
  expectedTotal?: number;
  generation?: SessionGeneration | null;
}

/**
 * The state of the wave loop, for the surfaces that report on it.
 *
 * Counts deliberately live on the session rather than here: the session's
 * question list is the only honest answer to "how many do I have", since it is
 * built from what the reconciliation RPC actually returned rather than from
 * what the generator believes it wrote.
 */
export interface GenerationState {
  status: "running" | GenerationStatus;
  topic: string;
  target: number;
  systemName: string | null;
  /**
   * Questions that were written and then withheld — the QA gate blocked them,
   * or the blind second read disagreed with the key. Worth showing: it is the
   * honest reason a set of twenty can take five waves, and it is the difference
   * between "the model struggled" and "the model wrote nothing".
   */
  heldBack: number;
  /**
   * Which questions were withheld and why, so the set can report what went
   * wrong rather than only how often. Named by gate rule, or "disputed" when the
   * blind second read landed somewhere other than the key.
   */
  heldBackItems: HeldBackItem[];
  /** Set when the run failed outright, or ended short for a known reason. */
  error: string | null;
}

interface SessionSummary {
  questions: Question[];
  answers: SessionAnswer[];
  totalTime: number;
  score: number;
  total: number;
  flaggedIds: string[];
  /** Questions the set held that were never answered. */
  omitted?: number;
}

/**
 * - resumed: the set is live.
 * - completed: it was already finished; go to its summary.
 * - closed: this tab just left it (Save & Exit, End block, Discard) and the
 *   request was not an explicit one — see resumeSession.
 * - failed: it could not be loaded.
 */
export type ResumeOutcome = "resumed" | "completed" | "closed" | "failed";

export interface ResumeAttempt {
  outcome: ResumeOutcome;
  /** Failed only: what went wrong, fit to show the student. */
  error?: string;
}

/**
 * Turns a resume RPC error into something a student can act on, while keeping
 * the server's own words for anything unexpected — "couldn't be loaded" with no
 * reason is exactly what made the created_at drift slow to diagnose.
 */
const describeResumeError = (message: string | undefined): string => {
  if (!message) return "No response from the server. Check your connection.";
  if (message.includes("session_not_found")) return "This set doesn't exist, or it belongs to another account.";
  if (message.includes("not_authenticated")) return "You're signed out. Sign in again to continue this set.";
  if (/failed to fetch|network/i.test(message)) return "You appear to be offline.";
  return message;
};
export type SaveState = "idle" | "saving" | "error";

interface QBankContextValue {
  session: SessionState | null;
  currentQuestion: Question | null;
  currentIndex: number;
  totalQuestions: number;
  isLastQuestion: boolean;
  /** More questions are still expected for this set than have arrived. */
  isAwaitingMore: boolean;
  /** At the end of what is written, with nothing left to do but wait. */
  isWaitingForNext: boolean;
  generation: GenerationState | null;
  /** The generation behind the most recently finished session, if it had one. */
  lastGeneration: SessionGeneration | null;
  /** How the most recently finished session was sat. */
  lastMode: PlayMode;
  progress: number;
  /**
   * Generates a set and starts playing it as soon as the first question exists.
   * Resolves with the session id once the session is live, while the rest keeps
   * being written.
   */
  startGeneratedSession: (
    topic: string,
    target: number,
    challenge?: ChallengeLevel,
    examMode?: ExamMode,
    mode?: PlayMode
  ) => Promise<string>;
  /** Cancels an in-flight set. Whatever landed stays playable. */
  stopGeneration: () => void;
  /**
   * Reconciles the session against the table and picks an interrupted set back
   * up. Safe to call repeatedly; a no-op for a curated or finished session.
   */
  resumeGeneration: () => void;
  /**
   * Loads an unfinished set from the server — on this device or any other.
   * Pass explicit for a deliberate Resume; the player's automatic load on a
   * ?session= URL is not, and does not reopen a set this tab just left.
   */
  resumeSession: (sessionId: string, opts?: { explicit?: boolean }) => Promise<ResumeAttempt>;
  /** Saves where the student is and leaves the set open to resume later. */
  saveAndExit: () => Promise<void>;
  /** Deletes an unfinished set, its answers and its flags. */
  discardSession: (sessionId: string) => Promise<void>;
  /** Tutor mode: grade the current question. */
  submitAnswer: (key: OptionKey) => Promise<{ is_correct: boolean; correct_option: OptionKey } | undefined>;
  /** Timed mode: record (or change) the current question's choice, ungraded. */
  selectTimedAnswer: (key: OptionKey) => void;
  nextQuestion: () => void;
  prevQuestion: () => void;
  endSession: () => Promise<SessionSummary | null>;
  resetSession: () => void;
  lastSummary: SessionSummary | null;
  reviewIndex: number | null;
  setReviewIndex: (index: number | null) => void;
  enterSummaryReview: (index: number) => void;
  displayQuestion: Question | null;
  displayAnswer: SessionAnswer | null;
  isReviewing: boolean;
  loadSummary: (data: SessionSummary) => void;
  getElapsedMs: () => number;
  /** Null in tutor mode. */
  getTimeRemainingMs: () => number | null;
  flaggedIds: Set<string>;
  toggleFlag: (questionId: string) => Promise<void>;
  isFlagLoading: boolean;
  toggleStrike: (questionId: string, key: OptionKey) => void;
  addHighlight: (questionId: string, range: HighlightRange, textLength: number) => void;
  removeHighlight: (questionId: string, offset: number) => void;
  skipQuestion: () => void;
  goToQuestion: (index: number) => void;
  unansweredCount: number;
  endBlockStats: EndBlockStats | null;
  saveState: SaveState;
}

const QBankContext = createContext<QBankContextValue | null>(null);

export const QBankProvider = ({ children }: { children: ReactNode }) => {
  const { user, session: authSession } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [session, setSession] = useState<SessionState | null>(null);
  const [lastSummary, setLastSummary] = useState<SessionSummary | null>(null);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [generation, setGeneration] = useState<GenerationState | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  /**
   * The generation behind the session that just finished.
   *
   * The session is torn down on finish, and with it the topic and size the set
   * was written to — which is exactly what the summary needs to offer another
   * set on the same topic.
   */
  const [lastGeneration, setLastGeneration] = useState<SessionGeneration | null>(null);
  const [lastMode, setLastMode] = useState<PlayMode>("tutor");

  // The generation callbacks are long-lived and fire from a stream, long after
  // the render that created them. They read these rather than closed-over state,
  // which would be stale by the time the second question arrives.
  const sessionRef = useRef<SessionState | null>(null);
  sessionRef.current = session;
  const sessionIdRef = useRef<string | null>(null);
  const genAbortRef = useRef<AbortController | null>(null);
  const genRunningRef = useRef(false);
  const claimRef = useRef({ running: false, dirty: false });
  // Held-back questions across every run of the current set. The runner reports
  // its own running total, so a resumed run has to be added to what came before
  // it rather than replacing it.
  const heldBackRef = useRef(0);
  const heldBackItemsRef = useRef<HeldBackItem[]>([]);

  // Progress saving. The sequence is shared by every save from this tab, so the
  // server can drop one that arrives after a newer one.
  const progressSeqRef = useRef(0);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const saveTimerRef = useRef<number | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  accessTokenRef.current = authSession?.access_token ?? null;
  // Timed selections in flight, per question, so they are written in the order
  // they were made and endSession can wait for the last of them.
  const timedWritesRef = useRef<Map<string, Promise<void>>>(new Map());
  // Sets this tab has just left. The route transition keeps the player mounted
  // for a beat after Save & Exit or End block, still reading ?session=<id>, and
  // without this it would load the set straight back.
  const closedIdsRef = useRef<Set<string>>(new Set());

  const flaggedIds: Set<string> = useMemo(
    () => new Set(session?.flaggedIds ?? []),
    [session?.flaggedIds]
  );

  const isFlagLoading = false;

  // ── Progress saving ───────────────────────────────────────────────────────
  //
  // The server holds the only copy of an unfinished set's progress. Answers and
  // claimed questions go through their own RPCs as they happen; this snapshot
  // carries everything else — position, skipped, clock, the generation's resume
  // point, strike-outs, highlights and flags.
  //
  // Flags are in the snapshot on purpose. As one request per toggle they raced:
  // flag-then-unflag could land reversed, overlapping flags collided on the
  // unique constraint, and a flag in flight at Save & Exit or a refresh was
  // lost. The snapshot is serialised here and ordered by seq on the server, so
  // whatever the student sees last is what the server keeps.

<<<<<<< HEAD
    // The answer key and explanations were already graded server-side; what
    // gets cached on disk may carry selected answers and skipped/flagged ids,
    // but never the correct_option / explanation / teaching_point themselves.
    const questions = s.questions.map(({ correct_option, explanation, teaching_point, ...safe }) => safe);

    const payload = {
      sessionId: s.sessionId,
      questions,
      currentIndex: persistIndex,
      answers: s.answers,
      startedAt: s.startedAt,
      accumulatedMs: s.accumulatedMs + (Date.now() - s.resumedAt),
      skippedIds: s.skippedIds,
      flaggedIds: s.flaggedIds,
      // Carried so a reload can tell an unfinished set from a finished one and
      // pick the generation back up where it stopped.
      expectedTotal: s.expectedTotal,
      generation: s.generation,
      savedAt: Date.now(),
    };
=======
  /** Resolves once a failed save has been retried. */
  const retryTimerRef = useRef<number | null>(null);
>>>>>>> origin/main

  const runSave = useCallback(async (): Promise<boolean> => {
    const s = sessionRef.current;
    if (!s?.sessionId) return true;

    // At most one retry for a stale seq: another device saved with a later
    // clock. Re-sending above its seq makes this tab's current state the latest.
    for (let attempt = 0; attempt < 2; attempt++) {
      const now = Date.now();
      const seq = nextProgressSeq(progressSeqRef.current, now);
      progressSeqRef.current = seq;
      const payload = buildProgressPayload(sessionRef.current ?? s, now);

      setSaveState("saving");
      const { data, error } = await supabase.rpc("save_qbank_progress", {
        p_session: s.sessionId,
        p_seq: seq,
        ...payload,
        p_generation: payload.p_generation as unknown as Json,
        p_annotations: payload.p_annotations as unknown as Json,
      });
<<<<<<< HEAD
      sessionIdRef.current = parsed.sessionId;

      // Answer-key fields never live in localStorage; once a session resumes,
      // re-attach them for already-answered questions from the review RPC so
      // the graded state a student sees after resuming is intact.
      if (parsed.sessionId && Array.isArray(parsed.answers) && parsed.answers.length > 0) {
        (async () => {
          try {
            const { data } = await supabase.rpc("get_session_review", {
              p_session: parsed.sessionId,
            });
            if (!data) return;
            const attempts = (data as { attempts?: Array<{ question_id?: string; question?: { correct_option?: string; explanation?: string; teaching_point?: string } | null }> }).attempts ?? [];
            const graded = new Map(
              attempts
                .filter((a) => a.question_id && a.question)
                .map((a) => [a.question_id as string, a.question as NonNullable<typeof a.question>])
            );
            if (graded.size === 0) return;
            setSession((prev) => {
              if (!prev || prev.sessionId !== parsed.sessionId) return prev;
              return {
                ...prev,
                questions: prev.questions.map((q) => {
                  const g = graded.get(q.id);
                  if (!g) return q;
                  return {
                    ...q,
                    correct_option: (g.correct_option as OptionKey) ?? q.correct_option,
                    explanation: g.explanation ?? q.explanation,
                    teaching_point: g.teaching_point ?? q.teaching_point,
                  };
                }),
              };
            });
          } catch {
            // Resuming without the graded fields is far better than failing it.
          }
        })();
      }

=======
      if (error) {
        console.error("save_qbank_progress failed:", error);
        setSaveState("error");
        return false;
      }
      const result = data as unknown as { ok?: boolean; reason?: string; seq?: number } | null;
      if (result?.ok === false && result.reason === "stale" && typeof result.seq === "number") {
        progressSeqRef.current = Math.max(progressSeqRef.current, result.seq);
        continue;
      }
      setSaveState("idle");
>>>>>>> origin/main
      return true;
    }
    setSaveState("idle");
    return true;
  }, []);

  /** Saves now, after any save already under way. A failed save retries itself. */
  const flushProgress = useCallback((): Promise<void> => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    const next = saveChainRef.current.then(runSave, runSave).then((ok) => {
      // An unsaved flag or highlight must not quietly stay unsaved.
      if (!ok && sessionRef.current?.sessionId && retryTimerRef.current === null) {
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          void flushProgress();
        }, 3000);
      }
    });
    saveChainRef.current = next.catch(() => undefined);
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSave]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushProgress();
    }, SAVE_DEBOUNCE_MS);
  }, [flushProgress]);

  /**
   * The save for a page that is going away. A normal request can be cancelled
   * as the page unloads; a keepalive fetch outlives it. Needs the token in hand
   * synchronously, which is why it is mirrored into a ref.
   */
  const keepaliveSave = useCallback(() => {
    const s = sessionRef.current;
    const token = accessTokenRef.current;
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!s?.sessionId || !token || !url || !key) return;
    const now = Date.now();
    const seq = nextProgressSeq(progressSeqRef.current, now);
    progressSeqRef.current = seq;
    try {
      void fetch(`${url}/rest/v1/rpc/save_qbank_progress`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ p_session: s.sessionId, p_seq: seq, ...buildProgressPayload(s, now) }),
      });
    } catch {
      // Best effort by definition: the page is already leaving.
    }
  }, []);

  const sessionKey = session?.sessionId ?? null;

  // Debounced save on anything the snapshot carries, except the clock, which
  // the heartbeat covers.
  useEffect(() => {
    if (!session?.sessionId) return;
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session?.sessionId,
    session?.currentIndex,
    session?.skippedIds,
    session?.expectedTotal,
    session?.generation,
    session?.annotations,
  ]);

  // A flag saves straight away rather than on the debounce: it is a deliberate
  // mark the student expects to see on the next resume, even one seconds away.
  const flagKey = session?.flaggedIds;
  const flagSessionRef = useRef<{ id: string | null; flags: string[] | undefined }>({ id: null, flags: undefined });
  useEffect(() => {
    const prev = flagSessionRef.current;
    flagSessionRef.current = { id: sessionKey, flags: flagKey };
    // Only a change within the same set — not the set being loaded.
    if (!sessionKey || prev.id !== sessionKey || prev.flags === flagKey) return;
    void flushProgress();
  }, [sessionKey, flagKey, flushProgress]);

  useEffect(() => {
    if (!sessionKey) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void flushProgress();
    }, SAVE_HEARTBEAT_MS);
    const onHidden = () => {
      if (document.visibilityState === "hidden") keepaliveSave();
    };
    window.addEventListener("pagehide", keepaliveSave);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("pagehide", keepaliveSave);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [sessionKey, flushProgress, keepaliveSave]);

  // The clock stops while the student waits on a question that has not been
  // written yet, and starts again when it lands.
  const waiting = session ? computeWaitingForNext(session) : false;
  useEffect(() => {
    if (!session) return;
    setSession((prev) => {
      if (!prev) return prev;
      const now = Date.now();
      if (waiting && prev.clockRunning) return pauseClock(prev, now);
      if (!waiting && !prev.clockRunning) return resumeClock(prev, now);
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, sessionKey]);

  const startSession = useCallback(async (config?: SessionConfig): Promise<string> => {
    setReviewIndex(null);
    const mode: PlayMode = config?.mode ?? "tutor";
    const { data, error } = await supabase.rpc("start_qbank_session", {
      p_domains:
        config?.domains && config.domains.length > 0 ? config.domains : null,
      p_limit: config?.limit ?? 40,
      p_system: config?.system ?? null,
      p_question_ids:
        config?.questionIds && config.questionIds.length > 0
          ? config.questionIds
          : null,
      p_mode: mode,
    });
    if (error) throw error;

    const result = data as unknown as { session_id: string; mode?: string; questions: Question[] } | null;
    const questions = (result?.questions ?? []) as Question[];
    const now = Date.now();
    const newSession: SessionState = {
      sessionId: result?.session_id ?? null,
      mode: result?.mode === "timed" ? "timed" : mode,
      selections: {},
      annotations: emptyAnnotations(),
      progressSeq: 0,
      questions,
      currentIndex: 0,
      answers: [],
      startedAt: now,
      questionStartedAt: now,
      accumulatedMs: 0,
      resumedAt: now,
      clockRunning: true,
      skippedIds: [],
      flaggedIds: [],
      // A curated session is whole from the start, so it expects exactly what it
      // was handed. A generated one is told up front what it is still owed.
      expectedTotal: Math.max(questions.length, config?.expectedTotal ?? questions.length),
      generation: config?.generation ?? null,
    };
    progressSeqRef.current = 0;
    sessionIdRef.current = newSession.sessionId;
    setSession(newSession);
    return newSession.sessionId ?? "";
  }, []);

  const submitAnswer = useCallback(
    async (selectedOption: OptionKey) => {
      if (!session || !session.sessionId || session.mode === "timed") return undefined;
      const question = session.questions[session.currentIndex];
      const time_taken_ms = Date.now() - session.questionStartedAt;

      // Grade server-side. The answer key never reaches the client until this
      // returns it for the answered question.
      const { data, error } = await supabase.rpc("submit_answer", {
        p_session: session.sessionId,
        p_question: question.id,
        p_selected: selectedOption,
        p_time_ms: time_taken_ms,
      });
      if (error || !data) {
        console.error("submit_answer failed:", error);
        return undefined;
      }
      const graded = data as unknown as {
        is_correct: boolean;
        correct_option: OptionKey;
        explanation: string;
        teaching_point: string;
        distractor_explanations: Partial<Record<OptionKey, string>> | null;
      };

      const answer: SessionAnswer = {
        question_id: question.id,
        selected_option: selectedOption,
        is_correct: graded.is_correct,
        time_taken_ms,
      };

      // Merged through an updater: waves can land while the request is out, and
      // writing back the render-time session would drop them.
      setSession((prev) => {
        if (!prev || prev.sessionId !== session.sessionId) return prev;
        return {
          ...prev,
          questions: prev.questions.map((q) =>
            q.id === question.id
              ? {
                  ...q,
                  correct_option: graded.correct_option,
                  explanation: graded.explanation,
                  teaching_point: graded.teaching_point,
                  distractor_explanations: graded.distractor_explanations ?? undefined,
                }
              : q
          ),
          answers: prev.answers.some((a) => a.question_id === question.id)
            ? prev.answers
            : [...prev.answers, answer],
          skippedIds: prev.skippedIds.filter((id) => id !== question.id),
        };
      });

      return { is_correct: graded.is_correct, correct_option: graded.correct_option };
    },
    [session]
  );

  const selectTimedAnswer = useCallback(
    (key: OptionKey) => {
      const s = sessionRef.current;
      if (!s?.sessionId || s.mode !== "timed") return;
      const question = s.questions[s.currentIndex];
      if (!question) return;
      const sessionId = s.sessionId;
      const timeMs = Date.now() - s.questionStartedAt;

      setSession((prev) =>
        prev && prev.sessionId === sessionId
          ? {
              ...prev,
              selections: { ...prev.selections, [question.id]: key },
              skippedIds: prev.skippedIds.filter((id) => id !== question.id),
            }
          : prev
      );

      const previous = timedWritesRef.current.get(question.id) ?? Promise.resolve();
      const write = previous.then(async () => {
        const { error } = await supabase.rpc("record_timed_answer", {
          p_session: sessionId,
          p_question: question.id,
          p_selected: key,
          p_time_ms: timeMs,
        });
        if (error) {
          console.error("record_timed_answer failed:", error);
          toast({
            title: "Your answer was not saved",
            description: "Check your connection and choose it again.",
            variant: "destructive",
          });
        }
      });
      timedWritesRef.current.set(question.id, write);
      void write.finally(() => {
        if (timedWritesRef.current.get(question.id) === write) timedWritesRef.current.delete(question.id);
      });
    },
    [toast]
  );

  const goToQuestion = useCallback((index: number) => {
    setReviewIndex(null);
    setSession((prev) => (prev ? moveTo(prev, index, Date.now()) : prev));
  }, []);

  const nextQuestion = useCallback(() => {
    setReviewIndex(null);
    // Clamped by moveTo: a generated set grows underneath the player, and an
    // advance that raced a wave landing must not point past the array.
    setSession((prev) => (prev ? moveTo(prev, prev.currentIndex + 1, Date.now()) : prev));
  }, []);

  const prevQuestion = useCallback(() => {
    setReviewIndex(null);
    setSession((prev) => (prev ? moveTo(prev, prev.currentIndex - 1, Date.now()) : prev));
  }, []);

  // ── On-demand generation ──────────────────────────────────────────────────
  //
  // A generated set is written in waves while the student is already answering
  // it. Two rules keep that honest.
  //
  // One: questions enter the session through claim_generated_questions and
  // nowhere else. The stream announces a question once its row is committed,
  // but that announcement is only a prompt to go and reconcile — the RPC reads
  // the table, so a question written while the tab was closed is picked up on
  // the next claim rather than lost. Nothing here tracks question ids.
  //
  // Two: the session always knows how many questions it is still owed, so a run
  // that ends short reports itself instead of leaving the player waiting for a
  // question that is never coming.

  /**
   * Pulls in every question this generation has written that the session does
   * not already have.
   *
   * Serialised behind a dirty flag rather than run concurrently: claims are
   * triggered per question and can overlap, and while the RPC locks the session
   * row and so cannot double-append, overlapping calls would still queue up
   * round trips for work a single later claim does in one.
   */
  const claimGenerated = useCallback(
    async (sessionId: string, generationId: string) => {
      if (claimRef.current.running) {
        claimRef.current.dirty = true;
        return;
      }
      claimRef.current.running = true;
      try {
        do {
          claimRef.current.dirty = false;
          const { data, error } = await supabase.rpc("claim_generated_questions", {
            p_session: sessionId,
            p_generation_id: generationId,
          });
          if (error) {
            // Non-fatal by design. The questions are in the table either way and
            // the next claim — or the one after the run finishes — collects them.
            console.error("claim_generated_questions failed:", error);
            break;
          }

          const added = ((data as unknown as { added?: Question[] } | null)?.added ??
            []) as Question[];
          if (added.length === 0) continue;

          setSession((prev) => {
            if (!prev || prev.sessionId !== sessionId) return prev;
            const seen = new Set(prev.questions.map((q) => q.id));
            const fresh = added.filter((q) => !seen.has(q.id));
            if (fresh.length === 0) return prev;

            const questions = [...prev.questions, ...fresh];
            return {
              ...prev,
              questions,
              // A set can overshoot slightly when a wave's questions were
              // committed but their frames never arrived, so the loop asked for
              // replacements. Extra questions are a better outcome than
              // pretending they are not there.
              expectedTotal: Math.max(prev.expectedTotal, questions.length),
            };
          });
        } while (claimRef.current.dirty);
      } finally {
        claimRef.current.running = false;
      }
    },
    []
  );

  const stopGeneration = useCallback(() => {
    genAbortRef.current?.abort();
    genAbortRef.current = null;
    genRunningRef.current = false;
  }, []);

  /**
   * Starts a wave loop and wires it to the session.
   *
   * Used for both a fresh set and the resumption of an interrupted one; the only
   * difference is whether a session already exists when the first question of
   * this run lands.
   */
  const beginGeneration = useCallback(
    (cfg: {
      generationId: string;
      topic: string;
      /** Questions this RUN must deliver, which after a resume is the shortfall. */
      remaining: number;
      /** Questions the SET is for, for display. */
      setTarget: number;
      startIndex: number;
      covered: string[];
      system: string | null;
      systemName: string | null;
      challenge: ChallengeLevel;
      examMode: ExamMode;
      createSession?: (questionId: string, meta: SessionGeneration) => Promise<void>;
    }): Promise<GenerationOutcome> => {
      const controller = new AbortController();
      genAbortRef.current = controller;
      genRunningRef.current = true;
      const heldBackBase = heldBackRef.current;
      const heldBackItemsBase = heldBackItemsRef.current;
      // The session this run writes for. A run outliving its session — the
      // student saved and exited, or started another set — must not write its
      // progress onto whatever session is current by then.
      let ownSessionId: string | null = sessionIdRef.current;

      const meta: SessionGeneration = {
        generationId: cfg.generationId,
        topic: cfg.topic,
        system: cfg.system,
        systemName: cfg.systemName,
        target: cfg.setTarget,
        challenge: cfg.challenge,
        examMode: cfg.examMode,
        nextIndex: cfg.startIndex,
        covered: cfg.covered,
      };

      setGeneration({
        status: "running",
        topic: cfg.topic,
        target: cfg.setTarget,
        systemName: cfg.systemName,
        // Carried across a resume: questions held back before a refresh were
        // still written, and forgetting them would misreport the run.
        heldBack: heldBackBase,
        heldBackItems: heldBackItemsBase,
        error: null,
      });

      const run = runQbankGeneration({
        topic: cfg.topic,
        target: cfg.remaining,
        generationId: cfg.generationId,
        signal: controller.signal,
        startIndex: cfg.startIndex,
        alreadyCovered: cfg.covered,
        system: cfg.system,
        challenge: cfg.challenge,
        examMode: cfg.examMode,
        shouldContinue: () => !controller.signal.aborted,
        onMeta: ({ systemName }) => {
          meta.systemName = systemName;
          setGeneration((prev) => (prev ? { ...prev, systemName } : prev));
        },
        onQuestionReady: async (event) => {
          // Withheld questions are not playable: the gate blocked it, the blind
          // second read disagreed with its key, or the insert failed. The loop
          // already counts these as a shortfall and writes another in their
          // place.
          //
          // The test has to be applied here and not only in the claim RPC. The
          // FIRST question does not arrive by claim — it is handed straight to
          // start_qbank_session to open the session — so it would be the one
          // question in the set that skipped the quality filter entirely.
          if (!event.id || event.blocked || event.agreed === false) return;
          if (!ownSessionId) {
            await cfg.createSession?.(event.id, { ...meta });
            ownSessionId = sessionIdRef.current;
          } else {
            await claimGenerated(ownSessionId, cfg.generationId);
          }
        },
        onProgress: (progress) => {
          meta.system = progress.system ?? meta.system;
          meta.systemName = progress.systemName ?? meta.systemName;
          meta.nextIndex = progress.nextIndex;
          meta.covered = progress.covered;
          setGeneration((prev) =>
            prev
              ? {
                  ...prev,
                  systemName: progress.systemName ?? prev.systemName,
                  heldBack: heldBackBase + progress.heldBack,
                  heldBackItems: [...heldBackItemsBase, ...progress.heldBackItems],
                }
              : prev
          );
          // Recorded after every wave; the progress save carries it to the
          // server, so a resume continues at the right index with the
          // duplication guard intact.
          setSession((prev) => {
            if (!prev?.generation || prev.sessionId !== ownSessionId) return prev;
            return { ...prev, generation: { ...meta } };
          });
        },
      });

      return run.then(async (outcome) => {
        // One last reconcile before the set is declared finished. A question can
        // be committed in the moment the connection drops, and this is what
        // stops that question being paid for and never seen.
        if (ownSessionId) {
          await claimGenerated(ownSessionId, cfg.generationId);
        }

        if (genAbortRef.current === controller) {
          genAbortRef.current = null;
          genRunningRef.current = false;
        }

        heldBackRef.current = heldBackBase + outcome.heldBack;
        heldBackItemsRef.current = [...heldBackItemsBase, ...outcome.heldBackItems];
        setGeneration((prev) =>
          prev
            ? {
                ...prev,
                status: outcome.status,
                error: outcome.error,
                heldBack: heldBackRef.current,
                heldBackItems: heldBackItemsRef.current,
                systemName: outcome.systemName ?? prev.systemName,
              }
            : prev
        );

        // Whatever arrived is now the whole set. Without this the player would
        // sit on "writing the next question" forever after a run that ended
        // short, which is the difference between a short session and a stuck one.
        if (outcome.status !== "aborted") {
          setSession((prev) => {
            if (!prev || prev.sessionId !== ownSessionId) return prev;
            return { ...prev, expectedTotal: prev.questions.length };
          });
        }

        return outcome;
      });
    },
    [claimGenerated]
  );

  const startGeneratedSession = useCallback(
    async (
      topic: string,
      target: number,
      challenge: ChallengeLevel = "balanced",
      examMode: ExamMode = "step1",
      mode: PlayMode = "tutor"
    ): Promise<string> => {
      stopGeneration();
      sessionIdRef.current = null;
      heldBackRef.current = 0;
      heldBackItemsRef.current = [];
      setReviewIndex(null);

      const setTarget = Math.min(
        Math.max(MIN_SET_SIZE, Math.round(target) || MIN_SET_SIZE),
        MAX_SET_SIZE
      );
      const generationId = newGenerationId();

      let resolveFirst: ((id: string) => void) | null = null;
      const firstQuestion = new Promise<string>((resolve) => {
        resolveFirst = resolve;
      });

      const done = beginGeneration({
        generationId,
        topic,
        remaining: setTarget,
        setTarget,
        startIndex: 1,
        covered: [],
        system: null,
        systemName: null,
        challenge,
        examMode,
        createSession: async (questionId, meta) => {
          const id = await startSession({
            domains: [],
            limit: 1,
            questionIds: [questionId],
            system: meta.systemName ?? undefined,
            expectedTotal: setTarget,
            generation: meta,
            mode,
          });
          resolveFirst?.(id);
          resolveFirst = null;
        },
      });
      // The race below is the only consumer that can reject; this keeps the run
      // itself from ever surfacing as an unhandled rejection.
      done.catch(() => undefined);

      // Resolves as soon as the set is playable. The remaining waves keep
      // running against the provider, which outlives the page that called this.
      return Promise.race([
        firstQuestion,
        done.then((outcome) => {
          if (!sessionIdRef.current) {
            throw new Error(
              outcome.error ?? "No questions could be generated for that topic."
            );
          }
          return sessionIdRef.current;
        }),
      ]);
    },
    [beginGeneration, startSession, stopGeneration]
  );

  const resumeGeneration = useCallback(() => {
    const current = sessionRef.current;
    if (!current?.sessionId || !current.generation) return;
    if (genRunningRef.current) return;

    const meta = current.generation;
    const sessionId = current.sessionId;
    sessionIdRef.current = sessionId;
    genRunningRef.current = true;

    // Reconcile first, always. The set may already be complete — the questions
    // were written, the tab was closed before the client heard about them — in
    // which case there is nothing left to generate and paying for another wave
    // would be pure waste.
    void claimGenerated(sessionId, meta.generationId).then(() => {
      genRunningRef.current = false;
      const after = sessionRef.current;
      if (!after?.generation || after.sessionId !== sessionId) return;

      const remaining = meta.target - after.questions.length;
      if (remaining <= 0) {
        setSession((prev) =>
          prev && prev.sessionId === sessionId ? { ...prev, expectedTotal: prev.questions.length } : prev
        );
        return;
      }

      void beginGeneration({
        generationId: meta.generationId,
        topic: meta.topic,
        remaining,
        setTarget: meta.target,
        startIndex: meta.nextIndex,
        covered: meta.covered,
        system: meta.system,
        systemName: meta.systemName,
        // A set written before these fields existed resumes at the defaults,
        // which are the mix and the exam it was actually written with.
        challenge: meta.challenge ?? "balanced",
        examMode: meta.examMode ?? "step1",
      }).catch(() => undefined);
    })
      // The flag is claimed up front so two mounts cannot both start resuming.
      // If the claim rejects rather than returning an error, releasing it here
      // is what stops the flag latching on and blocking every later resume.
      .catch(() => {
        genRunningRef.current = false;
      });
  }, [beginGeneration, claimGenerated]);

  // ── Leaving and coming back ───────────────────────────────────────────────

  const resumeSession = useCallback(
    async (sessionId: string, opts?: { explicit?: boolean }): Promise<ResumeAttempt> => {
      if (sessionRef.current?.sessionId === sessionId) return { outcome: "resumed" };
      if (closedIdsRef.current.has(sessionId)) {
        if (!opts?.explicit) return { outcome: "closed" };
        closedIdsRef.current.delete(sessionId);
      }

      let data: unknown = null;
      let errorMessage: string | undefined;
      try {
        const res = await supabase.rpc("resume_qbank_session", { p_session: sessionId });
        data = res.data;
        errorMessage = res.error?.message;
        if (res.error) console.error("resume_qbank_session failed:", res.error);
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
        console.error("resume_qbank_session threw:", err);
      }
      if (errorMessage || !data) {
        if (errorMessage?.includes("session_not_active")) return { outcome: "completed" };
        return { outcome: "failed", error: describeResumeError(errorMessage) };
      }

      // Switching sets: bank the one being left before it is replaced.
      if (sessionRef.current?.sessionId) {
        await Promise.allSettled([...timedWritesRef.current.values()]);
        await flushProgress();
        closedIdsRef.current.add(sessionRef.current.sessionId);
      }
      stopGeneration();
      heldBackRef.current = 0;
      heldBackItemsRef.current = [];
      setGeneration(null);
      setReviewIndex(null);

      const restored = sessionFromResume(data as unknown as ResumeResult, Date.now());
      progressSeqRef.current = restored.progressSeq;
      sessionIdRef.current = restored.sessionId;
      setSession(restored);
      queryClient.invalidateQueries({ queryKey: ["qbank-unfinished"] });
      return { outcome: "resumed" };
    },
    [flushProgress, queryClient, stopGeneration]
  );

  const saveAndExit = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) {
      navigate("/qbank");
      return;
    }
    const stillWriting = genRunningRef.current || s.questions.length < s.expectedTotal;

    // Bank the clock into the ref the save reads, rather than waiting for a
    // render: the save below must carry every second the student spent.
    sessionRef.current = pauseClock(s, Date.now());
    stopGeneration();
    await Promise.allSettled([...timedWritesRef.current.values()]);
    await flushProgress();

    if (s.sessionId) closedIdsRef.current.add(s.sessionId);
    setSession(null);
    setGeneration(null);
    setReviewIndex(null);
    sessionIdRef.current = null;
    queryClient.invalidateQueries({ queryKey: ["qbank-unfinished"] });
    navigate("/qbank");
    toast({
      title: "Saved — resume any time",
      description: stillWriting
        ? "The rest of the set will keep being written when you come back."
        : "Pick it up from Unfinished sets, on any device.",
    });
  }, [flushProgress, navigate, queryClient, stopGeneration, toast]);

  const discardSession = useCallback(
    async (sessionId: string) => {
      closedIdsRef.current.add(sessionId);
      if (sessionRef.current?.sessionId === sessionId) {
        stopGeneration();
        setSession(null);
        setGeneration(null);
        sessionIdRef.current = null;
      }
      // Attempts first, as the history delete does. Flags and timed selections
      // go with the session row (on delete cascade).
      const { error: attemptsError } = await supabase.from("user_attempts").delete().eq("session_id", sessionId);
      if (attemptsError) throw attemptsError;
      const { error } = await supabase.from("qbank_sessions").delete().eq("id", sessionId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["qbank-unfinished"] });
      queryClient.invalidateQueries({ queryKey: ["qbank-sessions"] });
    },
    [queryClient, stopGeneration]
  );

  const endSession = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return null;

    // The set stops growing the moment the student finishes with it. claim would
    // refuse a completed session anyway, but stopping here also stops us writing
    // questions nobody is going to sit.
    stopGeneration();
    setLastGeneration(s.generation ?? null);
    setLastMode(s.mode);
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const endedAt = Date.now();
    const sessionId = s.sessionId;
    if (sessionId) closedIdsRef.current.add(sessionId);
    const totalTime = elapsedAt(s, endedAt);

    // A timed choice made a moment ago may still be on its way. Grading must
    // see it. The last snapshot carries flags the summary will read.
    await Promise.allSettled([...timedWritesRef.current.values()]);
    await flushProgress();

    // Answers were recorded as they were given (tutor) or are graded now from
    // the recorded selections (timed). Finalize server-side.
    if (sessionId) {
      try {
        const { error: endError } = await supabase.rpc("end_qbank_session", {
          p_session: sessionId,
        });
        if (endError) console.error("end_qbank_session failed:", endError);
      } catch (err) {
        console.error("Failed to finalize session:", err);
      }
      queryClient.invalidateQueries({ queryKey: ["qbank-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["qbank-unfinished"] });
    }

    // Tutor mode can summarise from memory. A timed set has no grades on the
    // client at all — the summary reads them from the server.
    const summary: SessionSummary | null =
      s.mode === "tutor"
        ? {
            questions: summaryQuestions(s),
            answers: s.answers,
            totalTime,
            score: s.answers.filter((a) => a.is_correct).length,
            total: s.answers.length,
            flaggedIds: s.flaggedIds,
            omitted: s.questions.length - s.answers.length,
          }
        : null;

    setLastSummary(summary);
    setSession(null);
    setReviewIndex(null);
    sessionIdRef.current = null;

    navigate(sessionId ? `/qbank/summary?session=${sessionId}` : "/qbank/summary");

    return summary;
  }, [flushProgress, navigate, queryClient, stopGeneration]);

  const resetSession = useCallback(() => {
    stopGeneration();
    sessionIdRef.current = null;
    setGeneration(null);
    setSession(null);
  }, [stopGeneration]);

  // ── Flags and marks ───────────────────────────────────────────────────────

  /**
   * Flags or unflags a question.
   *
   * Decided inside the state updater, from the state as it is at that moment —
   * not from the last render, which a second tap can beat. Saving follows from
   * the change (see the flag effect), through the ordered progress snapshot.
   */
  const toggleFlag = useCallback(async (questionId: string) => {
    setSession((prev) => (prev ? { ...prev, flaggedIds: toggleFlagged(prev.flaggedIds, questionId) } : prev));
  }, []);

  const toggleStrike = useCallback((questionId: string, key: OptionKey) => {
    setSession((prev) => {
      if (!prev) return prev;
      const current = prev.annotations.struck[questionId] ?? [];
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      const struck = { ...prev.annotations.struck };
      if (next.length > 0) struck[questionId] = next;
      else delete struck[questionId];
      return { ...prev, annotations: { ...prev.annotations, struck } };
    });
  }, []);

  const addHighlight = useCallback((questionId: string, range: HighlightRange, textLength: number) => {
    setSession((prev) => {
      if (!prev) return prev;
      const merged = mergeHighlight(prev.annotations.highlights[questionId] ?? [], range, textLength);
      return {
        ...prev,
        annotations: {
          ...prev.annotations,
          highlights: { ...prev.annotations.highlights, [questionId]: merged },
        },
      };
    });
  }, []);

  const removeHighlight = useCallback((questionId: string, offset: number) => {
    setSession((prev) => {
      if (!prev) return prev;
      const remaining = removeHighlightAt(prev.annotations.highlights[questionId] ?? [], offset);
      const highlights = { ...prev.annotations.highlights };
      if (remaining.length > 0) highlights[questionId] = remaining;
      else delete highlights[questionId];
      return { ...prev, annotations: { ...prev.annotations, highlights } };
    });
  }, []);

  /** "Skip for now": move on, leaving this question marked as skipped. */
  const skipQuestion = nextQuestion;

  const enterSummaryReview = useCallback((index: number) => {
    setReviewIndex(index);
  }, []);

  const loadSummary = useCallback((data: SessionSummary) => {
    setLastSummary(data);
  }, []);

  const getElapsedMs = useCallback(() => {
    const s = sessionRef.current;
    return s ? elapsedAt(s, Date.now()) : 0;
  }, []);

  const getTimeRemainingMs = useCallback(() => {
    const s = sessionRef.current;
    return s ? computeTimeRemaining(s, Date.now()) : null;
  }, []);

  const unansweredCount = session
    ? session.questions.filter((q) => !hasResponse(session, q.id)).length
    : 0;

  const endBlockStats = useMemo(() => (session ? computeEndBlockStats(session) : null), [session]);

  const currentQuestion = session ? session.questions[session.currentIndex] ?? null : null;

  /**
   * The set is still owed questions. True only while a generated set is being
   * written — it is reconciled to false when the run ends, however it ends, so
   * a failed run leaves a short session rather than a stuck one.
   */
  const isAwaitingMore = session ? session.questions.length < session.expectedTotal : false;

  /**
   * "Last" means nothing further is coming, not merely "last one loaded".
   *
   * A generated set hands over question one while question two is still being
   * written, so the naive reading would offer to end a twenty question session
   * on question one.
   */
  const isLastQuestion = session
    ? session.currentIndex === session.questions.length - 1 && !isAwaitingMore
    : false;

  // What the set will end with, so the counter reads "Q1 of 20" from the start
  // rather than climbing "of 1", "of 2" as questions land.
  const plannedTotal = session ? computePlannedTotal(session) : 0;
  const progress = session && plannedTotal > 0 ? session.currentIndex / plannedTotal : 0;

  // Review is the read-only walk through a finished set from its summary. In a
  // live set every question is simply navigated to.
  const isReviewing = reviewIndex !== null;

  const displayQuestion: Question | null = isReviewing
    ? lastSummary?.questions[reviewIndex!] ?? null
    : currentQuestion;

  const displayAnswer: SessionAnswer | null = isReviewing
    ? lastSummary?.answers.find((a) => a.question_id === lastSummary?.questions[reviewIndex!]?.id) ?? null
    : null;

  return (
    <QBankContext.Provider
      value={{
        session,
        currentQuestion,
        currentIndex: session?.currentIndex ?? 0,
        totalQuestions: plannedTotal,
        isLastQuestion,
        isAwaitingMore,
        isWaitingForNext: waiting,
        generation,
        lastGeneration,
        lastMode,
        progress,
        startGeneratedSession,
        stopGeneration,
        resumeGeneration,
        resumeSession,
        saveAndExit,
        discardSession,
        submitAnswer,
        selectTimedAnswer,
        nextQuestion,
        prevQuestion,
        endSession,
        resetSession,
        lastSummary,
        reviewIndex,
        setReviewIndex,
        enterSummaryReview,
        displayQuestion,
        displayAnswer,
        isReviewing,
        loadSummary,
        getElapsedMs,
        getTimeRemainingMs,
        flaggedIds,
        toggleFlag,
        isFlagLoading,
        toggleStrike,
        addHighlight,
        removeHighlight,
        skipQuestion,
        goToQuestion,
        unansweredCount,
        endBlockStats,
        saveState,
      }}
    >
      {children}
    </QBankContext.Provider>
  );
};

export const useQBankContext = () => {
  const ctx = useContext(QBankContext);
  if (!ctx) throw new Error("useQBankContext must be used inside QBankProvider");
  return ctx;
};
