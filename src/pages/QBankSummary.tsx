import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FlaskConical, CheckCircle, XCircle, Clock, RotateCcw, ChevronRight, Flag } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import PageLoader from "@/components/PageLoader";
import { useQBankContext } from "@/contexts/QBankContext";
import { supabase } from "@/integrations/supabase/client";
import type { Question, QuestionMedia, SessionAnswer } from "@/lib/qbank-types";

interface SummaryData {
  questions: Question[];
  answers: SessionAnswer[];
  totalTime: number;
  score: number;
  total: number;
  flaggedIds: string[];
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
  media: ReviewMedia[] | null;
}

const ScoreRing = ({ score, total }: { score: number; total: number }) => {
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const color = pct >= 80 ? "#059669" : pct >= 60 ? "#d97706" : "#dc2626";

  return (
    <div className="relative flex items-center justify-center w-36 h-36">
      <svg width="144" height="144" viewBox="0 0 144 144" className="-rotate-90">
        <circle cx="72" cy="72" r={radius} fill="none" stroke="hsl(var(--sb-border))" strokeWidth="10" />
        <circle cx="72" cy="72" r={radius} fill="none" stroke={color} strokeWidth="10"
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s ease-out" }} />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 32,
            fontWeight: 500,
            color,
            lineHeight: 1,
          }}
        >
          {pct}%
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--fg-muted)",
            marginTop: 4,
          }}
        >
          {score} / {total}
        </span>
      </div>
    </div>
  );
};

// ── OpenMed token styles ────────────────────────────────────────────────────

const MONO_EYEBROW: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--fg-muted)",
};

const PANEL_STYLE: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  background: "var(--bg-elevated)",
};

/** Dark CTA — the OpenMed primary button (ink on light, parchment on dark). */
const DARK_BUTTON_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  flex: 1,
  height: 40,
  borderRadius: "var(--radius-md)",
  border: "1px solid transparent",
  background: "var(--fg)",
  color: "var(--bg)",
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const OUTLINE_BUTTON_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  flex: 1,
  height: 40,
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--fg)",
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const formatTime = (ms: number): string => {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
};

const performanceLabel = (pct: number): { text: string; color: string } => {
  if (pct >= 80) return { text: "Strong performance", color: "#059669" };
  if (pct >= 60) return { text: "Good effort", color: "#d97706" };
  if (pct >= 40) return { text: "Keep practicing", color: "#ea580c" };
  return { text: "Review the material", color: "#dc2626" };
};

