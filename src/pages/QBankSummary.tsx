import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  RotateCcw,
  ChevronRight,
  Flag,
  AlertTriangle,
  ShieldCheck,
  ImageOff,
  ListChecks,
} from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import PageLoader from "@/components/PageLoader";
import { StatusIcon } from "@/components/qbank/ItemNavigator";
import "@/components/qbank/exam.css";
import { useQBankContext } from "@/contexts/QBankContext";
import { useUsageLimit } from "@/hooks/use-usage-limit";
import { REVIEW_SET_SYSTEM } from "@/lib/qbank-review-queue";
import { supabase } from "@/integrations/supabase/client";
import type { PlayMode, Question, QuestionMedia, SessionAnnotations, SessionAnswer } from "@/lib/qbank-types";
import { CHALLENGE_LABELS, EXAM_MODE_LABELS, TIMED_SECONDS_PER_QUESTION } from "@/lib/qbank-types";
import { formatClock } from "@/lib/qbank-answer";
import { ITEM_STATUS_LABEL, type ItemStatus } from "@/lib/qbank-item-status";
import { ruleLabel } from "@/lib/qbank-rule-labels";
import { scoreSet } from "@/lib/qbank-score";
import { normalizeAnnotations } from "@/lib/qbank-session-state";
import {
  fetchGenerationReport,
  type GenerationReport,
} from "@/lib/qbank-generation-report";

interface SummaryData {
  /** Answered questions first, then any the set left unanswered. */
  questions: Question[];
  answers: SessionAnswer[];
  totalTime: number;
  score: number;
  /** Every question the set held: omitted ones count against the score. */
  total: number;
  flaggedIds: string[];
  /** Questions the set held that were never answered. */
  omitted?: number;
  annotations?: SessionAnnotations;
}

// Raw shapes returned by the get_session_review RPC (before mapping to app types).
interface ReviewMedia {
  file_url: string;
  media_type: string;
  caption: string | null;
  attribution: string | null;
  license: string;
  display_context: string;
  display_order: number;
}

interface ReviewQuestion {
  id: string;
  subject: string;
  domain: string;
  topic: string;
  difficulty: string;
  competency: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string;
  correct_option: string;
  explanation: string;
  teaching_point: string;
  distractor_explanations: Partial<Record<string, string>> | null;
  media: ReviewMedia[] | null;
}

const REASONING_LABELS: Record<string, string> = {
  "1st": "1st-order",
  "2nd": "2nd-order",
  "3rd": "3rd-order",
};

const PANEL_STYLE: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  background: "var(--bg-elevated)",
};

const H2_STYLE: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 650,
  color: "var(--fg)",
  margin: 0,
};

const formatTime = (ms: number): string => {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
};

/**
 * How the set was written, from the signals every generated row already stores.
 *
 * The point is not the numbers, it is that the numbers exist: a set that says
 * "twenty-two written, twenty admitted, two rewritten because the correct
 * answer stood out by length" is making a claim a student can weigh. Held-back
 * items are reported as counts and rule labels only — never tied to a question,
 * since a summary is reachable while its own set is still being reviewed.
 */
