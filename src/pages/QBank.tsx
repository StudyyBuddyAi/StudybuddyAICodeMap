import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  LogIn,
  History,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock,
  Trash2,
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
import SEO from "@/components/SEO";
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

interface SessionRow {
  id: string;
  score: number;
  total: number;
  total_time_ms: number;
  system: string;
  ended_at: string | null;
}

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

const formatRelative = (iso: string | null): string => {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatSessionDate(iso);
};

const formatSessionDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatSessionTime = (ms: number) => {
  const totalSec = Math.round(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
};

const getScoreColor = (score: number, total: number) => {
  const pct = total > 0 ? score / total : 0;
  if (pct >= 0.8) return "text-success";
  if (pct >= 0.6) return "text-warning";
  return "text-danger";
};

const getScoreBg = (score: number, total: number) => {
  const pct = total > 0 ? score / total : 0;
  if (pct >= 0.8) return "bg-success/10 border-success/30";
  if (pct >= 0.6) return "bg-warning/10 border-warning/30";
  return "bg-danger/10 border-danger/30";
};

const PAGE_SIZE = 5;

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

  const [page, setPage] = useState(0);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<UnfinishedRow | null>(null);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);

  const [topic, setTopic] = useState("");
  const [setSize, setSetSize] = useState(MIN_SET_SIZE);
  const [challenge, setChallenge] = useState<ChallengeLevel>("balanced");
  const [examMode, setExamMode] = useState<ExamMode>("step1");
  const [playMode, setPlayMode] = useState<PlayMode>("tutor");
  // Collapsed by default, as on the sheet and deck generators: the topic is
  // the one thing every student has to type, and the rest has sane defaults.
  const [customizeOpen, setCustomizeOpen] = useState(false);
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
          description: resumeError ?? "Check your connection and try again.",
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

  const { data: sessionHistory, isLoading: historyLoading } = useQuery({
    queryKey: ["qbank-sessions", user?.id, page],
    enabled: !!user,
    queryFn: async (): Promise<{ rows: SessionRow[]; hasMore: boolean }> => {
      const { data, error: queryError } = await supabase
        .from("qbank_sessions")
        .select("id, score, total, total_time_ms, system, ended_at")
        .eq("user_id", user!.id)
        // Unfinished sets have their own list. Left in, they sorted to the top
        // (NULL ended_at sorts first descending) with a score of zero.
        .eq("status", "completed")
        .order("ended_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

      if (queryError) throw queryError;

      const rows = (data ?? []) as SessionRow[];
      return {
        rows: rows.slice(0, PAGE_SIZE),
        hasMore: rows.length > PAGE_SIZE,
      };
    },
  });

  const handleDeleteSession = async (sessionId: string) => {
    setIsDeleting(true);
    try {
      const { error: attemptsError } = await supabase
        .from("user_attempts")
        .delete()
        .eq("session_id", sessionId);

      if (attemptsError) throw attemptsError;

      const { error: sessionError } = await supabase
        .from("qbank_sessions")
        .delete()
        .eq("id", sessionId);

      if (sessionError) throw sessionError;

      setPendingDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["qbank-sessions"] });
    } catch {
      toast({
        title: "Failed to delete session",
        description: "Please try again.",
        variant: "destructive",
      });
      setPendingDeleteId(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const routed = !!generation?.systemName;
  const estimatedMinutes = Math.max(1, Math.round((setSize * 18) / 60));

  // One list, rendered twice at different breakpoints. It used to be two
  // hand-maintained copies of the same 130 lines.
  const history = (
    <>
      <div className="flex items-center gap-2 mb-3">
        <History className="w-3.5 h-3.5 text-muted-foreground" />
        <p className={`${MONO_EYEBROW} text-muted-foreground`}>Session History</p>
      </div>

      {historyLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 rounded-lg border border-border bg-secondary animate-pulse"
            />
          ))}
        </div>
      ) : !sessionHistory || sessionHistory.rows.length === 0 ? (
        <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 text-center">
          <p className="text-xs text-muted-foreground">
            No sessions yet — generate your first set to see your history here.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {sessionHistory.rows.map((s) => {
              const pct = s.total > 0 ? Math.round((s.score / s.total) * 100) : 0;

              if (pendingDeleteId === s.id) {
                return (
                  <div
                    key={s.id}
                    className="w-full rounded-lg px-4 py-3 flex items-center justify-between gap-3 border border-danger/30 bg-danger/5"
                  >
                    <p className="text-xs font-medium text-foreground">Delete this session?</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setPendingDeleteId(null)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleDeleteSession(s.id)}
                        disabled={isDeleting}
                        className="flex items-center gap-1.5 rounded-md bg-danger/10 border border-danger/40 text-danger hover:bg-danger/20 text-xs font-medium px-3 py-1.5 transition-colors disabled:opacity-50"
                      >
                        {isDeleting ? (
                          <span className="h-3 w-3 rounded-full border-2 border-danger/40 border-t-red-500 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                        Delete
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <button
                  key={s.id}
                  onClick={() => navigate(`/qbank/summary?session=${s.id}`)}
                  className="group flex w-full items-center gap-3.5 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--color-accent)] hover:shadow-[0_14px_28px_rgba(17,85,90,0.08)]"
                >
                  <div
                    className={`flex flex-col items-center justify-center rounded-lg border px-3 py-1.5 shrink-0 ${getScoreBg(s.score, s.total)}`}
                  >
                    <span
                      className={`text-base font-semibold tabular-nums leading-none ${getScoreColor(s.score, s.total)}`}
                    >
                      {pct}%
                    </span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">
                      {s.score}/{s.total}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="text-sm font-semibold text-foreground truncate">{s.system}</p>
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatSessionTime(s.total_time_ms)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {s.ended_at ? formatSessionDate(s.ended_at) : ""}
                      </span>
                    </div>
                  </div>

                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteId(s.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        e.preventDefault();
                        setPendingDeleteId(s.id);
                      }
                    }}
                    className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                    aria-label="Delete session"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>

                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← Previous
            </button>
            <span className="text-[11px] text-muted-foreground">Page {page + 1}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!sessionHistory.hasMore}
              className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        </>
      )}
    </>
  );

  return (
    <>
      <SEO
        title="QBank · USMLE-Style Questions"
        description="Generate USMLE-style clinical vignettes on any medical topic. Adaptive practice with spaced repetition and detailed explanations."
        keywords="medical QBank, USMLE questions, clinical vignettes, medical exam prep, spaced repetition"
      />
      <DashboardLayout wide>
      {/* The layout owns the page gutter; no padding of our own on top of it. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8 max-w-[86%] mx-auto">
        {/* Left Panel — the generator */}
        <div className="flex-1 max-w-2xl mx-auto lg:mx-0 lg:max-w-none space-y-6 animate-fade-in">
          {/* Header — same voice as Sheets: mono eyebrow, serif headline, one-line lede. */}
          <div>
            <p
              className="mb-2 [font-family:var(--app-font-mono)] text-[11px] font-medium uppercase tracking-[0.14em]"
              style={{ color: "var(--color-accent)" }}
            >
              QBank · USMLE-style
            </p>
            <h1
              className="[font-family:var(--app-font-serif)] text-[clamp(28px,4vw,40px)] font-medium leading-[1.1] tracking-[-0.012em]"
              style={{ color: "var(--color-foreground)" }}
            >
              Questions on{" "}
              <span className="italic" style={{ color: "var(--color-accent)" }}>
                anything you like.
              </span>
            </h1>
            <p
              className="mt-2.5 max-w-xl text-base leading-relaxed"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              Name a topic and a set is written for it, to NBME item-writing rules. You
              start on the first question as soon as it is ready — the rest is written
              while you work.
            </p>
          </div>

          {/* Sign In Card */}
          {!user ? (
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
                onClick={() => navigate("/dashboard")}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-[18px] bg-[color:var(--color-foreground)] text-sm font-semibold text-[color:var(--color-background)] shadow-[0_16px_32px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(15,23,42,0.16)]"
              >
                <LogIn className="w-4 h-4" />
                Sign In to Start
              </button>
            </div>
          ) : (
            <>
              {/* Unfinished sets — every set left open, on any device. */}
              {unfinished && unfinished.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <History className="w-3.5 h-3.5 text-muted-foreground" />
                    <p className={`${MONO_EYEBROW} text-muted-foreground`}>
                      Unfinished sets ({unfinished.length})
                    </p>
                  </div>
                  {unfinished.map((u) => {
                    const total = Math.max(u.expected_total, u.question_count);
                    const pct = total > 0 ? (u.answered_count / total) * 100 : 0;
                    const stillWriting = u.question_count < u.expected_total;
                    const timed = u.mode === "timed";
                    return (
                      <div
                        key={u.id}
                        className="space-y-3 rounded-2xl border border-[color:var(--color-border)] border-l-4 border-l-[color:var(--color-accent)] bg-[color:var(--color-card)] p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]"
                      >
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium text-foreground">
                                {u.topic ?? u.system}
                              </p>
                              <span
                                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                                style={
                                  timed
                                    ? { background: "rgba(217,119,6,0.12)", color: "#d97706" }
                                    : { background: "var(--color-accent-soft, rgba(17,85,90,0.1))", color: "var(--color-accent)" }
                                }
                              >
                                {timed ? "Timed" : "Tutor"}
                              </span>
                            </div>
                            <p className="font-mono text-[11px] text-muted-foreground mt-0.5">
                              {u.answered_count}/{total} answered
                              {u.flagged_count > 0 ? ` · ${u.flagged_count} flagged` : ""}
                              {u.exam_mode && EXAM_MODE_LABELS[u.exam_mode as ExamMode]
                                ? ` · ${EXAM_MODE_LABELS[u.exam_mode as ExamMode]}`
                                : ""}
                              {" · "}
                              {formatRelative(u.last_activity_at)}
                            </p>
                            {stillWriting && (
                              <p className="font-mono text-[11px] text-muted-foreground mt-0.5">
                                {u.question_count} of {u.expected_total} written — the rest is written when you resume
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="w-full h-1 rounded-full bg-border overflow-hidden">
                          <div
                            className="transition-all h-full rounded-full bg-primary"
                            style={{ width: `${pct}%` }}
                          />
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleResume(u.id)}
                            disabled={!!resumingId}
                            className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
                          >
                            {resumingId === u.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                            Resume
                          </button>
                          <button
                            type="button"
                            onClick={() => setDiscardTarget(u)}
                            className="h-10 px-4 rounded-lg border border-border bg-transparent text-muted-foreground text-sm font-medium hover:bg-secondary transition-colors"
                          >
                            Discard
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

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

              {/* Generator Card */}
              <div className="space-y-5 rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
                {/* Topic */}
                <div>
                  <p className={`${MONO_EYEBROW} text-muted-foreground mb-2`}>Topic</p>
                  <div className="flex flex-col gap-2.5 sm:flex-row">
                    <input
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") generate();
                      }}
                      disabled={isStarting}
                      placeholder="aortic dissection, nephrotic syndrome, the brachial plexus…"
                      className="flex-1 rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[var(--color-accent)] disabled:opacity-60"
                      style={{
                        borderColor: "var(--color-border)",
                        background: "var(--color-background)",
                        color: "var(--color-foreground)",
                      }}
                    />
                  </div>
                </div>

                {/* Customize — collapsed by default, header carrying the current
                    picks so a closed panel still says what it will do. The same
                    disclosure the sheet and deck generators use. */}
                <div className="border-t border-[color:var(--color-border)] pt-4">
                  <button
                    type="button"
                    onClick={() => setCustomizeOpen((v) => !v)}
                    aria-expanded={customizeOpen}
                    aria-controls="qbank-customize"
                    className="flex w-full items-center gap-2.5 text-left"
                  >
                    <p className={`${MONO_EYEBROW} text-muted-foreground`}>Customize</p>
                    <span className="ml-auto flex min-w-0 items-center gap-2">
                      {!customizeOpen && (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {PLAY_MODE_LABELS[playMode]} · {EXAM_MODE_LABELS[examMode]} · {setSize} questions ·{" "}
                          {CHALLENGE_LABELS[challenge]}
                        </span>
                      )}
                      {customizeOpen ? (
                        <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                    </span>
                  </button>

                  {customizeOpen && (
                    <div id="qbank-customize" className="animate-fade-in mt-4 space-y-5">
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
                  )}
                </div>
              </div>

              {/* Generate */}
              <button
                type="button"
                onClick={generate}
                disabled={isStarting || !topic.trim()}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-[18px] bg-[color:var(--color-foreground)] text-sm font-semibold text-[color:var(--color-background)] shadow-[0_16px_32px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(15,23,42,0.16)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
              >
                {isStarting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {isStarting ? "Writing…" : `Generate ${setSize} Questions`}
              </button>

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
            </>
          )}

{/* Session History — Mobile */}
          {user && (
            <div className="w-full space-y-4 pt-2 lg:hidden">{history}</div>
          )}
        </div>

        {/* Right Panel — Session History (Desktop) */}
        {user && (
          <div className="hidden lg:block w-80 xl:w-96 space-y-4">{history}</div>
        )}
      </div>
    </DashboardLayout>
    </>
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
