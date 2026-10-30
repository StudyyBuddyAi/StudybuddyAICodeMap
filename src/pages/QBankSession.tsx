import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, ListChecks, Loader2, RotateCcw } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import PageLoader from "@/components/PageLoader";
import AnswerList from "@/components/qbank/AnswerList";
import AnswerReview from "@/components/qbank/AnswerReview";
import BlockClock from "@/components/qbank/BlockClock";
import BlockReviewDialog from "@/components/qbank/BlockReviewDialog";
import { BottomBar, SaveExitButton, ToolsSheet, TopBar, type ExamTools } from "@/components/qbank/ExamBars";
import FloatingCalculator from "@/components/qbank/FloatingCalculator";
import GoProModal from "@/components/GoProModal";
import HighlightableText from "@/components/qbank/HighlightableText";
import { ItemRail, ItemSheet } from "@/components/qbank/ItemNavigator";
import LabValuesSheet from "@/components/qbank/LabValuesSheet";
import NotesPanel from "@/components/qbank/NotesPanel";
import { ImageViewer, MediaBlock } from "@/components/qbank/QuestionMedia";
import SettingsPanel from "@/components/qbank/SettingsPanel";
import ShortcutsDialog from "@/components/qbank/ShortcutsDialog";
import "@/components/qbank/exam.css";
import { useQBankContext, type GenerationState } from "@/contexts/QBankContext";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useQBankPrefs } from "@/hooks/use-qbank-prefs";
import Clipboard from "@/components/qbank/Clipboard";
import { useToast } from "@/hooks/use-toast";
import { OPTION_KEYS, isGradedState, verdictSentence, type AnswerState } from "@/lib/qbank-answer";
import { liveItemCells, reviewItemCells } from "@/lib/qbank-item-status";
import { ruleLabel } from "@/lib/qbank-rule-labels";
import type { OptionKey, PlayMode, QuestionMedia } from "@/lib/qbank-types";
import { PLAY_MODE_LABELS } from "@/lib/qbank-types";
import { useBackdropScene } from "@/components/backdrop/backdrop-scene";
import { pulseBrandMark } from "@/components/brand/brandmark-motion";

/**
 * Live state of the set being written underneath the session.
 *
 * The generation runs behind the player, which means the only honest way to
 * report it is in the player — otherwise a run that stalls or dies is invisible
 * until the student reaches the end and finds the set shorter than they asked
 * for. Silent once a set has been delivered in full.
 */
const GenerationNotice = ({
  generation,
  loaded,
  onResume,
  onGoPro,
}: {
  generation: GenerationState;
  loaded: number;
  onResume: () => void;
  onGoPro: () => void;
}) => {
  const running = generation.status === "running";
  const short = !running && loaded < generation.target;
  if (!running && !short) return null;

  const fraction = generation.target > 0 ? loaded / generation.target : 0;

  // Grouped by reason rather than listed per question. The held-back items are
  // not in the session, so they have no question number the student could match
  // them to.
  const heldBackByReason = generation.heldBackItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="qb-notice" data-tone={short ? "warn" : undefined} role={short ? "status" : undefined}>
      {running ? <Loader2 className="animate-spin" aria-hidden /> : <AlertTriangle aria-hidden />}
      <div style={{ flex: 1, minWidth: 0 }}>
        {running ? (
          <>
            <strong>Writing your set.</strong> {loaded} of {generation.target} ready; the rest arrive as you go.
          </>
        ) : (
          <>
            <strong>This set stopped at {loaded} of {generation.target} questions.</strong>{" "}
            {/* Always a reason, even when no wave reported an error. */}
            {generation.error ??
              (generation.status === "aborted"
                ? "Writing paused when the set was left."
                : generation.heldBackItems.length > 0
                ? "The replacements for questions that failed our quality checks didn't arrive."
                : "The question writer couldn't finish the rest just now.")}
          </>
        )}
        {running && (
          <div className="qb-meter" aria-hidden>
            <span style={{ transform: `scaleX(${fraction})` }} />
          </div>
        )}
        {/* Why the set is short. The rules name what went wrong without quoting
            the text it went wrong in, which would describe the answer. */}
        {generation.heldBackItems.length > 0 && (
          <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none" }}>
            {Object.entries(heldBackByReason).map(([reason, count]) => (
              <li key={reason}>
                {count} replaced: {ruleLabel(reason).toLowerCase()}
              </li>
            ))}
          </ul>
        )}
        {/* A set the free allowance stopped is not one to retry: the server
            would refuse the remaining questions until tomorrow. */}
        {short && generation.capReached && (
          <button type="button" onClick={onGoPro} className="qb-btn qb-btn--outline" style={{ marginTop: 8 }}>
            Go Pro for unlimited questions
          </button>
        )}
        {short && !generation.capReached && (
          <button type="button" onClick={onResume} className="qb-btn qb-btn--outline" style={{ marginTop: 8 }}>
            <RotateCcw aria-hidden /> Write the remaining {generation.target - loaded}
          </button>
        )}
      </div>
    </div>
  );
};