const GenerationReportPanel = ({ report }: { report: GenerationReport }) => {
  const heldBack = report.blocked + report.disputed;
  const findings = Object.entries(report.findings).sort((a, b) => b[1] - a[1]);
  const mix = ["1st", "2nd", "3rd"]
    .map((order) => ({ order, n: report.reasoning_mix[order] ?? 0 }))
    .filter((m) => m.n > 0);

  // "Asked for as Step 2 CK at balanced level." Either half can be missing on
  // a set written before its control existed, so the sentence is assembled
  // from whatever the rows recorded.
  const examName = report.exam_mode ? EXAM_MODE_LABELS[report.exam_mode] : null;
  const levelName = report.challenge ? CHALLENGE_LABELS[report.challenge] : null;
  const askedFor =
    examName && levelName
      ? ` Asked for as ${examName} at ${levelName.toLowerCase()} level.`
      : examName
        ? ` Asked for as ${examName}.`
        : levelName
          ? ` Asked for at ${levelName.toLowerCase()} level.`
          : "";

  return (
    <section style={{ ...PANEL_STYLE, padding: 20 }} aria-labelledby="qb-written-title">
      <div className="flex items-center gap-2">
        <ShieldCheck style={{ width: 16, height: 16, color: "var(--accent)" }} aria-hidden />
        <h2 id="qb-written-title" style={H2_STYLE}>
          How this set was written
        </h2>
      </div>

      <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fg-muted)", marginTop: 10 }}>
        {report.written} question{report.written === 1 ? "" : "s"} written,{" "}
        {report.admitted} kept
        {heldBack > 0 ? `, ${heldBack} held back and replaced` : ""}.
        {askedFor}
        {mix.length > 0 && ` Reasoning: ${mix.map((m) => `${REASONING_LABELS[m.order] ?? m.order} ${m.n}`).join(", ")}.`}
      </p>

      {findings.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <h3 style={{ ...H2_STYLE, fontSize: 14, marginBottom: 6 }}>Checks that fired</h3>
          <ul className="flex flex-col gap-1">
            {findings.map(([rule, n]) => (
              <li key={rule} style={{ fontSize: 14, lineHeight: 1.6, color: "var(--fg-muted)" }}>
                {ruleLabel(rule)}
                {n > 1 ? ` · ${n}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.wants_image > 0 && (
        <div
          className="flex items-start gap-2"
          style={{ marginTop: 14, fontSize: 14, lineHeight: 1.6, color: "var(--fg-muted)" }}
        >
          <ImageOff style={{ width: 15, height: 15, marginTop: 3, flexShrink: 0 }} aria-hidden />
          <span>
            {report.wants_image} question{report.wants_image === 1 ? "" : "s"} would read
            better with a figure. There is no image library to draw one from yet.
          </span>
        </div>
      )}
    </section>
  );
};

/** Correct, incorrect and omitted as one bar: the composition, not a ring. */
const ScoreBar = ({ correct, incorrect, omitted }: { correct: number; incorrect: number; omitted: number }) => {
  const total = correct + incorrect + omitted;
  if (total === 0) return null;
  const seg = (n: number, background: string, border?: string) =>
    n > 0 ? <span style={{ flex: n, background, borderRight: border }} /> : null;
  return (
    <div
      aria-hidden
      className="flex h-2.5 w-full overflow-hidden rounded-full"
      style={{ background: "var(--border)", gap: 2 }}
    >
      {seg(correct, "var(--qb-right)")}
      {seg(incorrect, "var(--qb-wrong)")}
      {seg(omitted, "var(--border-strong)")}
    </div>
  );
};

type Filter = "all" | "incorrect" | "omitted" | "marked";

const QBankSummary = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const { qbankRemaining } = useUsageLimit();
  const {
    lastSummary,
    startGeneratedSession,
    lastGeneration,
    lastMode,
    enterSummaryReview,
    setReviewIndex,
    loadSummary,
  } = useQBankContext();
  const [retrying, setRetrying] = useState(false);
  const [report, setReport] = useState<GenerationReport | null>(null);
  const [sessionMode, setSessionMode] = useState<PlayMode>(lastMode);
  const [filter, setFilter] = useState<Filter>("all");
  /** A re-sit from the review queue: it has no single topic to write more of. */
  const [isReviewSet, setIsReviewSet] = useState(false);

  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [summaryFlaggedIds, setSummaryFlaggedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Read through a ref, not a dependency. A successful load calls loadSummary,
  // which replaces lastSummary; as a dependency that re-ran the load, which
  // called loadSummary again — a request loop that stayed hidden only because
  // get_session_review had always failed (see 20260916000000).
  const lastSummaryRef = useRef(lastSummary);
  lastSummaryRef.current = lastSummary;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      let reviewError: string | null = null;

      if (sessionId) {
        try {
          // Answer fields are REVOKE'd from direct table selects; the owner-only
          // RPC returns the graded questions + attempts for this session. The
          // student's own marks are on the session row, which they can read.
          const [{ data, error }, marks] = await Promise.all([
            supabase.rpc("get_session_review", { p_session: sessionId }),
            supabase.from("qbank_sessions").select("annotations, system").eq("id", sessionId).maybeSingle(),
          ]);
          if (cancelled) return;
          if (error) {
            console.error("get_session_review failed:", error);
            reviewError = error.message;
          }

          if (!error && data) {
            const review = data as unknown as {
              session: {
                score: number;
                total: number;
                total_time_ms: number;
                started_at: string;
                ended_at: string;
                mode?: string;
                question_count?: number;
              };
              attempts: Array<{
                question_id: string;
                selected_option: string;
                is_correct: boolean;
                time_taken_ms: number | null;
                question: ReviewQuestion | null;
              }>;
              omitted?: ReviewQuestion[];
              flagged: string[];
            };

            const toQuestion = (q: ReviewQuestion | null): Question | null => {
              if (!q) return null;
              const media: QuestionMedia[] = (q.media ?? []).map((m: ReviewMedia) => ({
                file_url: m.file_url,
                media_type: m.media_type,
                caption: m.caption ?? null,
                license: m.license ?? null,
                attribution: m.attribution ?? null,
                display_context: m.display_context as
                  | "stem"
                  | "explanation"
                  | "both",
                display_order: m.display_order ?? 0,
              }));
              return { ...q, media } as Question;
            };

            // Omitted questions go after the answered ones, so the review walks
            // through what was answered first and ends on what was left.
            const omittedQuestions = (review.omitted ?? []).map(toQuestion).filter(Boolean) as Question[];
            const questions: Question[] = [
              ...(review.attempts.map((a) => toQuestion(a.question)).filter(Boolean) as Question[]),
              ...omittedQuestions,
            ];
            if (review.session.mode === "timed" || review.session.mode === "tutor") {
              setSessionMode(review.session.mode);
            }

            const answers: SessionAnswer[] = review.attempts.map((a) => ({
              question_id: a.question_id,
              selected_option: a.selected_option as SessionAnswer["selected_option"],
              is_correct: a.is_correct,
              time_taken_ms: a.time_taken_ms ?? 0,
            }));

            const flagSet = new Set(review.flagged ?? []);

            const loaded: SummaryData = {
              questions,
              answers,
              totalTime: review.session.total_time_ms,
              score: review.session.score,
              // A row ended before 20261013000000 stored attempts as its total.
              total: Math.max(review.session.total ?? 0, questions.length),
              flaggedIds: [...flagSet],
              omitted: omittedQuestions.length,
              annotations: normalizeAnnotations(marks.data?.annotations),
            };
            setSummaryData(loaded);
            setSummaryFlaggedIds(flagSet);
            setIsReviewSet(marks.data?.system === REVIEW_SET_SYSTEM);
            loadSummary(loaded);
            setLoading(false);
            return;
          }
        } catch (err) {
          console.error("Failed to load session review, falling back to memory:", err);
          reviewError = err instanceof Error ? err.message : String(err);
        }
      }
      if (cancelled) return;

      const memory = lastSummaryRef.current;
      if (memory) {
        setSummaryData(memory);
        setSummaryFlaggedIds(new Set(memory.flaggedIds ?? []));
        setLoading(false);
        return;
      }

      // Nothing to fall back on — always the case for a timed set, which has no
      // grades in memory. Say so, rather than dropping the student on /qbank.
      if (sessionId) {
        // The raw error goes to the console, never to the student.
        if (reviewError) console.error("get_session_review failed:", reviewError);
        setLoadError(
          reviewError?.includes("session_not_found") || reviewError?.includes("invalid input syntax")
            ? "These results don't exist, or they belong to another account."
            : "Something went wrong while loading your results. Please try again."
        );
        setLoading(false);
        return;
      }

      navigate("/qbank");
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, loadAttempt, navigate, loadSummary]);

  useEffect(() => {
    const generationId = lastGeneration?.generationId;
    if (!generationId) {
      setReport(null);
      return;
    }
    let cancelled = false;
    void fetchGenerationReport(generationId).then((r) => {
      if (!cancelled) setReport(r);
    });
    return () => {
      cancelled = true;
    };
  }, [lastGeneration?.generationId]);

  const rows = useMemo(() => {
    if (!summaryData) return [];
    return summaryData.questions.map((q, i) => {
      const ans = summaryData.answers.find((a) => a.question_id === q.id) ?? null;
      const status: ItemStatus = ans ? (ans.is_correct ? "correct" : "incorrect") : "omitted";
      return { q, i, ans, status, marked: summaryFlaggedIds.has(q.id) };
    });
  }, [summaryData, summaryFlaggedIds]);

  if (loading) {
    return (
      <DashboardLayout wide>
        <PageLoader context="qbank" />
      </DashboardLayout>
    );
  }

  if (loadError) {
    return (
      <DashboardLayout wide>
        <div className="qb-exam-portal mx-auto mt-16 max-w-sm space-y-3 text-center">
          <AlertTriangle className="mx-auto h-6 w-6" style={{ color: "var(--qb-warn)" }} />
          <p className="text-[15px] font-medium" style={{ color: "var(--fg)" }}>
            Couldn’t load your results.
          </p>
          <p className="text-[14px]" style={{ color: "var(--fg-muted)" }}>
            {loadError}
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button type="button" onClick={() => setLoadAttempt((n) => n + 1)} className="qb-btn qb-btn--primary qb-btn--lg">
              <RotateCcw /> Try again
            </button>
            <button type="button" onClick={() => navigate("/qbank")} className="qb-btn qb-btn--outline qb-btn--lg">
              Back to QBank
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!summaryData) return null;

  const { questions, answers, totalTime } = summaryData;
  const score = scoreSet(answers, Math.max(summaryData.total, questions.length));

  // The title was hardcoded to "Cardiovascular System", which was merely
  // misleading while the bank held three systems and every session drew from
  // one. Generated sets reach all thirteen, so it is read off the questions —
  // and a set spanning more than one system says so rather than picking one.
  const systemLabel = (() => {
    const subjects = [...new Set(questions.map((q) => q.subject).filter(Boolean))];
    if (subjects.length === 0) return "Session";
    return subjects.length === 1 ? subjects[0] : "Mixed systems";
  })();

  const avgMs = answers.length > 0 ? answers.reduce((s, a) => s + (a.time_taken_ms ?? 0), 0) / answers.length : 0;

  // By discipline rather than by difficulty. The difficulty column is the
  // writer's own label, and measured against real answers it carried no
  // signal — students scored 41% on "Easy" and 57% on "Hard" (live data,
  // 2026-10-30; docs/qbank/research-2026-10.md). The discipline is a fact
  // about the question, so a weak row here means something.
  const disciplineBreakdown = [...new Set(rows.map((r) => r.q.domain).filter(Boolean))]
    .map((domain) => {
      const qs = rows.filter((r) => r.q.domain === domain);
      return { domain, correct: qs.filter((r) => r.status === "correct").length, total: qs.length };
    })
    .sort((a, b) => b.total - a.total || a.domain.localeCompare(b.domain));

  const counts: Record<Filter, number> = {
    all: rows.length,
    incorrect: rows.filter((r) => r.status === "incorrect").length,
    omitted: rows.filter((r) => r.status === "omitted").length,
    marked: rows.filter((r) => r.marked).length,
  };
  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "marked" ? r.marked : r.status === filter
  );
  const firstMissed = rows.find((r) => r.status !== "correct");

  /**
   * Another go at the same thing.
   *
   * For a generated set that means writing a NEW set on the same topic, at the
   * same size. An old session opened by id has no generation behind it to
   * repeat, so that case goes back to the generator rather than starting
   * something the student did not ask for.
   */
  const handleTryAgain = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      // A set opened by id (after a reload, or from history) has no
      // generation in memory: repeat it from what its questions cover, at the
      // same size, rather than dropping the student at an empty generator.
      const retryTopic = lastGeneration?.topic ?? summaryData?.questions.find((q) => q.topic)?.topic ?? null;
      if (!retryTopic) {
        navigate("/qbank");
        return;
      }
      const id = await startGeneratedSession(
        retryTopic,
        againSize,
        lastGeneration?.challenge ?? "balanced",
        lastGeneration?.examMode ?? "step1",
        sessionMode
      );
      navigate(id ? `/qbank/session?session=${id}` : "/qbank/session");
    } catch {
      setRetrying(false);
    }
  };

  const handleReviewQuestion = (index: number) => {
    if (sessionId) {
      setReviewIndex(index);
      navigate(`/qbank/session?session=${sessionId}&review=${index}`);
    } else {
      enterSummaryReview(index);
      navigate("/qbank/session");
    }
  };

  const missed = score.incorrect + score.omitted;
  // The same size again, inside a free account's allowance for today.
  const wantedAgain = lastGeneration?.target ?? Math.max(summaryData?.total ?? 0, 5);
  const againSize = qbankRemaining === null ? wantedAgain : Math.min(wantedAgain, qbankRemaining);
  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "incorrect", label: "Incorrect" },
    { id: "omitted", label: "Omitted" },
    { id: "marked", label: "Marked" },
  ];

  return (
    <DashboardLayout wide>
      <div className="qb-exam-portal mx-auto max-w-3xl space-y-6 animate-fade-in">
        <header>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 30,
              fontWeight: 500,
              color: "var(--fg)",
              margin: 0,
              lineHeight: 1.15,
            }}
          >
            {systemLabel}
          </h1>
          <p style={{ fontSize: 15, color: "var(--fg-muted)", marginTop: 6 }}>
            {sessionMode === "timed" ? "Timed block" : "Tutor block"} complete · {score.total} question
            {score.total === 1 ? "" : "s"} · {formatTime(totalTime)}
          </p>
        </header>

        <section style={{ ...PANEL_STYLE, padding: 24 }} aria-labelledby="qb-score-title">
          <h2 id="qb-score-title" className="qb-sr">
            Score
          </h2>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <p
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 56,
                fontWeight: 500,
                lineHeight: 1,
                color: "var(--fg)",
                margin: 0,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {score.pct}%
            </p>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--fg)", margin: "0 0 4px" }}>
              <strong style={{ fontWeight: 650 }}>{score.correct} correct</strong> · {score.incorrect} incorrect ·{" "}
              {score.omitted} omitted, of {score.total}
              {score.omitted > 0 && (
                <span style={{ display: "block", fontSize: 14, color: "var(--fg-muted)" }}>
                  Omitted questions count as incorrect, as on the exam.
                </span>
              )}
            </p>
          </div>

          <div className="mt-4">
            <ScoreBar correct={score.correct} incorrect={score.incorrect} omitted={score.omitted} />
          </div>

          <dl className="qb-facts" style={{ fontSize: 14, marginTop: 14 }}>
            <div>
              <dt>Time</dt>
              <dd>{formatTime(totalTime)}</dd>
            </div>
            {answers.length > 0 && (
              <div>
                <dt>Average per question</dt>
                <dd>{formatClock(avgMs)}</dd>
              </div>
            )}
            <div>
              <dt>Exam pace</dt>
              <dd>{formatClock(TIMED_SECONDS_PER_QUESTION * 1000)}</dd>
            </div>
          </dl>

          {disciplineBreakdown.length > 1 && (
            <div className="mt-5 pt-5" style={{ borderTop: "1px solid var(--border)" }}>
              <h3 style={{ ...H2_STYLE, fontSize: 14, marginBottom: 10 }}>By discipline</h3>
              <ul className="grid gap-2.5">
                {disciplineBreakdown.map(({ domain, correct, total: t }) => (
                  <li key={domain} className="grid items-center gap-3" style={{ gridTemplateColumns: "minmax(5.5rem, 10rem) 1fr 4.5rem" }}>
                    <span className="truncate" style={{ fontSize: 14 }}>{domain}</span>
                    <span className="h-2 overflow-hidden rounded-full" style={{ background: "var(--border)" }} aria-hidden>
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${t > 0 ? (correct / t) * 100 : 0}%`, background: "var(--qb-right)" }}
                      />
                    </span>
                    <span style={{ fontSize: 14, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {correct}/{t}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            {firstMissed ? (
              <button
                type="button"
                className="qb-btn qb-btn--primary qb-btn--lg"
                onClick={() => handleReviewQuestion(firstMissed.i)}
              >
                <ListChecks /> Review {missed} missed
              </button>
            ) : (
              <button type="button" className="qb-btn qb-btn--primary qb-btn--lg" onClick={() => handleReviewQuestion(0)}>
                <ListChecks /> Review all
              </button>
            )}
            {againSize > 0 && !isReviewSet && (
              <button type="button" className="qb-btn qb-btn--outline qb-btn--lg" onClick={handleTryAgain} disabled={retrying}>
                <RotateCcw />
                {retrying ? "Writing…" : `Another ${againSize} on this topic`}
              </button>
            )}
            <button type="button" className="qb-btn qb-btn--lg" onClick={() => navigate("/qbank")}>
              Back to QBank
            </button>
          </div>

          {(score.incorrect > 0 || counts.marked > 0) && (
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--fg-muted)", marginTop: 12 }}>
              {score.incorrect > 0 &&
                `The ${score.incorrect} you missed come${score.incorrect === 1 ? "s" : ""} back in your review queue tomorrow`}
              {score.incorrect > 0 && counts.marked > 0 ? "; " : ""}
              {counts.marked > 0 &&
                `${score.incorrect > 0 ? "the" : "The"} ${counts.marked} you marked ${counts.marked === 1 ? "is" : "are"} there now`}
              . Retries are free.
            </p>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="qb-questions-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="qb-questions-title" style={H2_STYLE}>
              Questions
            </h2>
            <div className="qb-filter" role="group" aria-label="Show questions">
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  disabled={f.id !== "all" && counts[f.id] === 0}
                  onClick={() => setFilter(f.id)}
                  style={f.id !== "all" && counts[f.id] === 0 ? { opacity: 0.5, cursor: "default" } : undefined}
                >
                  {f.label} <span className="qb-count">{counts[f.id]}</span>
                </button>
              ))}
            </div>
          </div>

          <ul className="space-y-1.5">
            {shown.map(({ q, i, ans, status, marked }) => {
              const stemSnippet = q.question_text.length > 110 ? q.question_text.slice(0, 110).trimEnd() + "…" : q.question_text;
              return (
                <li key={q.id}>
                  <button
                    type="button"
                    onClick={() => handleReviewQuestion(i)}
                    className="group grid w-full items-center gap-x-3 gap-y-1 text-left transition-colors hover:border-[var(--border-strong)]"
                    style={{
                      ...PANEL_STYLE,
                      borderRadius: "var(--radius-md)",
                      gridTemplateColumns: "4.25rem minmax(0,1fr) auto",
                      padding: "12px 14px",
                    }}
                  >
                    <span className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>
                      <StatusIcon status={status} />
                      Q{i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2" style={{ fontSize: 14 }}>
                        <span style={{ fontWeight: 600 }}>{ITEM_STATUS_LABEL[status]}</span>
                        {marked && (
                          <span className="inline-flex items-center gap-1" style={{ color: "var(--fg-muted)" }}>
                            <Flag className="qb-flag" aria-hidden /> Marked
                          </span>
                        )}
                        <span style={{ color: "var(--fg-muted)" }}>{q.domain}</span>
                      </span>
                      <span className="block truncate" style={{ fontSize: 14, color: "var(--fg-muted)", marginTop: 2 }}>
                        {stemSnippet}
                      </span>
                    </span>
                    <span className="flex items-center gap-3" style={{ fontSize: 14, color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>
                      {q.correct_option && (
                        <span>
                          {ans && !ans.is_correct ? `${ans.selected_option.toUpperCase()} → ` : ""}
                          <span style={{ color: "var(--fg)", fontWeight: 600 }}>{q.correct_option.toUpperCase()}</span>
                        </span>
                      )}
                      {ans && <span className="hidden sm:inline">{formatClock(ans.time_taken_ms ?? 0)}</span>}
                      <ChevronRight className="h-4 w-4 transition-colors group-hover:text-[var(--fg)]" aria-hidden />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {report && report.written > 0 && <GenerationReportPanel report={report} />}
        <div className="pb-8" />
      </div>
    </DashboardLayout>
  );
};

export default QBankSummary;
