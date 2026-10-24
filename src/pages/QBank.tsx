import { useState, useEffect, useCallback } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LogIn,
  History,
  Sparkles,
  AlertTriangle,
  Loader2,
  Check,
  Compass,
  PenLine,
  PlayCircle,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import AuthModal from "@/components/AuthModal";
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
  CHALLENGE_BLURBS,
  EXAM_MODE_LABELS,
  EXAM_MODE_BLURBS,
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

const CHALLENGE_ORDER: ChallengeLevel[] = ["foundations", "balanced", "challenge"];

const EXAM_MODE_ORDER: ExamMode[] = ["step1", "step2ck", "mixed"];

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

type StepState = "pending" | "active" | "done";

/**
 * QBank.
 *
 * Every set is written on demand: a student names a topic and a size, and the
 * questions are generated for it against the same NBME item-writing rules the
 * prompt encodes. There is no pre-built pool to browse — the curated bank only
 * ever covered three systems, and its configurator (system, domain, count,
 * flagged-only) used to sit here in front of the generator. It is gone; the
 * `questions` table itself is untouched and still backs every generated row.
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
    generation,
    session,
    resumeSession,
    discardSession,
  } = useQBankContext();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [discardTarget, setDiscardTarget] = useState<UnfinishedRow | null>(null);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  // Signing in happens here, so the topic a sheet handed over is still in the box afterwards.
  const [authOpen, setAuthOpen] = useState(false);

  // A sheet hands its topic over (and what the student marked on it), as the
  // Roadmap hands one to Sheets. The student still chooses the set and starts it.
  const location = useLocation();
  const [topic, setTopic] = useState(() => {
    const handed = (location.state as { topic?: unknown } | null)?.topic;
    return typeof handed === "string" ? handed.slice(0, 300) : "";
  });
  const [setSize, setSetSize] = useState(MIN_SET_SIZE);
  const [challenge, setChallenge] = useState<ChallengeLevel>("balanced");
  const [examMode, setExamMode] = useState<ExamMode>("step1");
  const [playMode, setPlayMode] = useState<PlayMode>("tutor");
  const [isStarting, setIsStarting] = useState(false);
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

  const generate = useCallback(async () => {
    const trimmed = topic.trim();
    if (!trimmed || isStarting) return;
    const rejection = validateTopic(trimmed);
    if (rejection) {
      setError(topicRejectionMessage(rejection));
      return;
    }

    setIsStarting(true);
    setError(null);

    try {
      // Resolves the moment the first question exists and the session is live.
      // The remaining waves keep running against the provider.
      const id = await startGeneratedSession(trimmed, setSize, challenge, examMode, playMode);
      queryClient.invalidateQueries({ queryKey: ["qbank-unfinished"] });
      navigate(id ? `/qbank/session?session=${id}` : "/qbank/session");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      setError(message);
      toast({
        title: "Could not generate questions",
        description: message,
        variant: "destructive",
      });
      setIsStarting(false);
    }
  }, [topic, setSize, challenge, examMode, playMode, isStarting, startGeneratedSession, navigate, toast, queryClient]);


  const routed = !!generation?.systemName;
  const estimatedMinutes = Math.max(1, Math.round((setSize * 18) / 60));

  return (
    <DashboardLayout wide>
      {/* The layout owns the page gutter; no padding of our own on top of it.
          One column: past sets live on the Dashboard, not beside the generator. */}
      <div className="mx-auto w-full max-w-3xl space-y-6 animate-fade-in">
          <PageHeader
            label="QBank"
            title="Practice questions"
            description="USMLE-style questions on any topic. The first one is ready in seconds."
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

              {/* Generator Card — the topic and the button that starts the set
                  come first; every option sits open beneath them. */}
              <div className="space-y-5 rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
                {/* Topic */}
                <div>
                  <label htmlFor="qbank-topic" className={`${MONO_EYEBROW} text-muted-foreground mb-2 block`}>
                    Topic
                  </label>
                  <div className="flex flex-col gap-2.5 sm:flex-row">
                    <input
                      id="qbank-topic"
                      value={topic}
                      onChange={(e) => {
                        setTopic(e.target.value);
                        if (error) setError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") generate();
                      }}
                      disabled={isStarting}
                      placeholder="aortic dissection, nephrotic syndrome, the brachial plexus…"
                      className="h-12 flex-1 rounded-[14px] border px-3.5 text-sm outline-none transition-colors focus:border-[var(--color-accent)] disabled:opacity-60"
                      style={{
                        borderColor: "var(--color-border)",
                        background: "var(--color-background)",
                        color: "var(--color-foreground)",
                      }}
                    />
                    <button
                      type="button"
                      onClick={generate}
                      disabled={isStarting || !topic.trim()}
                      className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-[14px] bg-[color:var(--color-foreground)] px-6 text-sm font-semibold text-[color:var(--color-background)] shadow-[0_16px_32px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
                    >
                      {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      {isStarting ? "Writing…" : `Generate ${setSize} questions`}
                    </button>
                  </div>
                </div>

                {/* Options — always shown, so the student sees what the set will be. */}
                <div className="border-t border-[color:var(--color-border)] pt-4">
                  <p className={`${MONO_EYEBROW} text-foreground`}>Customize your set</p>
                    <div id="qbank-customize" className="mt-4 grid gap-5 sm:grid-cols-2">
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

                      {/* Exam mode — selects the system prompt and briefs the
                          set is written against. */}
                      <div>
                        <p className={`${MONO_EYEBROW} text-muted-foreground mb-2`}>Exam Mode</p>
                        <div className="flex flex-wrap gap-2">
                          {EXAM_MODE_ORDER.map((mode) => {
                            const active = mode === examMode;
                            return (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => setExamMode(mode)}
                                disabled={isStarting}
                                aria-pressed={active}
                                className={`${PILL_BASE} ${active ? PILL_ON : PILL_OFF}`}
                              >
                                {active && <Check className="w-4 h-4" />}
                                {EXAM_MODE_LABELS[mode]}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {EXAM_MODE_BLURBS[examMode]}
                        </p>
                      </div>

                      {/* How many */}
                      <div>
                        <p className={`${MONO_EYEBROW} text-muted-foreground mb-2`}>Questions</p>
                        <div className="flex flex-wrap gap-2">
                          {SET_SIZES.map((size) => {
                            const active = size === setSize;
                            return (
                              <button
                                key={size}
                                type="button"
                                onClick={() => setSetSize(size)}
                                disabled={isStarting}
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
                          A question takes about twenty seconds to write, so a set of {setSize}{" "}
                          finishes in roughly {estimatedMinutes} minute
                          {estimatedMinutes === 1 ? "" : "s"} — but you will be answering it
                          long before then.
                        </p>
                      </div>

                      {/* Difficulty — a reasoning-order dial underneath, not a
                          difficulty one. Reasoning order is what the batch plan
                          actually controls; the model labels difficulty
                          downstream of it, and the prompt names the band each
                          level should land in. The wire parameter stays
                          `challenge`. */}
                      <div>
                        <p className={`${MONO_EYEBROW} text-muted-foreground mb-2`}>Difficulty</p>
                        <div className="flex flex-wrap gap-2">
                          {CHALLENGE_ORDER.map((level) => {
                            const active = level === challenge;
                            return (
                              <button
                                key={level}
                                type="button"
                                onClick={() => setChallenge(level)}
                                disabled={isStarting}
                                aria-pressed={active}
                                className={`${PILL_BASE} ${active ? PILL_ON : PILL_OFF}`}
                              >
                                {active && <Check className="w-4 h-4" />}
                                {CHALLENGE_LABELS[level]}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {CHALLENGE_BLURBS[challenge]}
                        </p>
                      </div>
                    </div>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-3.5 py-3 text-sm text-danger">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Console — rendered whenever a run is under way, error or not. It
                  used to be hidden the moment anything went wrong, which took
                  the progress and the way forward down with it. */}
              {isStarting && (
                <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                  <div className="flex items-center justify-between gap-3">
                    <p className={`${MONO_EYEBROW} text-muted-foreground`}>Writing</p>
                    <span className={`${MONO_EYEBROW} text-muted-foreground tabular-nums`}>
                      {elapsed}s
                    </span>
                  </div>

                  <ol className="mt-4 flex flex-col gap-2.5">
                    <Step
                      state={routed ? "done" : "active"}
                      icon={Compass}
                      label="Topic routed"
                      detail={generation?.systemName ?? "choosing a system"}
                    />
                    <Step
                      state={routed ? "active" : "pending"}
                      icon={PenLine}
                      label="First question"
                      detail={routed ? "writing" : "waiting on the blueprint"}
                    />
                  </ol>

                  <p className="mt-4 text-[11px] text-muted-foreground">
                    The session opens as soon as the first question is ready. The other{" "}
                    {setSize - 1} are written while you answer it, and appear as they land.
                  </p>
                </div>
              )}

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
      <AuthModal
        open={authOpen}
        onOpenChange={setAuthOpen}
        reason="Sign in to generate QBank sets. Your sets are saved so you can resume them."
      />
    </DashboardLayout>
  );
};

const Step = ({
  state,
  icon: Icon,
  label,
  detail,
}: {
  state: StepState;
  icon: typeof Compass;
  label: string;
  detail: string;
}) => (
  <li className="flex items-center gap-2.5">
    <span
      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
        state === "done"
          ? "bg-primary text-primary-foreground"
          : "border border-border text-muted-foreground"
      }`}
    >
      {state === "done" ? (
        <Check size={12} strokeWidth={3} />
      ) : state === "active" ? (
        <Loader2 size={11} className="animate-spin" />
      ) : (
        <Icon size={11} />
      )}
    </span>
    <span
      className={`text-sm ${state === "pending" ? "text-muted-foreground" : "text-foreground"}`}
    >
      {label}
    </span>
    <span className="ml-auto text-xs text-muted-foreground">{detail}</span>
  </li>
);

export default QBank;
