import { createContext, useContext, useState, useCallback, useMemo, useRef, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type {
  Question,
  OptionKey,
  SessionAnswer,
  SessionState,
  SessionGeneration,
  ChallengeLevel,
  ExamMode,
} from "@/lib/qbank-types";
import {
  runQbankGeneration,
  MIN_SET_SIZE,
  MAX_SET_SIZE,
  type GenerationOutcome,
  type GenerationStatus,
  type HeldBackItem,
} from "@/lib/qbank-wave-runner";

const STORAGE_KEY = "sb_qbank_session";

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
}

interface QBankContextValue {
  session: SessionState | null;
  currentQuestion: Question | null;
  currentIndex: number;
  totalQuestions: number;
  isLastQuestion: boolean;
  /** More questions are still expected for this set than have arrived. */
  isAwaitingMore: boolean;
  generation: GenerationState | null;
  /** The generation behind the most recently finished session, if it had one. */
  lastGeneration: SessionGeneration | null;
  progress: number;
  /**
   * Generates a set and starts playing it as soon as the first question exists.
   * Resolves once the session is live, while the rest keeps being written.
   */
  startGeneratedSession: (
    topic: string,
    target: number,
    challenge?: ChallengeLevel,
    examMode?: ExamMode
  ) => Promise<void>;
  /** Cancels an in-flight set. Whatever landed stays playable. */
  stopGeneration: () => void;
  /**
   * Reconciles the session against the table and picks an interrupted set back
   * up. Safe to call repeatedly; a no-op for a curated or finished session.
   */
  resumeGeneration: () => void;
  submitAnswer: (key: OptionKey) => Promise<{ is_correct: boolean; correct_option: OptionKey } | undefined>;
  nextQuestion: () => void;
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
  restoreSession: () => boolean;
  snapshotTimer: () => void;
  elapsedMs: number;
  flaggedIds: Set<string>;
  toggleFlag: (questionId: string) => Promise<void>;
  isFlagLoading: boolean;
  skipQuestion: () => void;
  goToQuestion: (index: number) => void;
  unansweredCount: number;
}

const QBankContext = createContext<QBankContextValue | null>(null);