const QBankSummary = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const { lastSummary, startSession, enterSummaryReview, setReviewIndex, loadSummary } = useQBankContext();

  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [summaryFlaggedIds, setSummaryFlaggedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (sessionId) {
        try {
          // Answer fields are REVOKE'd from direct table selects; the owner-only
          // RPC returns the graded questions + attempts for this session.
          const { data, error } = await supabase.rpc("get_session_review", {
            p_session: sessionId,
          });

          if (!error && data) {
            const review = data as unknown as {
              session: {
                score: number;
                total: number;
                total_time_ms: number;
                started_at: string;
                ended_at: string;
              };
              attempts: Array<{
                question_id: string;
                selected_option: string;
                is_correct: boolean;
                time_taken_ms: number | null;
                question: ReviewQuestion | null;
              }>;
              flagged: string[];
            };

            const questions: Question[] = review.attempts
              .map((a) => {
                const q = a.question;
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
              })
              .filter(Boolean) as Question[];

            const answers: SessionAnswer[] = review.attempts.map((a) => ({
              question_id: a.question_id,
              selected_option: a.selected_option as SessionAnswer["selected_option"],
              is_correct: a.is_correct,
              time_taken_ms: a.time_taken_ms ?? 0,
            }));

            const flagSet = new Set(review.flagged ?? []);

            const loaded = {
              questions,
              answers,
              totalTime: review.session.total_time_ms,
              score: review.session.score,
              total: review.session.total,
              flaggedIds: [...flagSet],
            };
            setSummaryData(loaded);
            setSummaryFlaggedIds(flagSet);
            loadSummary(loaded);
            setLoading(false);
            return;
          }
        } catch (err) {
          console.error("Failed to load session review, falling back to memory:", err);
        }
      }

      if (lastSummary) {
        setSummaryData(lastSummary);
        setSummaryFlaggedIds(new Set(lastSummary.flaggedIds ?? []));
        setLoading(false);
        return;
      }

      navigate("/qbank");
    };

    load();
  }, [sessionId, lastSummary, navigate, loadSummary]);

  if (loading) {
    return (
      <DashboardLayout>
        <PageLoader context="qbank" />
      </DashboardLayout>
    );
  }

  if (!summaryData) return null;

  const { questions, answers, totalTime, score, total } = summaryData;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const perf = performanceLabel(pct);
  const avgTime = total > 0
    ? Math.round(answers.reduce((s, a) => s + (a.time_taken_ms ?? 0), 0) / total / 1000)
    : 0;

  const difficultyBreakdown = ["Easy", "Medium", "Hard"].map((diff) => {
    const qs = questions.filter((q) => q.difficulty === diff);
    const correct = qs.filter((q) => answers.find((a) => a.question_id === q.id)?.is_correct).length;
    return { diff, correct, total: qs.length };
  }).filter((d) => d.total > 0);

  const handleTryAgain = async () => {
    await startSession();
    navigate("/qbank/session");
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

  return (
    <DashboardLayout>
      <div className="space-y-8 animate-fade-in">
        <div className="flex items-center gap-3">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              flexShrink: 0,
            }}
          >
            <FlaskConical style={{ width: 16, height: 16, color: "var(--accent)" }} />
          </div>
          <div>
            <p style={{ ...MONO_EYEBROW, color: "var(--accent)", marginBottom: 4 }}>
              Session complete
            </p>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 24,
                fontWeight: 500,
                color: "var(--fg)",
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              Cardiovascular System
              <span style={{ color: "var(--fg-muted)" }}> · {total} questions</span>
            </h1>
          </div>
        </div>

        <div style={{ ...PANEL_STYLE, padding: 24 }}>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <ScoreRing score={score} total={total} />
            <div className="flex-1 space-y-4 text-center sm:text-left">
              <div>
                <p className="text-lg font-semibold tracking-tight" style={{ color: perf.color }}>{perf.text}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{score} correct out of {total} questions</p>
              </div>
              <div className="flex flex-wrap gap-3 justify-center sm:justify-start">
                {[`${formatTime(totalTime)} total`, `~${avgTime}s per question`].map((label) => (
                  <div
                    key={label}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      borderRadius: "var(--radius-pill)",
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      padding: "6px 12px",
                    }}
                  >
                    <Clock style={{ width: 13, height: 13, color: "var(--fg-muted)" }} />
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--fg-muted)",
                      }}
                    >
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {difficultyBreakdown.length > 0 && (
            <div className="mt-5 pt-5" style={{ borderTop: "1px solid var(--border)" }}>
              <p style={{ ...MONO_EYEBROW, marginBottom: 12 }}>By difficulty</p>
              <div className="flex gap-3 flex-wrap">
                {difficultyBreakdown.map(({ diff, correct, total: t }) => {
                  const diffPct = t > 0 ? Math.round((correct / t) * 100) : 0;
                  const diffColor = diff === "Easy" ? "#059669" : diff === "Medium" ? "#d97706" : "#dc2626";
                  return (
                    <div
                      key={diff}
                      className="flex-1 min-w-[80px] text-center"
                      style={{
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        padding: 12,
                      }}
                    >
                      <p
                        style={{
                          fontFamily: "var(--font-display)",
                          fontSize: 20,
                          fontWeight: 500,
                          color: diffColor,
                          lineHeight: 1,
                        }}
                      >
                        {diffPct}%
                      </p>
                      <p style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 4 }}>{diff}</p>
                      <p
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          color: "var(--fg-subtle)",
                        }}
                      >
                        {correct}/{t}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <p style={{ ...MONO_EYEBROW, paddingLeft: 4 }}>Question breakdown</p>
          {questions.some((q) => summaryFlaggedIds.has(q.id)) && (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 w-fit">
              <Flag className="h-3 w-3" fill="currentColor" />
              {questions.filter((q) => summaryFlaggedIds.has(q.id)).length} flagged for review
            </div>
          )}
          <div className="space-y-1.5">
            {questions.map((q, i) => {
              const ans = answers.find((a) => a.question_id === q.id);
              const isCorrect = ans?.is_correct ?? false;
              const diffColor = q.difficulty === "Easy" ? "#059669" : q.difficulty === "Medium" ? "#d97706" : "#dc2626";
              const stemSnippet = q.question_text.length > 80
                ? q.question_text.slice(0, 80).trimEnd() + "…"
                : q.question_text;

              return (
                <button
                  key={q.id}
                  onClick={() => handleReviewQuestion(i)}
                  className="w-full flex items-start gap-3 text-left group"
                  style={{
                    border: "1px solid var(--border)",
                    borderLeft: isCorrect
                      ? "3px solid var(--accent)"
                      : "3px solid var(--signal)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--bg-elevated)",
                    padding: "14px 16px",
                    cursor: "pointer",
                  }}
                >
                  <div className="shrink-0 mt-0.5">
                    {isCorrect
                      ? <CheckCircle style={{ width: 15, height: 15, color: "var(--accent)" }} />
                      : <XCircle style={{ width: 15, height: 15, color: "var(--signal)" }} />
                    }
                  </div>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold tabular-nums text-muted-foreground shrink-0">Q{i + 1}</span>
                      {summaryFlaggedIds.has(q.id) && (
                        <Flag className="h-3 w-3 text-amber-500 shrink-0" fill="currentColor" />
                      )}
                      <span className="text-[11px] text-muted-foreground">{q.domain}</span>
                      <span className="text-[11px] font-semibold shrink-0" style={{ color: diffColor }}>{q.difficulty}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug truncate">{stemSnippet}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2 mt-0.5">
                    {!isCorrect && ans && (
                      <span className="text-[10px] text-red-600 dark:text-red-400 font-medium">
                        {ans.selected_option.toUpperCase()} → {q.correct_option.toUpperCase()}
                      </span>
                    )}
                    {ans && (
                      <span className="text-[10px] text-muted-foreground">
                        {Math.round((ans.time_taken_ms ?? 0) / 1000)}s
                      </span>
                    )}
                    <ChevronRight className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pb-8">
          <button type="button" onClick={handleTryAgain} style={DARK_BUTTON_STYLE}>
            <RotateCcw style={{ width: 16, height: 16 }} />
            Try Again
          </button>
          <button
            type="button"
            onClick={() => navigate("/qbank")}
            style={OUTLINE_BUTTON_STYLE}
          >
            Back to QBank
            <ChevronRight style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default QBankSummary;