const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable ||
    !!el.closest?.("[data-qbank-capture-keys]")
  );
};

/** A control that does its own thing with Enter. */
const isActionTarget = (target: EventTarget | null): boolean =>
  !!(target as HTMLElement | null)?.closest?.('button, a[href], [role="radio"], [role="button"], summary');

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ── The player ──────────────────────────────────────────────────────────────

const QBankSession = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    session,
    currentIndex,
    totalQuestions,
    isAwaitingMore,
    isWaitingForNext,
    generation,
    resumeGeneration,
    resumeSession,
    saveAndExit,
    submitAnswer,
    selectTimedAnswer,
    nextQuestion,
    prevQuestion,
    endSession,
    reviewIndex,
    setReviewIndex,
    displayQuestion,
    displayAnswer,
    isReviewing,
    lastSummary,
    getElapsedMs,
    getTimeRemainingMs,
    flaggedIds,
    toggleFlag,
    toggleStrike,
    addHighlight,
    removeHighlight,
    setNote,
    goToQuestion,
    saveState,
  } = useQBankContext();

  // Answering questions: the backdrop all but stops, and the molecule leaves.
  useBackdropScene({ mode: "focus" });

  const [searchParams] = useSearchParams();
  const sessionIdParam = searchParams.get("session");
  const reviewParam = searchParams.get("review");

  const [pendingKey, setPendingKey] = useState<OptionKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [labsOpen, setLabsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [exiting, setExiting] = useState(false);
  /** Why the set could not be loaded from the server, when it could not. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Bumped by Try again, to re-run the load. */
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [viewer, setViewer] = useState<{ items: QuestionMedia[]; index: number }>({ items: [], index: 0 });
  const [goProOpen, setGoProOpen] = useState(false);
  /** What the live region last said: the result of a submitted answer. */
  const [announcement, setAnnouncement] = useState("");
  const prefs = useQBankPrefs();
  /** Room for the side column: the clipboard, then the explanation. */
  const wide = useMediaQuery("(min-width: 900px)");
  const [panelTab, setPanelTab] = useState<"explanation" | "clipboard">("explanation");
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const loadStartedRef = useRef<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const verdictRef = useRef<HTMLHeadingElement>(null);
  /** Set by a submit, so the verdict takes focus once it has rendered. */
  const focusVerdictRef = useRef(false);

  const mode: PlayMode = session?.mode ?? "tutor";
  const inSession = !!session && !isReviewing;

  // ── Loading ───────────────────────────────────────────────────────────────
  //
  // The URL is the source of truth. ?session=<id> with nothing in memory — a
  // refresh, a bookmark, another device — loads the set from the server.
  // ?review=<i> is the read-only walk from a finished set's summary.

  useEffect(() => {
    if (reviewParam !== null) {
      const idx = parseInt(reviewParam, 10);
      if (lastSummary && !isNaN(idx)) setReviewIndex(idx);
      else navigate(sessionIdParam ? `/qbank/summary?session=${sessionIdParam}` : "/qbank", { replace: true });
      return;
    }

    if (session && (!sessionIdParam || sessionIdParam === session.sessionId)) {
      // Put the id in the URL, so a refresh comes back to this set.
      if (session.sessionId && sessionIdParam !== session.sessionId) {
        navigate(`/qbank/session?session=${session.sessionId}`, { replace: true });
      }
      return;
    }

    if (!sessionIdParam) {
      navigate("/qbank", { replace: true });
      return;
    }

    if (loadStartedRef.current === sessionIdParam) return;
    loadStartedRef.current = sessionIdParam;
    setLoadError(null);

    void resumeSession(sessionIdParam).then(({ outcome, error }) => {
      if (outcome === "completed") {
        navigate(`/qbank/summary?session=${sessionIdParam}`, { replace: true });
      } else if (outcome === "failed") {
        setLoadError(error ?? "Something went wrong loading this set.");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.sessionId, sessionIdParam, reviewParam, loadAttempt]);

  /**
   * Picks an interrupted set back up.
   *
   * A generated session can be re-entered with its set unfinished: the tab was
   * closed, the student saved and exited, or they are on another device. This
   * reconciles against the table first and only then writes whatever is still
   * missing. Keyed on the generation's identity rather than the object it hangs
   * off, which is rewritten after every wave.
   */
  useEffect(() => {
    if (!session?.generation) return;
    resumeGeneration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.sessionId, session?.generation?.generationId, resumeGeneration]);

  // A tutor pick is per question; moving on forgets it, and the page starts at
  // the top of the new stem.
  const questionId = displayQuestion?.id ?? null;
  useEffect(() => {
    setPendingKey(null);
    setAnnouncement("");
    setPanelTab("explanation");
    mainRef.current?.scrollTo({ top: 0 });
    panelBodyRef.current?.scrollTo({ top: 0 });
  }, [questionId]);

  // ── Answer state ──────────────────────────────────────────────────────────

  const currentAnswer =
    inSession && displayQuestion ? session!.answers.find((a) => a.question_id === displayQuestion.id) : undefined;
  const timedSelection = inSession && displayQuestion && mode === "timed" ? session!.selections[displayQuestion.id] : undefined;

  const answerState: AnswerState = (() => {
    if (!displayQuestion) return { status: "unanswered" };
    if (isReviewing) {
      if (displayAnswer && displayQuestion.correct_option) {
        return {
          status: "answered",
          selected: displayAnswer.selected_option as OptionKey,
          correct: displayQuestion.correct_option,
          isCorrect: displayAnswer.is_correct,
        };
      }
      return displayQuestion.correct_option
        ? { status: "revealed", correct: displayQuestion.correct_option }
        : { status: "unanswered" };
    }
    if (mode === "timed") return timedSelection ? { status: "selected", pending: timedSelection } : { status: "unanswered" };
    if (currentAnswer && displayQuestion.correct_option) {
      return {
        status: "answered",
        selected: currentAnswer.selected_option,
        correct: displayQuestion.correct_option,
        isCorrect: currentAnswer.is_correct,
      };
    }
    return pendingKey ? { status: "selected", pending: pendingKey } : { status: "unanswered" };
  })();

  const isGraded = isGradedState(answerState);
  const canMark = inSession && !isGraded;

  // After a submit, the verdict takes focus: the button that was pressed is
  // gone, and focus must not fall back to the page.
  // On a wide screen the verdict opens in the side column, so nothing scrolls.
  useEffect(() => {
    if (!isGraded || !focusVerdictRef.current) return;
    const heading = verdictRef.current;
    // Not rendered yet: the side column is still switching to it.
    if (!heading) return;
    focusVerdictRef.current = false;
    heading.focus({ preventScroll: true });
    if (!wide) heading.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [isGraded, panelTab, wide]);

  const handleSelect = useCallback(
    (key: OptionKey) => {
      if (!inSession || isGraded) return;
      if (mode === "timed") selectTimedAnswer(key);
      else setPendingKey(key);
    },
    [inSession, isGraded, mode, selectTimedAnswer]
  );

  const handleConfirm = useCallback(async () => {
    if (mode !== "tutor" || !pendingKey || submitting || isGraded || !displayQuestion) return;
    setSubmitting(true);
    // Before the await: the graded state can render before it returns.
    focusVerdictRef.current = true;
    setPanelTab("explanation");
    try {
      const result = await submitAnswer(pendingKey);
      if (!result) {
        focusVerdictRef.current = false;
        toast({ title: "Could not check that answer", description: "Try again in a moment.", variant: "destructive" });
        return;
      }
      setAnnouncement(verdictSentence(displayQuestion, result.correct_option, pendingKey));
      setPendingKey(null);
      if (result.is_correct) pulseBrandMark();
    } finally {
      setSubmitting(false);
    }
  }, [mode, pendingKey, submitting, isGraded, displayQuestion, submitAnswer, toast]);

  // ── Navigation ────────────────────────────────────────────────────────────

  const loadedCount = isReviewing ? lastSummary?.questions.length ?? 0 : session?.questions.length ?? 0;
  const position = isReviewing ? reviewIndex ?? 0 : currentIndex;
  const canPrev = position > 0;
  const canNext = position < loadedCount - 1;
  const atEndOfWritten = inSession && currentIndex >= (session?.questions.length ?? 0) - 1;
  const doneHere = inSession && (mode === "tutor" ? isGraded : !!timedSelection);

  const handlePrev = useCallback(() => {
    if (isReviewing) {
      if (reviewIndex! > 0) setReviewIndex(reviewIndex! - 1);
    } else prevQuestion();
  }, [isReviewing, reviewIndex, setReviewIndex, prevQuestion]);

  const handleNext = useCallback(() => {
    if (isReviewing) {
      if (reviewIndex! + 1 < loadedCount) setReviewIndex(reviewIndex! + 1);
    } else nextQuestion();
  }, [isReviewing, reviewIndex, loadedCount, setReviewIndex, nextQuestion]);

  const handleGo = useCallback(
    (i: number) => {
      if (isReviewing) setReviewIndex(i);
      else goToQuestion(i);
    },
    [isReviewing, setReviewIndex, goToQuestion]
  );

  const handleEndBlock = useCallback(async () => {
    if (ending) return;
    setEnding(true);
    try {
      await endSession();
    } finally {
      setEnding(false);
      setEndOpen(false);
    }
  }, [ending, endSession]);

  const handleTimeUp = useCallback(() => {
    toast({ title: "Time’s up", description: "Your block has been submitted for grading." });
    void handleEndBlock();
  }, [handleEndBlock, toast]);

  const handleSaveExit = useCallback(async () => {
    if (exiting) return;
    setExiting(true);
    try {
      await saveAndExit();
    } finally {
      setExiting(false);
    }
  }, [exiting, saveAndExit]);

  const backToResults = useCallback(() => {
    setReviewIndex(null);
    navigate(sessionIdParam ? `/qbank/summary?session=${sessionIdParam}` : "/qbank/summary");
  }, [navigate, sessionIdParam, setReviewIndex]);

  // Lab values and the Notes sheet share the right edge; one at a time.
  const toggleLabs = useCallback(() => {
    setNotesOpen(false);
    setLabsOpen((o) => !o);
  }, []);
  // With room for the side column, Notes lives in the clipboard: show it and
  // put the caret in the note. Without, it is a sheet.
  const toggleNotes = useCallback(() => {
    if (wide) {
      setLabsOpen(false);
      setPanelTab("clipboard");
      window.setTimeout(() => notesRef.current?.focus(), 0);
      return;
    }
    setLabsOpen(false);
    setNotesOpen((o) => !o);
  }, [wide]);
  const toggleCalc = useCallback(() => setCalcOpen((o) => !o), []);

  // ── Keyboard ──────────────────────────────────────────────────────────────

  const blocking = viewer.items.length > 0 || endOpen || shortcutsOpen || itemsOpen || toolsOpen;

  useEffect(() => {
    if (blocking) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      // A held key repeats. Every shortcut here is a one-shot action — and for
      // toggles (mark, strike, panels) a repeat flips them back and forth.
      if (e.repeat) return;

      const k = e.key.toLowerCase();
      if (OPTION_KEYS.includes(k as OptionKey)) {
        if (!displayQuestion) return;
        e.preventDefault();
        if (e.shiftKey) {
          if (canMark) toggleStrike(displayQuestion.id, k as OptionKey);
        } else handleSelect(k as OptionKey);
        return;
      }
      if (e.key === "Enter") {
        // A focused button or answer handles its own Enter.
        if (isActionTarget(e.target)) return;
        if (inSession && mode === "tutor" && pendingKey && !isGraded) {
          e.preventDefault();
          void handleConfirm();
        } else if ((doneHere || isReviewing) && canNext) {
          e.preventDefault();
          handleNext();
        } else if (doneHere && atEndOfWritten && !isAwaitingMore) {
          e.preventDefault();
          setEndOpen(true);
        }
      } else if (e.key === "ArrowRight") {
        if (canNext) {
          e.preventDefault();
          handleNext();
        }
      } else if (e.key === "ArrowLeft") {
        if (canPrev) {
          e.preventDefault();
          handlePrev();
        }
      } else if (k === "f" && inSession && displayQuestion) {
        e.preventDefault();
        void toggleFlag(displayQuestion.id);
      } else if (k === "l") {
        e.preventDefault();
        toggleLabs();
      } else if (k === "n") {
        e.preventDefault();
        toggleNotes();
      } else if (k === "k") {
        e.preventDefault();
        toggleCalc();
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    blocking,
    displayQuestion,
    canMark,
    toggleStrike,
    handleSelect,
    pendingKey,
    mode,
    inSession,
    isGraded,
    isReviewing,
    doneHere,
    atEndOfWritten,
    isAwaitingMore,
    handleConfirm,
    canNext,
    canPrev,
    handleNext,
    handlePrev,
    toggleFlag,
    toggleLabs,
    toggleNotes,
    toggleCalc,
  ]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadError && !session) {
    const retry = () => {
      setRetrying(true);
      setLoadError(null);
      loadStartedRef.current = null;
      setLoadAttempt((n) => n + 1);
      // The spinner is only there so a fast second failure is visibly a retry.
      window.setTimeout(() => setRetrying(false), 600);
    };
    return (
      <DashboardLayout wide>
        <div className="qb-exam-portal mx-auto mt-16 max-w-sm space-y-3 text-center">
          <AlertTriangle className="mx-auto h-6 w-6" style={{ color: "var(--qb-warn)" }} />
          <p className="text-[15px] font-medium" style={{ color: "var(--fg)" }}>
            This set couldn’t be loaded.
          </p>
          <p className="text-[14px]" style={{ color: "var(--fg-muted)" }}>
            {loadError}
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button type="button" onClick={retry} disabled={retrying} className="qb-btn qb-btn--primary qb-btn--lg">
              {retrying && <Loader2 className="animate-spin" />}
              Try again
            </button>
            <button type="button" onClick={() => navigate("/qbank")} className="qb-btn qb-btn--outline qb-btn--lg">
              Back to QBank
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!displayQuestion) {
    return (
      <DashboardLayout wide>
        <PageLoader context="qbank" />
      </DashboardLayout>
    );
  }

  const q = displayQuestion;
  const totalForDisplay = isReviewing ? lastSummary?.questions.length ?? 0 : totalQuestions;
  const displayedNumber = position + 1;

  const reviewMarked = new Set(lastSummary?.flaggedIds ?? []);
  const cells = isReviewing
    ? reviewItemCells(
        (lastSummary?.questions ?? []).map((x) => x.id),
        lastSummary?.answers ?? [],
        reviewMarked,
        reviewIndex ?? 0
      )
    : session
      ? liveItemCells(session, totalQuestions, mode, flaggedIds)
      : [];

  const annotations = isReviewing ? lastSummary?.annotations : session?.annotations;
  const struckKeys = (annotations?.struck[q.id] ?? []) as OptionKey[];
  const highlights = annotations?.highlights[q.id] ?? [];
  const note = annotations?.notes?.[q.id] ?? "";
  const isMarked = isReviewing ? reviewMarked.has(q.id) : flaggedIds.has(q.id);
  const showExplanation = isGraded && (isReviewing || mode === "tutor");
  const waitingForWriter = isWaitingForNext || (atEndOfWritten && isAwaitingMore && (doneHere || mode === "timed"));
  const timeTaken = isReviewing ? displayAnswer?.time_taken_ms : currentAnswer?.time_taken_ms;
  const endOfBlockReady = inSession && mode === "tutor" && isGraded && atEndOfWritten && !isAwaitingMore;
  const modeLabel = isReviewing ? "Review" : `${PLAY_MODE_LABELS[mode]} mode`;

  const tools: ExamTools = {
    labsOpen,
    notesOpen: wide ? panelTab === "clipboard" || !showExplanation : notesOpen,
    calcOpen,
    hasNote: note.trim() !== "",
    onLabs: toggleLabs,
    onNotes: toggleNotes,
    onCalc: toggleCalc,
  };
  const settings = <SettingsPanel prefs={prefs} onShortcuts={() => setShortcutsOpen(true)} />;
  const nav = { canPrev, canNext, onPrev: handlePrev, onNext: handleNext, nextReady: doneHere && canNext };

  const clockProps = session && inSession
    ? {
        mode,
        getElapsedMs,
        getTimeRemainingMs,
        paused: !session.clockRunning,
        hidden: prefs.timerHidden,
      }
    : null;

  return (
    <div className="qb-exam" style={{ ["--qb-scale" as string]: prefs.textScale } as React.CSSProperties}>
      <a
        href="#qb-main"
        className="qb-skip"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to the question
      </a>

      <TopBar
        itemNumber={displayedNumber}
        total={totalForDisplay}
        marked={isMarked}
        onMark={inSession ? () => void toggleFlag(q.id) : undefined}
        tools={tools}
        settings={settings}
        onOpenItems={() => setItemsOpen(true)}
        onOpenTools={() => setToolsOpen(true)}
        trailing={
          isReviewing ? (
            <button type="button" className="qb-btn qb-btn--primary" onClick={backToResults}>
              Results
            </button>
          ) : (
            <button type="button" className="qb-btn qb-btn--primary" onClick={() => setEndOpen(true)}>
              End block
            </button>
          )
        }
        {...nav}
      />

      <div className="qb-body" data-panel={wide || undefined}>
        {cells.length > 0 && <ItemRail cells={cells} onSelect={handleGo} legend={isReviewing ? "review" : mode} />}

        <main id="qb-main" ref={mainRef} className="qb-main" tabIndex={-1} aria-label="Question">
          <div className="qb-column">
            {session?.generation && generation && inSession && (
              <GenerationNotice
                generation={generation}
                loaded={session.questions.length}
                onResume={resumeGeneration}
                onGoPro={() => setGoProOpen(true)}
              />
            )}

            <article key={isReviewing ? `review-${reviewIndex}` : `question-${q.id}`} className="question-enter">
              <h1 className="qb-sr">
                Question {displayedNumber} of {totalForDisplay}
              </h1>

              <section className="qb-case" aria-labelledby="qb-case-label">
                <header className="qb-case-head">
                  <h2 id="qb-case-label" className="qb-label">
                    Clinical vignette
                  </h2>
                  {q.subject && <span className="qb-chip qb-chip--accent">{q.subject}</span>}
                </header>
                <div className="qb-case-body">
                  <HighlightableText
                    id="qb-stem"
                    className="qb-stem"
                    text={q.question_text}
                    ranges={highlights}
                    emphasizeLead
                    onAdd={inSession ? (range) => addHighlight(q.id, range, q.question_text.length) : undefined}
                    onRemove={inSession ? (offset) => removeHighlight(q.id, offset) : undefined}
                  />
                </div>
              </section>

              <MediaBlock media={q.media} context="stem" onOpen={(items, index) => setViewer({ items, index })} />

              <div className="qb-divider">
                <span className="qb-label">
                  {mode === "timed" && inSession ? "Choose one · you can change it" : "Select one answer"}
                </span>
              </div>

              <AnswerList
                question={q}
                answerState={answerState}
                struck={struckKeys}
                canMark={canMark}
                canSelect={inSession && !isGraded}
                showRationales={showExplanation}
                labelledBy="qb-stem"
                onSelect={handleSelect}
                onToggleStrike={(key) => toggleStrike(q.id, key)}
                onSubmit={mode === "tutor" && inSession ? () => void handleConfirm() : undefined}
              />

              {inSession && mode === "tutor" && !isGraded && (
                <div className="qb-actions">
                  <button
                    type="button"
                    className="qb-btn qb-btn--primary qb-btn--lg"
                    onClick={() => void handleConfirm()}
                    disabled={!pendingKey || submitting}
                  >
                    {submitting && <Loader2 className="animate-spin" />}
                    {submitting ? "Checking…" : "Submit"}
                  </button>
                  {!pendingKey && <span className="qb-hint">Choose an answer to submit it.</span>}
                </div>
              )}

              {!wide && showExplanation && isGradedState(answerState) && (
                <AnswerReview
                  ref={verdictRef}
                  sessionId={session?.sessionId ?? sessionIdParam}
                  inline
                  question={q}
                  correct={answerState.correct}
                  selected={answerState.status === "answered" ? answerState.selected : null}
                  timeTakenMs={timeTaken}
                  onOpenMedia={(items, index) => setViewer({ items, index })}
                />
              )}

              {waitingForWriter && (
                <div className="qb-notice" role="status" style={{ marginTop: "1.75em", marginBottom: 0 }}>
                  <Loader2 className="animate-spin" aria-hidden />
                  <span>
                    Writing question {(session?.questions.length ?? 0) + 1} of {totalQuestions}. It appears here in a
                    moment{mode === "timed" ? ", and your clock is paused while it does." : "."}
                  </span>
                </div>
              )}

              {endOfBlockReady && (
                <div className="qb-actions" style={{ marginTop: "2em" }}>
                  <button type="button" className="qb-btn qb-btn--primary qb-btn--lg" onClick={() => setEndOpen(true)}>
                    <ListChecks /> Review and end block
                  </button>
                  <span className="qb-hint">That was the last question.</span>
                </div>
              )}
            </article>
          </div>
        </main>

        {wide && (
          <aside className="qb-panel" aria-label={showExplanation ? "Explanation and clipboard" : "Clipboard"}>
            <div className="qb-panel-head">
              {showExplanation ? (
                <div className="qb-segment" role="tablist" aria-label="Side column">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={panelTab === "explanation"}
                    onClick={() => setPanelTab("explanation")}
                  >
                    Explanation
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={panelTab === "clipboard"}
                    onClick={() => setPanelTab("clipboard")}
                  >
                    Clipboard
                  </button>
                </div>
              ) : (
                <h2 className="qb-label">Clipboard</h2>
              )}
            </div>
            <div className="qb-panel-body" ref={panelBodyRef}>
              {showExplanation && panelTab === "explanation" && isGradedState(answerState) ? (
                <AnswerReview
                  ref={verdictRef}
                  sessionId={session?.sessionId ?? sessionIdParam}
                  question={q}
                  correct={answerState.correct}
                  selected={answerState.status === "answered" ? answerState.selected : null}
                  timeTakenMs={timeTaken}
                  onOpenMedia={(items, index) => setViewer({ items, index })}
                />
              ) : (
                <Clipboard
                  ref={notesRef}
                  questionId={q.id}
                  stem={q.question_text}
                  highlights={highlights}
                  note={note}
                  onNoteChange={setNote}
                  onRemoveFinding={inSession ? (offset) => removeHighlight(q.id, offset) : undefined}
                  readOnly={!inSession}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      <BottomBar
        clock={clockProps ? <BlockClock {...clockProps} onTimeUp={handleTimeUp} /> : <span className="qb-clock-label">Read only</span>}
        compactClock={clockProps ? <BlockClock {...clockProps} compact /> : <span className="qb-clock-label">Review</span>}
        modeLabel={modeLabel}
        saveState={inSession ? saveState : undefined}
        actions={
          isReviewing ? (
            <button type="button" className="qb-btn qb-btn--primary" onClick={backToResults}>
              Back to results
            </button>
          ) : (
            <>
              <SaveExitButton saving={exiting} onClick={() => void handleSaveExit()} />
              <button type="button" className="qb-btn qb-btn--primary" onClick={() => setEndOpen(true)}>
                End block
              </button>
            </>
          )
        }
        {...nav}
      />

      <div className="qb-sr" role="status" aria-live="polite">
        {announcement}
      </div>

      {inSession && session && (
        <BlockReviewDialog
          open={endOpen}
          onOpenChange={setEndOpen}
          cells={cells}
          mode={mode}
          notWritten={Math.max(0, totalQuestions - session.questions.length)}
          ending={ending}
          onGo={handleGo}
          onConfirm={() => void handleEndBlock()}
        />
      )}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} mode={mode} />
      <LabValuesSheet open={labsOpen} onOpenChange={setLabsOpen} />
      <NotesPanel
        open={notesOpen && !wide}
        onOpenChange={setNotesOpen}
        questionId={q.id}
        itemNumber={displayedNumber}
        value={note}
        onChange={setNote}
        readOnly={!inSession}
      />
      <FloatingCalculator open={calcOpen} onClose={() => setCalcOpen(false)} />
      <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />
      <ItemSheet
        cells={cells}
        onSelect={handleGo}
        legend={isReviewing ? "review" : mode}
        open={itemsOpen}
        onOpenChange={setItemsOpen}
      />
      <ToolsSheet
        open={toolsOpen}
        onOpenChange={setToolsOpen}
        tools={tools}
        settings={settings}
        footer={
          inSession ? <SaveExitButton saving={exiting} onClick={() => void handleSaveExit()} className="qb-btn--lg" /> : undefined
        }
      />
      <ImageViewer
        items={viewer.items}
        index={viewer.index}
        onIndexChange={(index) => setViewer((v) => ({ ...v, index }))}
        onClose={() => setViewer({ items: [], index: 0 })}
      />
    </div>
  );
};

export default QBankSession;