export const QBankProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionState | null>(null);
  const [lastSummary, setLastSummary] = useState<SessionSummary | null>(null);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [generation, setGeneration] = useState<GenerationState | null>(null);
  /**
   * The generation behind the session that just finished.
   *
   * The session is torn down on finish, and with it the topic and size the set
   * was written to — which is exactly what the summary needs to offer another
   * set on the same topic. Without it "Try Again" silently falls back to a
   * random curated session, which is not what a student who just generated
   * twenty questions on the brachial plexus is asking for.
   */
  const [lastGeneration, setLastGeneration] = useState<SessionGeneration | null>(null);

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

  const flaggedIds: Set<string> = useMemo(
    () => new Set(session?.flaggedIds ?? []),
    [session?.flaggedIds]
  );

  const isFlagLoading = false;

  const saveSessionToStorage = useCallback((s: SessionState) => {
    const firstUnanswered = s.questions.findIndex(
      (q) => !s.answers.some((a) => a.question_id === q.id)
    );
    const persistIndex = firstUnanswered === -1 ? s.currentIndex : firstUnanswered;

    const payload = {
      sessionId: s.sessionId,
      questions: s.questions,
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

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage full or unavailable — fail silently
    }
  }, []);

  const clearSessionStorage = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // fail silently
    }
  }, []);

  const restoreSession = useCallback((): boolean => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;

      const parsed = JSON.parse(raw);

      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      if (!parsed.savedAt || Date.now() - parsed.savedAt > TWENTY_FOUR_HOURS) {
        localStorage.removeItem(STORAGE_KEY);
        return false;
      }

      if (
        typeof parsed.sessionId !== "string" ||
        !Array.isArray(parsed.questions) ||
        parsed.questions.length === 0 ||
        typeof parsed.currentIndex !== "number" ||
        !Array.isArray(parsed.answers) ||
        typeof parsed.startedAt !== "number"
      ) {
        // Missing sessionId => stale pre-server-grading cache; can't resume (the
        // server session it maps to doesn't exist). Discard.
        localStorage.removeItem(STORAGE_KEY);
        return false;
      }

      setReviewIndex(null);
      setSession({
        sessionId: parsed.sessionId,
        questions: parsed.questions,
        currentIndex: parsed.currentIndex,
        answers: parsed.answers,
        startedAt: parsed.startedAt,
        questionStartedAt: Date.now(),
        accumulatedMs: typeof parsed.accumulatedMs === "number" ? parsed.accumulatedMs : 0,
        resumedAt: Date.now(),
        skippedIds: Array.isArray(parsed.skippedIds) ? parsed.skippedIds : [],
        flaggedIds: Array.isArray(parsed.flaggedIds) ? parsed.flaggedIds : [],
        // A cache written before generated sets existed has neither field. It
        // is a complete curated session, so the count it has is the count it
        // expects, and it has no generation to resume.
        expectedTotal:
          typeof parsed.expectedTotal === "number"
            ? Math.max(parsed.expectedTotal, parsed.questions.length)
            : parsed.questions.length,
        generation: parsed.generation ?? null,
      });
      sessionIdRef.current = parsed.sessionId;

      return true;
    } catch {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      return false;
    }
  }, []);

  const startSession = useCallback(async (config?: SessionConfig) => {
    setReviewIndex(null);
    const { data, error } = await supabase.rpc("start_qbank_session", {
      p_domains:
        config?.domains && config.domains.length > 0 ? config.domains : null,
      p_limit: config?.limit ?? 40,
      p_system: config?.system ?? null,
      p_question_ids:
        config?.questionIds && config.questionIds.length > 0
          ? config.questionIds
          : null,
    });
    if (error) throw error;

    const result = data as unknown as { session_id: string; questions: Question[] } | null;
    const questions = (result?.questions ?? []) as Question[];
    const now = Date.now();
    const newSession: SessionState = {
      sessionId: result?.session_id ?? null,
      questions,
      currentIndex: 0,
      answers: [],
      startedAt: now,
      questionStartedAt: now,
      accumulatedMs: 0,
      resumedAt: now,
      skippedIds: [],
      flaggedIds: [],
      // A curated session is whole from the start, so it expects exactly what it
      // was handed. A generated one is told up front what it is still owed.
      expectedTotal: Math.max(questions.length, config?.expectedTotal ?? questions.length),
      generation: config?.generation ?? null,
    };
    sessionIdRef.current = newSession.sessionId;
    setSession(newSession);
    saveSessionToStorage(newSession);
  }, [saveSessionToStorage]);

  const submitAnswer = useCallback(
    async (selectedOption: OptionKey) => {
      if (!session || !session.sessionId) return undefined;
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

      // Merge the graded fields onto the cached question so the explanation
      // panel (which reads displayQuestion.explanation / .correct_option) can
      // render, and so a resumed/reviewed session shows the answered state.
      const updatedQuestions = session.questions.map((q) =>
        q.id === question.id
          ? {
              ...q,
              correct_option: graded.correct_option,
              explanation: graded.explanation,
              teaching_point: graded.teaching_point,
              distractor_explanations: graded.distractor_explanations ?? undefined,
            }
          : q
      );

      const updatedSession: SessionState = {
        ...session,
        questions: updatedQuestions,
        answers: [...session.answers, answer],
      };
      setSession(updatedSession);
      saveSessionToStorage(updatedSession);

      return { is_correct: graded.is_correct, correct_option: graded.correct_option };
    },
    [session, saveSessionToStorage]
  );

  const nextQuestion = useCallback(() => {
    setReviewIndex(null);
    setSession((prev) => {
      if (!prev) return null;
      // Clamped, because the end of the list is no longer a fixed thing. A
      // generated set grows underneath the player, and an advance that raced a
      // wave landing would otherwise leave currentIndex pointing past the array.
      if (prev.currentIndex >= prev.questions.length - 1) return prev;
      return { ...prev, currentIndex: prev.currentIndex + 1, questionStartedAt: Date.now() };
    });
    if (session) {
      // Same clamp as above. This writes from the render-time session rather
      // than the updater's, so without it a storage snapshot could name an
      // index the question list does not have.
      const nextIndex = Math.min(session.currentIndex + 1, session.questions.length - 1);
      saveSessionToStorage({
        ...session,
        currentIndex: nextIndex,
        questionStartedAt: Date.now(),
      });
    }
  }, [session, saveSessionToStorage]);

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
            if (!prev) return prev;
            const seen = new Set(prev.questions.map((q) => q.id));
            const fresh = added.filter((q) => !seen.has(q.id));
            if (fresh.length === 0) return prev;

            const questions = [...prev.questions, ...fresh];
            const next: SessionState = {
              ...prev,
              questions,
              // A set can overshoot slightly when a wave's questions were
              // committed but their frames never arrived, so the loop asked for
              // replacements. Extra questions are a better outcome than
              // pretending they are not there.
              expectedTotal: Math.max(prev.expectedTotal, questions.length),
            };
            saveSessionToStorage(next);
            return next;
          });
        } while (claimRef.current.dirty);
      } finally {
        claimRef.current.running = false;
      }
    },
    [saveSessionToStorage]
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
          if (!sessionIdRef.current) await cfg.createSession?.(event.id, { ...meta });
          else await claimGenerated(sessionIdRef.current, cfg.generationId);
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
          // Persisted after every wave, so a refresh resumes at the right index
          // with the duplication guard intact.
          setSession((prev) => {
            if (!prev?.generation) return prev;
            const next: SessionState = { ...prev, generation: { ...meta } };
            saveSessionToStorage(next);
            return next;
          });
        },
      });

      return run.then(async (outcome) => {
        // One last reconcile before the set is declared finished. A question can
        // be committed in the moment the connection drops, and this is what
        // stops that question being paid for and never seen.
        if (sessionIdRef.current) {
          await claimGenerated(sessionIdRef.current, cfg.generationId);
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
            if (!prev) return prev;
            const next: SessionState = { ...prev, expectedTotal: prev.questions.length };
            saveSessionToStorage(next);
            return next;
          });
        }

        return outcome;
      });
    },
    [claimGenerated, saveSessionToStorage]
  );

  const startGeneratedSession = useCallback(
    async (
      topic: string,
      target: number,
      challenge: ChallengeLevel = "balanced",
      examMode: ExamMode = "step1"
    ) => {
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

      let resolveFirst: (() => void) | null = null;
      const firstQuestion = new Promise<void>((resolve) => {
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
          await startSession({
            domains: [],
            limit: 1,
            questionIds: [questionId],
            system: meta.systemName ?? undefined,
            expectedTotal: setTarget,
            generation: meta,
          });
          resolveFirst?.();
          resolveFirst = null;
        },
      });
      // The race below is the only consumer that can reject; this keeps the run
      // itself from ever surfacing as an unhandled rejection.
      done.catch(() => undefined);

      // Resolves as soon as the set is playable. The remaining waves keep
      // running against the provider, which outlives the page that called this.
      await Promise.race([
        firstQuestion,
        done.then((outcome) => {
          if (!sessionIdRef.current) {
            throw new Error(
              outcome.error ?? "No questions could be generated for that topic."
            );
          }
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
    sessionIdRef.current = current.sessionId;
    genRunningRef.current = true;

    // Reconcile first, always. The set may already be complete — the questions
    // were written, the tab was closed before the client heard about them — in
    // which case there is nothing left to generate and paying for another wave
    // would be pure waste.
    void claimGenerated(current.sessionId, meta.generationId).then(() => {
      genRunningRef.current = false;
      const after = sessionRef.current;
      if (!after?.generation) return;

      const remaining = meta.target - after.questions.length;
      if (remaining <= 0) {
        setSession((prev) => {
          if (!prev) return prev;
          const next: SessionState = { ...prev, expectedTotal: prev.questions.length };
          saveSessionToStorage(next);
          return next;
        });
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
  }, [beginGeneration, claimGenerated, saveSessionToStorage]);

  const endSession = useCallback(async () => {
    if (!session) return null;

    // The set stops growing the moment the student finishes with it. claim would
    // refuse a completed session anyway, but stopping here also stops us writing
    // questions nobody is going to sit.
    stopGeneration();
    setLastGeneration(session.generation ?? null);

    const endedAt = Date.now();
    const score = session.answers.filter((a) => a.is_correct).length;
    const total = session.answers.length;
    const totalTime = session.accumulatedMs + (endedAt - session.resumedAt);

    const sessionId = session.sessionId;

    // Attempts were already recorded per-answer by submit_answer. Finalize the
    // session server-side (status + real score/total/time) and record flags.
    if (sessionId) {
      try {
        const { error: endError } = await supabase.rpc("end_qbank_session", {
          p_session: sessionId,
        });
        if (endError) {
          console.error("end_qbank_session failed:", endError);
        } else {
          queryClient.invalidateQueries({ queryKey: ["qbank-sessions"] });

          if (session.flaggedIds.length > 0 && user?.id) {
            const flagRows = session.flaggedIds.map((questionId) => ({
              user_id: user.id,
              question_id: questionId,
              session_id: sessionId,
            }));
            await supabase.from("flagged_questions").insert(flagRows);
          }
        }
      } catch (err) {
        console.error("Failed to finalize session:", err);
      }
    }

    const summary: SessionSummary = {
      questions: session.questions.slice(0, total),
      answers: session.answers,
      totalTime,
      score,
      total,
      flaggedIds: session.flaggedIds,
    };

    setLastSummary(summary);
    clearSessionStorage();
    setSession(null);
    setReviewIndex(null);

    if (sessionId) {
      navigate(`/qbank/summary?session=${sessionId}`);
    } else {
      navigate("/qbank/summary");
    }

    return summary;
  }, [session, user, navigate, clearSessionStorage, queryClient, stopGeneration]);

  const resetSession = useCallback(() => {
    stopGeneration();
    clearSessionStorage();
    sessionIdRef.current = null;
    setGeneration(null);
    setSession(null);
  }, [clearSessionStorage, stopGeneration]);

  const toggleFlag = useCallback(async (questionId: string) => {
    setSession((prev) => {
      if (!prev) return prev;
      const alreadyFlagged = prev.flaggedIds.includes(questionId);
      const updated: SessionState = {
        ...prev,
        flaggedIds: alreadyFlagged
          ? prev.flaggedIds.filter((id) => id !== questionId)
          : [...prev.flaggedIds, questionId],
      };

      const firstUnanswered = updated.questions.findIndex(
        (q) => !updated.answers.some((a) => a.question_id === q.id)
      );
      const persistIndex = firstUnanswered === -1 ? updated.currentIndex : firstUnanswered;

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          sessionId: updated.sessionId,
          questions: updated.questions,
          currentIndex: persistIndex,
          answers: updated.answers,
          startedAt: updated.startedAt,
          accumulatedMs: updated.accumulatedMs + (Date.now() - updated.resumedAt),
          skippedIds: updated.skippedIds,
          flaggedIds: updated.flaggedIds,
          savedAt: Date.now(),
        }));
      } catch { /* fail silently */ }

      return updated;
    });
  }, []);

  const skipQuestion = useCallback(() => {
    setSession((prev) => {
      if (!prev) return prev;
      const currentQ = prev.questions[prev.currentIndex];
      if (!currentQ) return prev;
      if (prev.currentIndex >= prev.questions.length - 1) return prev;

      const updated: SessionState = {
        ...prev,
        currentIndex: prev.currentIndex + 1,
        questionStartedAt: Date.now(),
        skippedIds: prev.skippedIds.includes(currentQ.id)
          ? prev.skippedIds
          : [...prev.skippedIds, currentQ.id],
      };

      saveSessionToStorage(updated);
      return updated;
    });
  }, [saveSessionToStorage]);

  const goToQuestion = useCallback((index: number) => {
    setReviewIndex(null);
    setSession((prev) => {
      if (!prev) return prev;
      if (index < 0 || index >= prev.questions.length) return prev;
      if (index === prev.currentIndex) return prev;

      const updated: SessionState = {
        ...prev,
        currentIndex: index,
        questionStartedAt: Date.now(),
      };

      saveSessionToStorage(updated);
      return updated;
    });
  }, [saveSessionToStorage]);

  const snapshotTimer = useCallback(() => {
    setSession((prev) => {
      if (!prev) return prev;
      const now = Date.now();
      const banked = prev.accumulatedMs + (now - prev.resumedAt);
      const updated: SessionState = {
        ...prev,
        accumulatedMs: banked,
        resumedAt: now,
      };

      const firstUnanswered = updated.questions.findIndex(
        (q) => !updated.answers.some((a) => a.question_id === q.id)
      );
      const persistIndex = firstUnanswered === -1 ? updated.currentIndex : firstUnanswered;

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          sessionId: updated.sessionId,
          questions: updated.questions,
          currentIndex: persistIndex,
          answers: updated.answers,
          startedAt: updated.startedAt,
          accumulatedMs: banked,
          skippedIds: updated.skippedIds,
          flaggedIds: updated.flaggedIds,
          savedAt: now,
        }));
      } catch { /* fail silently */ }

      return updated;
    });
  }, []);

  const enterSummaryReview = useCallback((index: number) => {
    setReviewIndex(index);
  }, []);

  const loadSummary = useCallback((data: SessionSummary) => {
    setLastSummary(data);
  }, []);

  const elapsedMs = session ? session.accumulatedMs + (Date.now() - session.resumedAt) : 0;

  const unansweredCount = session
    ? session.questions.filter(
        (q) => !session.answers.find((a) => a.question_id === q.id)
      ).length
    : 0;

  const currentQuestion = session ? session.questions[session.currentIndex] : null;

  /**
   * The set is still owed questions. True only while a generated set is being
   * written — it is reconciled to false when the run ends, however it ends, so
   * a failed run leaves a short session rather than a stuck one.
   */
  const isAwaitingMore = session ? session.questions.length < session.expectedTotal : false;

  /**
   * "Last" means nothing further is coming, not merely "last one loaded".
   *
   * The player hangs Finish, the unanswered-questions warning and the hiding of
   * Next off this. A generated set hands over question one while question two is
   * still being written, so the naive reading would offer to end a twenty
   * question session on question one.
   */
  const isLastQuestion = session
    ? session.currentIndex === session.questions.length - 1 && !isAwaitingMore
    : false;

  // What the set will end with, so the counter reads "Q1 of 20" from the start
  // rather than climbing "of 1", "of 2" as questions land.
  const plannedTotal = session
    ? Math.max(session.questions.length, session.expectedTotal)
    : 0;
  const progress = session && plannedTotal > 0 ? session.currentIndex / plannedTotal : 0;

  const isReviewing = reviewIndex !== null;

  const displayQuestion: Question | null = isReviewing
    ? (
        session?.questions[reviewIndex!] ??
        lastSummary?.questions[reviewIndex!] ??
        null
      )
    : currentQuestion;

  const displayAnswer: SessionAnswer | null = isReviewing
    ? (
        session?.answers.find(
          (a) => a.question_id === session?.questions[reviewIndex!]?.id
        ) ??
        lastSummary?.answers.find(
          (a) => a.question_id === lastSummary?.questions[reviewIndex!]?.id
        ) ??
        null
      )
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
        generation,
        lastGeneration,
        progress,
        startGeneratedSession,
        stopGeneration,
        resumeGeneration,
        submitAnswer,
        nextQuestion,
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
        restoreSession,
        snapshotTimer,
        elapsedMs,
        flaggedIds,
        toggleFlag,
        isFlagLoading,
        skipQuestion,
        goToQuestion,
        unansweredCount,
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
