import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LogIn,
  History,
  Sparkles,
  AlertTriangle,
  Loader2,
  Check,
  PlayCircle,
  Timer,
  RotateCcw,
  Shuffle,
  CalendarDays,
  SlidersHorizontal,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import AuthModal from "@/components/AuthModal";
import GoProModal from "@/components/GoProModal";
import TopicComposer from "@/components/qbank/TopicComposer";
import SystemBrowser from "@/components/qbank/SystemBrowser";
import SuggestionCards from "@/components/qbank/SuggestionCards";
import ExamSwitch from "@/components/qbank/ExamSwitch";
import DifficultyScale from "@/components/qbank/DifficultyScale";
import WritingOverlay from "@/components/qbank/WritingOverlay";
import { EXAM_THEME } from "@/lib/qbank-exam-theme";
import { useUsageLimit, MAX_DAILY_QBANK_QUESTIONS } from "@/hooks/use-usage-limit";
import { allowedSetSizes, examBlockFor } from "../../supabase/functions/_shared/qbank-allowance.ts";
import { useQBankReviewQueue } from "@/hooks/use-qbank-review-queue";
import { useQBankTarget } from "@/hooks/use-qbank-target";
import { useCurriculumTopics } from "@/hooks/use-curriculum-topics";
import { useLibraryTopics } from "@/hooks/use-library-topics";
import { describeReviewQueue, pickReviewIds } from "@/lib/qbank-review-queue";
import { buildSuggestions, type ExamTarget, type Suggestion } from "@/lib/qbank-suggestions";
import { buildExamBlock } from "@/lib/qbank-exam-block";
import { challengesFor, dailyChallenge } from "@/lib/qbank-challenges";
import type { TopicOption } from "@/lib/topic-suggest";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import { useQBankContext } from "@/contexts/QBankContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { MIN_SET_SIZE, MAX_SET_SIZE, SET_SIZE_STEP } from "@/lib/qbank-wave-runner";
import { formatRelative } from "@/lib/qbank-format";
import { topicRejectionMessage, validateTopic } from "@/lib/validate-topic";
import {
  CHALLENGE_LABELS,
  EXAM_MODE_LABELS,
  PLAY_MODE_LABELS,
  PLAY_MODE_BLURBS,
  type ChallengeLevel,
  type ExamMode,
  type PlayMode,
} from "@/lib/qbank-types";

interface UnfinishedRow {
  id: string;
  mode: string;
  system: string;
  topic: string | null;
  exam_mode: string | null;
  started_at: string;
  last_activity_at: string | null;
  question_count: number;
  expected_total: number;
  answered_count: number;
  flagged_count: number;
  elapsed_ms: number;
}

const MONO_EYEBROW = "font-mono text-[11px] font-medium tracking-widest uppercase";

const SET_SIZES = Array.from(
  { length: Math.floor((MAX_SET_SIZE - MIN_SET_SIZE) / SET_SIZE_STEP) + 1 },
  (_, i) => MIN_SET_SIZE + i * SET_SIZE_STEP
);

/** Topics the student can mix in one set (owner decision, 2026-10-30). */
const MAX_TOPICS = 5;

const PLAY_MODE_ORDER: PlayMode[] = ["tutor", "timed"];


/**
 * The pill classes shared by every option group in the generator card. A
 * near-copy of the sheet configurator's PillGroup at h-8 rather than h-9,
 * kept inline deliberately: extracting a shared primitive would touch the
 * sheet's layout, which does not belong in a change about question content.
 */
const PILL_BASE =
  "inline-flex items-center gap-2 h-8 px-4 rounded-lg text-sm font-medium transition-all duration-200 border disabled:cursor-not-allowed disabled:opacity-50";
const PILL_ON = "bg-primary border-primary text-primary-foreground shadow-md";
const PILL_OFF = "bg-card border-border text-muted-foreground hover:border-primary hover:text-primary";

/**
 * How a set splits across its topics: they take turns by question, so the
 * first ones get the remainder. "4 · 3 · 3" for ten across three.
 */
