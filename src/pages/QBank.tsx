import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FlaskConical, LogIn, Zap, BookOpen, CheckCircle, History, ChevronRight, Clock, Trash2, Flag, Check } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import PageLoader from "@/components/PageLoader";
import { useAuth } from "@/hooks/use-auth";
import { useQBankContext } from "@/contexts/QBankContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface SessionRow {
  id: string;
  score: number;
  total: number;
  total_time_ms: number;
  system: string;
  ended_at: string;
}

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

const QBank = () => {
  const navigate = useNavigate();
  const { user, isAnonymous } = useAuth();
  const {
    questionCount,
    startSession,
    allDomainMeta,
    allQuestionMeta,
    availableSystems,
    restoreSession,
    resetSession,
    flaggedIds,
  } = useQBankContext();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const MAX_SESSION_CAP = 40;
  const flaggedCount = flaggedIds.size;

  const [page, setPage] = useState(0);
  const [selectedSystem, setSelectedSystem] = useState<string>("");
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [questionLimit, setQuestionLimit] = useState<number>(MAX_SESSION_CAP);
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (availableSystems.length > 0 && selectedSystem === "") {
      setSelectedSystem(availableSystems[0]);
    }
  }, [availableSystems, selectedSystem]);

  const availableDomains = useMemo(() => {
    if (!selectedSystem) return [];
    return [
      ...new Set(
        allDomainMeta
          .filter((r) => r.subject === selectedSystem)
          .map((r) => r.domain)
      ),
    ].sort();
  }, [allDomainMeta, selectedSystem]);

  const handleSystemChange = (system: string) => {
    setSelectedSystem(system);
    setSelectedDomains([]);
  };

  useEffect(() => {
    if (!user || isAnonymous) return;

    try {
      const raw = localStorage.getItem("sb_qbank_session");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      if (
        parsed.savedAt &&
        Date.now() - parsed.savedAt < TWENTY_FOUR_HOURS &&
        Array.isArray(parsed.questions) &&
        parsed.questions.length > 0 &&
        typeof parsed.currentIndex === "number" &&
        Array.isArray(parsed.answers)
      ) {
        setHasSavedSession(true);
      }
    } catch {
      // ignore
    }
  }, [user, isAnonymous]);

  const savedSessionMeta = useMemo(() => {
    try {
      const raw = localStorage.getItem("sb_qbank_session");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return {
        answered: Array.isArray(parsed.answers) ? parsed.answers.length : 0,
        total: Array.isArray(parsed.questions) ? parsed.questions.length : 0,
        system: parsed.questions?.[0]?.subject ?? "Cardiovascular",
      };
    } catch {
      return null;
    }
  }, [hasSavedSession]);

  const handleResume = () => {
    const restored = restoreSession();
    if (restored) {
      navigate("/qbank/session");
    }
  };

  const handleDiscard = () => {
    resetSession();
    setHasSavedSession(false);
  };

  const availableForSelection = useMemo(() => {
    const systemFiltered = selectedSystem
      ? allQuestionMeta.filter((q) => q.subject === selectedSystem)
      : allQuestionMeta;
    if (selectedDomains.length === 0) return systemFiltered.length;
    return systemFiltered.filter((q) => selectedDomains.includes(q.domain)).length;
  }, [allQuestionMeta, selectedSystem, selectedDomains]);

  const sliderMax = Math.min(availableForSelection, MAX_SESSION_CAP);
  const effectiveSliderMax = sliderMax > 0 ? sliderMax : MAX_SESSION_CAP;

  useEffect(() => {
    if (sliderMax > 0) {
      setQuestionLimit((prev) => Math.min(prev, sliderMax));
    }
  }, [sliderMax]);

  const toggleDomain = (domain: string) => {
    setSelectedDomains((prev) => {
      if (prev.includes(domain)) {
        if (prev.length === 1) return [];
        return prev.filter((d) => d !== domain);
      }
      return [...prev, domain];
    });
  };

  const selectAll = () => setSelectedDomains([]);

  const { data: sessionHistory, isLoading: historyLoading } = useQuery({
    queryKey: ["qbank-sessions", user?.id, page],
    enabled: !!user && !isAnonymous,
    queryFn: async (): Promise<{ rows: SessionRow[]; hasMore: boolean }> => {
      const { data, error } = await supabase
        .from("qbank_sessions")
        .select("id, score, total, total_time_ms, system, ended_at")
        .eq("user_id", user!.id)
        .order("ended_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

      if (error) throw error;

      const rows = (data ?? []) as SessionRow[];
      const hasMore = rows.length > PAGE_SIZE;
      return {
        rows: rows.slice(0, PAGE_SIZE),
        hasMore,
      };
    },
  });

  const handleStart = async () => {
    // Brief full-screen hand-off so the session player never snaps in
    setStarting(true);
    const minDelay = new Promise((resolve) => window.setTimeout(resolve, 800));
    await Promise.all([
      startSession({
        domains: selectedDomains,
        system: selectedSystem,
        limit: flaggedOnly ? flaggedCount : questionLimit,
        questionIds: flaggedOnly ? [...flaggedIds] : undefined,
      }),
      minDelay,
    ]);
    navigate("/qbank/session");
  };

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
    } catch (err) {
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

  if (starting) {
    return (
      <DashboardLayout wide>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background animate-fade-in">
          <PageLoader context="qbank" fullPage={false} />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout wide>
      {/* The layout owns the page gutter; no padding of our own on top of it. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        {/* Left Panel - Configuration */}
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
              Practice questions,{" "}
              <span className="italic" style={{ color: "var(--color-accent)" }}>
                built to stick.
              </span>
            </h1>
            <p
              className="mt-2.5 max-w-xl text-base leading-relaxed"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              NBME blueprints, clinical guidelines, human-verified. Instant feedback on
              every answer.
            </p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 text-center shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
              <p className="text-3xl font-serif font-medium text-primary leading-none">
                {questionCount}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground mt-1">questions</p>
            </div>
            <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 text-center shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
              <p className="text-2xl font-serif font-medium text-foreground leading-none">
                Step 1
              </p>
              <p className="font-mono text-[10px] text-muted-foreground mt-1">&amp; Step 2</p>
            </div>
            <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 text-center shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
              <p className="text-3xl font-serif font-medium text-foreground leading-none">
                {availableSystems.length > 0 ? availableSystems.length : "—"}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground mt-1">
                {availableSystems.length === 1 ? "system" : "systems"}
              </p>
            </div>
          </div>

          {/* Feature Badges */}
          <div className="flex flex-wrap gap-2">
            {[
              { icon: Zap, label: "Instant feedback" },
              { icon: BookOpen, label: "Full explanations" },
              { icon: CheckCircle, label: "Human-verified" },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="inline-flex items-center gap-1.5 border border-border rounded-full bg-card px-3 py-1.5"
              >
                <Icon className="w-3 h-3 text-primary" />
                <span className="font-mono text-[11px] text-muted-foreground">
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Sign In Card */}
          {isAnonymous || !user ? (
            <div className="space-y-4 rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-6 text-center shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[color:var(--color-foreground)] text-[color:var(--color-accent)] shadow-sm">
                <LogIn className="h-5 w-5" strokeWidth={2.2} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Sign in to access QBank
                </p>
                <p className="text-xs text-muted-foreground">
                  Create a free account to start answering questions and track
                  your progress.
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
              {/* Resume Session Card */}
              {hasSavedSession && savedSessionMeta && (
                <div className="space-y-3 rounded-2xl border border-[color:var(--color-border)] border-l-4 border-l-[color:var(--color-accent)] bg-[color:var(--color-card)] p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-9 h-9 rounded-lg border border-border bg-card flex-shrink-0">
                      <History className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Resume previous session
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground mt-0.5">
                        {savedSessionMeta.system} · {savedSessionMeta.answered}/{savedSessionMeta.total} answered
                      </p>
                    </div>
                  </div>

                  <div className="w-full h-1 rounded-full bg-border overflow-hidden">
                    <div
                      className="transition-all h-full rounded-full bg-primary"
                      style={{
                        width: `${savedSessionMeta.total > 0 ? (savedSessionMeta.answered / savedSessionMeta.total) * 100 : 0}%`,
                      }}
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleResume}
                      className="flex-1 h-10rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <ChevronRight className="w-4 h-4" />
                      Continue
                    </button>
                    <button
                      type="button"
                      onClick={handleDiscard}
                      className="h-10px-4 rounded-lg border border-border bg-transparent text-muted-foreground text-sm font-medium hover:bg-secondary transition-colors"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}

              {/* Configuration Card */}
              <div className="space-y-5 rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
                {/* System Selector */}
                <div>
                  <p className="font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground mb-2">System</p>
                  <div className="flex flex-wrap gap-2">
                    {availableSystems.length === 0 ? (
                      [100, 88].map((w) => (
                        <div
                          key={w}
                          style={{ width: `${w}px` }}
                          className="h-7 rounded-full bg-border animate-pulse"
                        />
                      ))
                    ) : (
                      availableSystems.map((system) => (
                        <button
                          key={system}
                          type="button"
                          onClick={() => handleSystemChange(system)}
                          className={`inline-flex items-center gap-2 h-8 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                            selectedSystem === system
                              ? "bg-primary border-primary text-primary-foreground shadow-md"
                              : "bg-card border-border text-muted-foreground hover:border-primary hover:text-primary"
                          } border`}
                        >
                          {selectedSystem === system && <Check className="w-4 h-4" />}
                          {system}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Filter - Flagged Only */}
                {flaggedCount > 0 && (
                  <div>
                    <p className="font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground mb-2">Filter</p>
                    <button
                      type="button"
                      onClick={() => setFlaggedOnly((v) => !v)}
                      className={`inline-flex items-center gap-2 h-8 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                        flaggedOnly
                          ? "bg-warning/10 border-warning text-warning"
                          : "bg-card border-border text-muted-foreground hover:border-input"
                      } border`}
                    >
                      <Flag className="h-3 w-3" fill={flaggedOnly ? "currentColor" : "none"} />
                      Flagged only ({flaggedCount})
                    </button>
                  </div>
                )}

                {/* Domain Selector */}
                <div className={flaggedOnly ? "opacity-50 pointer-events-none" : ""}>
                  <p className="font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground mb-2">Domain</p>
                  <div className="flex flex-wrap gap-2">
                    {availableDomains.length === 0 ? (
                      [80, 96, 72, 88].map((w) => (
                        <div
                          key={w}
                          style={{ width: `${w}px` }}
                          className="h-7 rounded-full bg-border animate-pulse"
                        />
                      ))
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={selectAll}
                          className={`inline-flex items-center gap-2 h-8 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                            selectedDomains.length === 0
                              ? "bg-primary border-primary text-primary-foreground shadow-md"
                              : "bg-card border-border text-muted-foreground hover:border-primary hover:text-primary"
                          } border`}
                        >
                          {selectedDomains.length === 0 && <Check className="w-4 h-4" />}
                          All
                        </button>
                        {availableDomains.map((domain) => (
                          <button
                            key={domain}
                            type="button"
                            onClick={() => toggleDomain(domain)}
                            className={`inline-flex items-center gap-2 h-8 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                              selectedDomains.includes(domain)
                                ? "bg-primary border-primary text-primary-foreground shadow-md"
                                : "bg-card border-border text-muted-foreground hover:border-primary hover:text-primary"
                            } border`}
                          >
                            {selectedDomains.includes(domain) && <Check className="w-4 h-4" />}
                            {domain}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </div>

                {/* Question Count Slider */}
                <div className={`space-y-2 ${flaggedOnly ? "opacity-50 pointer-events-none" : ""}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground">Questions</p>
                    <span className="font-mono text-xs font-semibold text-primary px-2 py-0.5 border border-primary rounded-lg bg-primary/10">
                      {questionLimit}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={effectiveSliderMax}
                    step={5}
                    value={questionLimit}
                    onChange={(e) => setQuestionLimit(Number(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-teal-500 bg-border"
                  />
                  <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                    <span>5</span>
                    <span>{effectiveSliderMax}</span>
                  </div>
                  {selectedDomains.length > 0 && (
                    <p className="text-[11px] text-muted-foreground text-center mt-1">
                      {availableForSelection} question{availableForSelection !== 1 ? "s" : ""} available in selected domains
                    </p>
                  )}
                </div>
              </div>

              {/* Start Session Button */}
              <button
                type="button"
                onClick={handleStart}
                disabled={questionCount === 0 || (flaggedOnly ? flaggedCount === 0 : effectiveSliderMax === 0)}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-[18px] bg-[color:var(--color-foreground)] text-sm font-semibold text-[color:var(--color-background)] shadow-[0_16px_32px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(15,23,42,0.16)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
              >
                <FlaskConical className="w-4 h-4" />
                Start Session · {flaggedOnly ? flaggedCount : questionLimit} Questions
              </button>
            </>
          )}

          {/* Session History - Mobile */}
          {!isAnonymous && user && (
            <div className="w-full space-y-4 pt-2 lg:hidden">
              <div className="flex items-center gap-2 mb-3">
                <History className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground">
                  Session History
                </p>
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
                    No sessions yet — complete your first session to see your history here.
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
                            <span className={`text-base font-semibold tabular-nums leading-none ${getScoreColor(s.score, s.total)}`}>
                              {pct}%
                            </span>
                            <span className="text-[10px] text-muted-foreground mt-0.5">
                              {s.score}/{s.total}
                            </span>
                          </div>

                          <div className="flex-1 min-w-0 space-y-0.5">
                            <p className="text-sm font-semibold text-foreground truncate">
                              {s.system}
                            </p>
                            <div className="flex items-center gap-3">
                              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                {formatSessionTime(s.total_time_ms)}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {formatSessionDate(s.ended_at)}
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
                    <span className="text-[11px] text-muted-foreground">
                      Page {page + 1}
                    </span>
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
            </div>
          )}
        </div>

        {/* Right Panel - Session History (Desktop) */}
        {!isAnonymous && user && (
          <div className="hidden lg:block w-80 xl:w-96 space-y-4">
            <div className="flex items-center gap-2 mb-3">
              <History className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground">
                Session History
              </p>
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
                  No sessions yet — complete your first session to see your history here.
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
                          <span className={`text-base font-semibold tabular-nums leading-none ${getScoreColor(s.score, s.total)}`}>
                            {pct}%
                          </span>
                          <span className="text-[10px] text-muted-foreground mt-0.5">
                            {s.score}/{s.total}
                          </span>
                        </div>

                        <div className="flex-1 min-w-0 space-y-0.5">
                          <p className="text-sm font-semibold text-foreground truncate">
                            {s.system}
                          </p>
                          <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {formatSessionTime(s.total_time_ms)}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {formatSessionDate(s.ended_at)}
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
                  <span className="text-[11px] text-muted-foreground">
                    Page {page + 1}
                  </span>
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
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default QBank;