const splitLabel = (size: number, topicCount: number): string =>
  Array.from({ length: topicCount }, (_, i) => Math.max(0, Math.ceil((size - i) / topicCount))).join(" · ");

/**
 * QBank.
 *
 * Every set is written on demand. A student names one topic or mixes up to
 * five, picks a ready-made set from "For you", or takes a quick start (an exam
 * block weighted like the real exam, a daily five, a surprise) — see
 * docs/qbank/topic-selection-ux.md for why the page is shaped this way.
 *
 * The generation does not run on this page. It runs in QBankProvider, which
 * wraps every /qbank route, so navigating to the session does not cancel it.
 * This page waits only for the FIRST question and then hands over to the
 * player, where the rest of the set arrives while the student works. See
 * src/lib/qbank-wave-runner.ts for the loop.
 *
 * What it deliberately never shows is the questions themselves — a vignette or
 * a key rendered here would hand the student the answers before they sat the
 * set. It reports only its own progress.
 */
const QBank = () => {
  const navigate = useNavigate();
  const { user, isAnonymous } = useAuth();
  const {
    startGeneratedSession,
    startReviewSession,
    generation,
    session,
    resumeSession,
    discardSession,
    stopGeneration,
  } = useQBankContext();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [discardTarget, setDiscardTarget] = useState<UnfinishedRow | null>(null);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  // Signing in happens here, so the topic a sheet handed over is still in the box afterwards.
  const [authOpen, setAuthOpen] = useState(false);
  const [goProOpen, setGoProOpen] = useState(false);

  // The exam the student prepares for — a remembered page setting, not a pill
  // on every set.
  const [target, setTarget] = useQBankTarget();
  const theme = EXAM_THEME[target];

  // The free allowance: ten delivered questions a day (Pro: null, unlimited).
  // The picker never offers a set the server would cut short.
  const { qbankRemaining, isProUser, isLoading: usageLoading } = useUsageLimit();
  const remaining = usageLoading ? null : qbankRemaining;
  const sizes = allowedSetSizes(remaining, SET_SIZES);
  const outOfQuestions = remaining === 0;
  const examBlock = examBlockFor(remaining);
  const fit = useCallback((size: number) => (remaining === null ? size : Math.min(size, remaining)), [remaining]);

  // Missed and marked questions that are due back. Re-sits are free.
  const { queue } = useQBankReviewQueue();
  const reviewIds = pickReviewIds(queue);
  const [startingReview, setStartingReview] = useState(false);

  // What to suggest: the curriculum, the student's own topics, the catalogue.
  const { curriculum, options: curriculumOptions } = useCurriculumTopics();
  const { topics: libraryTopics } = useLibraryTopics();
  const [seed, setSeed] = useState(0);
  const suggestions = useMemo(
    () => buildSuggestions({ topics: libraryTopics, target, curriculum, seed }),
    [libraryTopics, target, curriculum, seed]
  );
  const composerOptions: TopicOption[] = useMemo(
    () => [
      ...libraryTopics.map((t) => ({ title: t.title, systemName: null, systemKey: null, source: "library" as const })),
      ...curriculumOptions,
    ],
    [libraryTopics, curriculumOptions]
  );

  // A sheet hands its topic over (and what the student marked on it), as the
  // Roadmap hands one to Sheets. The student still chooses the set and starts it.
  const location = useLocation();
  const [topics, setTopics] = useState<string[]>(() => {
    const handed = (location.state as { topic?: unknown } | null)?.topic;
    return typeof handed === "string" && handed.trim() ? [handed.trim().slice(0, 300)] : [];
  });
  const [draft, setDraft] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  const [setSize, setSetSize] = useState(MIN_SET_SIZE);
  // Keep the chosen size inside today's allowance as it changes — after a set,
  // or once usage loads.
  useEffect(() => {
    if (sizes.length > 0 && !sizes.includes(setSize)) setSetSize(sizes[sizes.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizes.join(",")]);
  const [challenge, setChallenge] = useState<ChallengeLevel>("balanced");
  const [playMode, setPlayMode] = useState<PlayMode>("tutor");
  const [isStarting, setIsStarting] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startedSize, setStartedSize] = useState(MIN_SET_SIZE);
  const [startedTopics, setStartedTopics] = useState<string[]>([]);
  /** Set by Cancel, so the run's refusal is not reported as a failure. */
  const cancelledRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Elapsed counter, so the wait never looks stalled.
  useEffect(() => {
    if (!isStarting) return;
    const started = Date.now();
    setElapsed(0);
    const id = window.setInterval(
      () => setElapsed(Math.round((Date.now() - started) / 1000)),
      1000
    );
    return () => window.clearInterval(id);
  }, [isStarting]);

  // Every set left unfinished, on any device — the server is the only copy.
  const { data: unfinished } = useQuery({
    queryKey: ["qbank-unfinished", user?.id],
    enabled: !!user && !isAnonymous,
    queryFn: async (): Promise<UnfinishedRow[]> => {
      const { data, error: rpcError } = await supabase.rpc("list_unfinished_sessions");
      if (rpcError) throw rpcError;
      return (data ?? []) as UnfinishedRow[];
    },
  });

  const handleResume = async (id: string) => {
    if (resumingId) return;
    setResumingId(id);
    try {
      const { outcome, error: resumeError } = await resumeSession(id, { explicit: true });
      if (outcome === "resumed") navigate(`/qbank/session?session=${id}`);
      else if (outcome === "completed") navigate(`/qbank/summary?session=${id}`);
      else
        toast({
          title: "Could not resume that set",
          description: "Check your connection and try again.",
          variant: "destructive",
        });
    } finally {
      setResumingId(null);
    }
  };

  const handleDiscard = async () => {
    if (!discardTarget) return;
    setIsDiscarding(true);
    try {
      await discardSession(discardTarget.id);
      setDiscardTarget(null);
    } catch {
      toast({ title: "Failed to discard the set", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsDiscarding(false);
    }
  };

  // A set that is still being written while the student is back on this page —
  // they navigated away rather than finishing. Offer the way back rather than
  // silently starting a second set on top of the first.
  const runInProgress = !!session && generation?.status === "running";

  /**
   * Every way into a set ends here: the composer, a card, a quick start. The
   * size is held inside a free allowance; the exam is the page's target.
   */
  const launch = useCallback(
    async (spec: {
      topics: string[];
      systems?: (string | null)[];
      size: number;
      level: ChallengeLevel;
      mode?: PlayMode;
      id?: string;
    }) => {
      if (isStarting || outOfQuestions || spec.topics.length === 0) return;
      const size = fit(spec.size);
      if (size <= 0) return;

      cancelledRef.current = false;
      setIsStarting(true);
      setStartingId(spec.id ?? null);
      setStartedSize(size);
      setStartedTopics(spec.topics);
      setError(null);
      try {
        // Resolves the moment the first question exists and the session is
        // live. The remaining waves keep running against the provider.
        const id = await startGeneratedSession(
          spec.topics.length === 1 ? spec.topics[0] : spec.topics,
          size,
          spec.level,
          target as ExamMode,
          spec.mode ?? playMode,
          spec.systems ? { systems: spec.systems } : {}
        );
        queryClient.invalidateQueries({ queryKey: ["qbank-unfinished"] });
        navigate(id ? `/qbank/session?session=${id}` : "/qbank/session");
      } catch (err) {
        setIsStarting(false);
        setStartingId(null);
        // A cancelled run ends without a session, which reads as a failure;
        // the student asked for it, so say nothing.
        if (cancelledRef.current) return;
        const message = err instanceof Error ? err.message : "Generation failed";
        setError(message);
        toast({ title: "Could not generate questions", description: message, variant: "destructive" });
      }
    },
    [isStarting, outOfQuestions, fit, startGeneratedSession, target, playMode, queryClient, navigate, toast]
  );

  /** The composer's set: its chips plus anything typed and not yet added. */
  const pendingTopics = useMemo(() => {
    const typed = draft.trim();
    if (!typed || topics.some((t) => t.toLowerCase() === typed.toLowerCase())) return topics;
    return [...topics, typed].slice(0, MAX_TOPICS);
  }, [topics, draft]);

  const generate = useCallback(() => {
    const typed = draft.trim();
    if (typed) {
      const rejection = validateTopic(typed);
      if (rejection) {
        setError(topicRejectionMessage(rejection));
        return;
      }
    }
    void launch({ topics: pendingTopics, size: setSize, level: challenge });
  }, [draft, pendingTopics, setSize, challenge, launch]);

  const startCard = (s: Suggestion) =>
    void launch({ topics: s.topics, systems: s.systems, size: s.size, level: s.level, id: s.id });

  /** An exam block: one topic per question across the systems, by exam weight. */
  const startExamBlock = () => {
    if (!examBlock) return;
    const block = buildExamBlock({ target, size: examBlock.size, curriculum });
    void launch({ topics: block.topics, systems: block.systems, size: examBlock.size, level: "balanced", mode: "timed", id: "exam-block" });
  };

  /** Five questions across what the student studied most recently; today's challenge for a new student. */
  const startDaily = () => {
    const recent = [...libraryTopics]
      .filter((t) => t.sheets.length > 0 || !!t.deck || !!t.qbank)
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .slice(0, MAX_TOPICS)
      .map((t) => t.title);
    if (recent.length > 0) {
      void launch({ topics: recent, size: 5, level: "balanced", id: "daily-5" });
      return;
    }
    const c = dailyChallenge(target);
    void launch({ topics: c.topics.map((x) => x.title), systems: c.topics.map((x) => x.system), size: 5, level: c.level, id: "daily-5" });
  };

  const startSurprise = () => {
    const pool = challengesFor(target);
    const c = pool[Math.floor(Math.random() * pool.length)];
    void launch({ topics: c.topics.map((x) => x.title), systems: c.topics.map((x) => x.system), size: 5, level: c.level, id: "surprise" });
  };

  const startReview = async () => {
    if (startingReview || reviewIds.length === 0) return;
    setStartingReview(true);
    try {
      const id = await startReviewSession(reviewIds, playMode);
      navigate(id ? `/qbank/session?session=${id}` : "/qbank/session");
    } catch (err) {
      toast({
        title: "Could not start the review",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setStartingReview(false);
    }
  };

  const cancelWriting = () => {
    cancelledRef.current = true;
    stopGeneration();
    setIsStarting(false);
    setStartingId(null);
  };

  const mixing = pendingTopics.length >= 2;
  const quickBusy = isStarting || outOfQuestions;

  return (
    <DashboardLayout wide>
      {/* The layout owns the page gutter; no padding of our own on top of it.
          One column: past sets live on the Dashboard, not beside the generator. */}
      <div className="mx-auto w-full max-w-5xl space-y-6 animate-fade-in">
          <PageHeader
            label="QBank · USMLE-style"
            title={
              <>
                Questions on <em className="text-[color:var(--color-accent)]">anything you like.</em>
              </>
            }
            description="Built on NBME item-writing rules. Name a topic — or mix up to five — and a set is written for it; you start on the first question as soon as it is ready, and the rest is written while you work."
          />

          {/* Sign In Card */}
          {isAnonymous || !user ? (
            <div className="space-y-4 rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-6 text-center shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[color:var(--color-foreground)] text-[color:var(--color-accent)] shadow-sm">
                <LogIn className="h-5 w-5" strokeWidth={2.2} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Sign in to generate questions
                </p>
                <p className="text-xs text-muted-foreground">
                  Generated sets are saved to your account so you can sit them and review
                  them later.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-[18px] bg-[color:var(--color-foreground)] text-sm font-semibold text-[color:var(--color-background)] shadow-[0_16px_32px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(15,23,42,0.16)]"
              >
                <LogIn className="w-4 h-4" />
                Sign In to Start
              </button>
            </div>
          ) : (
            <>
              <AlertDialog open={!!discardTarget} onOpenChange={(open) => !open && setDiscardTarget(null)}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Discard this set?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {discardTarget
                        ? `“${discardTarget.topic ?? discardTarget.system}” and its ${discardTarget.answered_count} answer${
                            discardTarget.answered_count === 1 ? "" : "s"
                          } will be deleted. This can’t be undone.`
                        : ""}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDiscarding}>Keep it</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={isDiscarding}
                      onClick={(e) => {
                        e.preventDefault();
                        void handleDiscard();
                      }}
                      className="bg-danger text-white hover:bg-danger/90"
                    >
                      {isDiscarding ? "Discarding…" : "Discard"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {runInProgress && (
                <button
                  type="button"
                  onClick={() =>
                    navigate(session?.sessionId ? `/qbank/session?session=${session.sessionId}` : "/qbank/session")
                  }
                  className="inline-flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm transition-opacity hover:opacity-80"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-foreground)",
                  }}
                >
                  <PlayCircle size={15} />
                  A set is still being written — go back to it
                </button>
              )}

              {/* Review queue — missed questions once they are a day old, marked
                  ones straight away. Shown only when something is waiting. */}
              {(queue.dueCount > 0 || queue.upcoming > 0) && (
                <div className="flex flex-col gap-3 rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className={`${MONO_EYEBROW} text-muted-foreground`}>Review queue</p>
                    {queue.dueCount > 0 ? (
                      <>
                        <p className="mt-1 text-base font-semibold text-foreground">
                          {queue.dueCount} question{queue.dueCount === 1 ? "" : "s"} to retry
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {describeReviewQueue(queue)}
                          {queue.upcoming > 0 ? ` · ${queue.upcoming} more tomorrow` : ""} · free, never counts toward
                          your daily questions
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-foreground">
                        {queue.upcoming} missed question{queue.upcoming === 1 ? " comes" : "s come"} back tomorrow —
                        spaced, so the retry tests what you learned.
                      </p>
                    )}
                  </div>
                  {queue.dueCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void startReview()}
                      disabled={startingReview || isStarting}
                      className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-[14px] bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                    >
                      {startingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      Retry {reviewIds.length} · {PLAY_MODE_LABELS[playMode]}
                    </button>
                  )}
                </div>
              )}

              {/* Composer — one topic, or several mixed; the set's shape folds
                  into one line until the student wants to change it. */}
              <div
                className={`space-y-4 rounded-[26px] border-2 ${theme.border} bg-[color:var(--color-card)] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)] transition-colors`}
              >
                {/* The exam first: it decides what kind of question is written. */}
                <div>
                  <p className={`${MONO_EYEBROW} text-muted-foreground mb-2`}>Studying for</p>
                  <ExamSwitch value={target} onChange={setTarget} disabled={isStarting} />
                </div>

                <div>
                  <p className={`${MONO_EYEBROW} mb-2`}>
                    <span className="text-muted-foreground">What do you want to practise?</span>{" "}
                    <span className={theme.text}>· {theme.label === "Both" ? "Step 1 + Step 2 CK" : theme.label}</span>
                  </p>
                  <TopicComposer
                    topics={topics}
                    onChange={(next) => {
                      setTopics(next);
                      if (error) setError(null);
                    }}
                    draft={draft}
                    onDraftChange={(d) => {
                      setDraft(d);
                      if (error) setError(null);
                    }}
                    options={composerOptions}
                    max={MAX_TOPICS}
                    disabled={isStarting}
                    onSubmit={generate}
                    onBrowse={() => setBrowseOpen(true)}
                    placeholder={theme.placeholder}
                  />
                  {mixing && (
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">
                        Mixed: {setSize} questions across {pendingTopics.length} topics ({splitLabel(setSize, pendingTopics.length)})
                      </span>{" "}
                      — switching between topics is harder, and better for telling them apart.
                    </p>
                  )}
                </div>

                {/* Today's allowance — free accounts only. */}
                {!isProUser && remaining !== null && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {outOfQuestions ? (
                      <span className="font-medium text-warning">
                        You've used today's {MAX_DAILY_QBANK_QUESTIONS} free questions · they reset at midnight UTC ·{" "}
                      </span>
                    ) : (
                      <span>
                        {remaining} of {MAX_DAILY_QBANK_QUESTIONS} free questions left today · retries of missed and
                        marked questions are free ·{" "}
                      </span>
                    )}
                    <button type="button" className="underline hover:text-foreground" onClick={() => setGoProOpen(true)}>
                      Go Pro for unlimited
                    </button>
                  </p>
                )}

                {/* The set in one line, and the button that starts it. */}
                <div className="flex flex-col gap-3 border-t border-[color:var(--color-border)] pt-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1 text-sm text-foreground">
                    <span className="font-medium tabular-nums">{setSize} questions</span>
                    <span className="text-muted-foreground">
                      {" "}· {PLAY_MODE_LABELS[playMode]} · {CHALLENGE_LABELS[challenge]}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowOptions((o) => !o)}
                      aria-expanded={showOptions}
                      aria-controls="qbank-customize"
                      className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" /> {showOptions ? "Done" : "Change"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={generate}
                    disabled={isStarting || pendingTopics.length === 0 || outOfQuestions}
                    className={`flex h-12 shrink-0 items-center justify-center gap-2 rounded-[14px] px-6 text-sm font-semibold shadow-[0_16px_32px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 ${theme.solid}`}
                  >
                    {isStarting && !startingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {isStarting && !startingId
                      ? "Writing…"
                      : `Start ${setSize} ${target === "mixed" ? "mixed-exam" : theme.label} questions`}
                  </button>
                </div>

                {showOptions && (
                  <div id="qbank-customize" className="grid gap-5 sm:grid-cols-2">
                    {/* Mode — how the set is sat, not what it is written for. */}
                    <div>
                      <p className={`${MONO_EYEBROW} text-muted-foreground mb-2`}>Mode</p>
                      <div className="flex flex-wrap gap-2">
                        {PLAY_MODE_ORDER.map((m) => {
                          const active = m === playMode;
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setPlayMode(m)}
                              disabled={isStarting}
                              aria-pressed={active}
                              className={`${PILL_BASE} ${active ? PILL_ON : PILL_OFF}`}
                            >
                              {active && <Check className="w-4 h-4" />}
                              {PLAY_MODE_LABELS[m]}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">{PLAY_MODE_BLURBS[playMode]}</p>
                    </div>

                    {/* How many */}
                    <div>
                      <p className={`${MONO_EYEBROW} text-muted-foreground mb-2`}>Questions</p>
                      <div className="flex flex-wrap gap-2">
                        {(sizes.length > 0 ? sizes : SET_SIZES).map((size) => {
                          const active = size === setSize;
                          return (
                            <button
                              key={size}
                              type="button"
                              onClick={() => setSetSize(size)}
                              disabled={isStarting || outOfQuestions}
                              aria-pressed={active}
                              className={`${PILL_BASE} tabular-nums ${active ? PILL_ON : PILL_OFF}`}
                            >
                              {active && <Check className="w-4 h-4" />}
                              {size}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        You start after the first one is written; the rest arrive while you answer.
                      </p>
                    </div>

                    {/* Difficulty — a reasoning-order dial underneath, not a
                        difficulty one. Reasoning order is what the batch plan
                        actually controls; the wire parameter stays `challenge`.
                        Full width, so the three steps sit on one row in order. */}
                    <div className="sm:col-span-2">
                      <p className={`${MONO_EYEBROW} text-muted-foreground mb-2`}>Difficulty</p>
                      <DifficultyScale value={challenge} onChange={setChallenge} disabled={isStarting} />
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-3.5 py-3 text-sm text-danger">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* For you — personal first, then challenges for this exam. */}
              <SuggestionCards
                suggestions={suggestions}
                onStart={startCard}
                onShuffle={() => setSeed((s) => s + 1)}
                startingId={startingId}
                disabled={quickBusy}
                sizeFor={(s) => fit(s.size)}
                badge={{ label: theme.label === "Both" ? "Step 1 + 2 CK" : theme.label, className: theme.badge }}
              />

              {/* Quick starts — no topic needed. */}
              <section aria-labelledby="qb-quick" className="space-y-2.5">
                <h2 id="qb-quick" className={`${MONO_EYEBROW} text-muted-foreground`}>
                  Quick start
                </h2>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  {examBlock && (
                    <QuickStart
                      icon={Timer}
                      title={`${remaining === null ? "Exam block" : "Half exam block"} · ${examBlock.size} Q`}
                      detail={`Timed, ${Number.isInteger(examBlock.minutes) ? examBlock.minutes : examBlock.minutes.toFixed(1)} min — mixed across systems like the real exam`}
                      busy={startingId === "exam-block"}
                      disabled={quickBusy || curriculum.length === 0}
                      onClick={startExamBlock}
                    />
                  )}
                  <QuickStart
                    icon={CalendarDays}
                    title={`Daily ${fit(5)}`}
                    detail="A quick mix of what you studied most recently"
                    busy={startingId === "daily-5"}
                    disabled={quickBusy}
                    onClick={startDaily}
                  />
                  <QuickStart
                    icon={Shuffle}
                    title="Surprise me"
                    detail={`A random challenge for ${target === "mixed" ? "Step 1 and Step 2 CK" : theme.label}`}
                    busy={startingId === "surprise"}
                    disabled={quickBusy}
                    onClick={startSurprise}
                  />
                </div>
              </section>

              {/* Unfinished sets — every set left open, on any device. One
                  compact row each: what it is, how far along, resume. */}
              {unfinished && unfinished.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <History className="w-3.5 h-3.5 text-muted-foreground" />
                    <p className={`${MONO_EYEBROW} text-muted-foreground`}>
                      Pick up where you left off ({unfinished.length})
                    </p>
                  </div>
                  {unfinished.map((u) => {
                    const total = Math.max(u.expected_total, u.question_count);
                    const pct = total > 0 ? Math.round((u.answered_count / total) * 100) : 0;
                    const timed = u.mode === "timed";
                    return (
                      <div
                        key={u.id}
                        className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-4 py-3.5"
                      >
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {u.topic ?? u.system}
                              </p>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                                  timed ? "bg-warning-soft text-warning" : "bg-info-soft text-info"
                                }`}
                              >
                                {timed ? "Timed" : "Tutor"}
                              </span>
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {u.answered_count} of {total} answered
                              {u.exam_mode && EXAM_MODE_LABELS[u.exam_mode as ExamMode]
                                ? ` · ${EXAM_MODE_LABELS[u.exam_mode as ExamMode]}`
                                : ""}
                              {" · "}
                              {formatRelative(u.last_activity_at)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setDiscardTarget(u)}
                            className="h-9 shrink-0 rounded-full border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary"
                          >
                            Discard
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResume(u.id)}
                            disabled={!!resumingId}
                            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                          >
                            {resumingId === u.id && <Loader2 className="w-4 h-4 animate-spin" />}
                            Resume
                          </button>
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-9 text-end text-xs tabular-nums text-muted-foreground">{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
      </div>
      <WritingOverlay
        open={isStarting}
        target={target}
        generation={generation}
        elapsed={elapsed}
        size={startedSize}
        topics={startedTopics}
        onCancel={cancelWriting}
      />
      <SystemBrowser
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        curriculum={curriculum}
        slots={Math.max(0, MAX_TOPICS - topics.length)}
        onAdd={(added) => {
          setTopics((prev) => {
            const next = [...prev];
            for (const a of added) if (!next.some((t) => t.toLowerCase() === a.toLowerCase())) next.push(a);
            return next.slice(0, MAX_TOPICS);
          });
          if (error) setError(null);
        }}
      />
      <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />
      <AuthModal
        open={authOpen}
        onOpenChange={setAuthOpen}
        reason="Sign in to generate QBank sets. Your sets are saved so you can resume them."
      />
    </DashboardLayout>
  );
};

const QuickStart = ({
  icon: Icon,
  title,
  detail,
  busy,
  disabled,
  onClick,
}: {
  icon: typeof Timer;
  title: string;
  detail: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="flex items-start gap-3 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
  >
    {busy ? (
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
    ) : (
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
    )}
    <span className="min-w-0">
      <span className="block text-sm font-semibold text-foreground">{title}</span>
      <span className="block text-xs leading-relaxed text-muted-foreground">{detail}</span>
    </span>
  </button>
);

export default QBank;
