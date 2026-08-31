import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FlaskConical,
  ArrowRight,
  ChevronRight,
  CheckCircle,
  XCircle,
  ChevronDown,
  Clock,
  Flag,
  SkipForward,
} from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import PageLoader from "@/components/PageLoader";
import AIDisclaimer from "@/components/AIDisclaimer";
import { useQBankContext } from "@/contexts/QBankContext";
import { renderMarkdown } from "@/lib/render-markdown";
import type { OptionKey, QuestionMedia } from "@/lib/qbank-types";

type AnswerState =
  | { status: "unanswered" }
  | { status: "selected"; pending: OptionKey }
  | {
      status: "answered";
      selected: OptionKey;
      correct: OptionKey;
      isCorrect: boolean;
    };

const formatElapsed = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

type Difficulty = "Easy" | "Medium" | "Hard";

// ── OpenMed token styles ────────────────────────────────────────────────────

const MONO_EYEBROW: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--fg-muted)",
};

/** Dark CTA — the OpenMed primary button (ink on light, parchment on dark). */
const darkButtonStyle = (disabled = false): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  height: 40,
  padding: "0 20px",
  borderRadius: "var(--radius-md)",
  border: "1px solid transparent",
  background: "var(--fg)",
  color: "var(--bg)",
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  fontWeight: 500,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.6 : 1,
  transition: "opacity var(--dur-micro) var(--ease-out)",
});

interface QuestionCounterProps {
  total: number;
  currentIndex: number;
  answers: { question_id: string; is_correct: boolean }[];
  questions: { id: string }[];
  reviewIndex: number | null;
  onReview: (index: number) => void;
  onNavigate: (index: number) => void;
  flaggedIds: Set<string>;
  skippedIds: string[];
}

const QuestionCounter = ({
  total,
  currentIndex,
  answers,
  questions,
  reviewIndex,
  onReview,
  onNavigate,
  flaggedIds,
  skippedIds,
}: QuestionCounterProps) => {
  return (
    <div className="hidden md:flex flex-col items-center gap-1.5 w-8 shrink-0 pt-1">
      <div className="flex flex-col gap-1.5 overflow-y-auto max-h-[calc(100vh-160px)] scrollbar-none">
        {Array.from({ length: total }, (_, i) => {
          const q = questions[i];
          const answer = q ? answers.find((a) => a.question_id === q.id) : undefined;
          const isAnswered = !!answer;
          const isCurrent = i === currentIndex && reviewIndex === null;
          const isReviewing = i === reviewIndex;
          const isCorrect = answer?.is_correct;
          const isSkipped = q ? skippedIds.includes(q.id) : false;
          const isFlaggedQ = q ? flaggedIds.has(q.id) : false;

          const dotStyle: React.CSSProperties = isCurrent
            ? {
                background: "var(--accent-soft)",
                color: "var(--accent)",
                border: "1px solid var(--accent)",
              }
            : isReviewing
            ? {
                background: "var(--accent-soft)",
                color: "var(--accent)",
                border: "2px solid var(--accent)",
              }
            : isAnswered && isCorrect
            ? {
                background: "rgba(5,150,105,0.15)",
                color: "#059669",
                border: "1px solid rgba(5,150,105,0.4)",
                cursor: "pointer",
              }
            : isAnswered
            ? {
                background: "rgba(220,38,38,0.12)",
                color: "#dc2626",
                border: "1px solid rgba(220,38,38,0.35)",
                cursor: "pointer",
              }
            : isSkipped
            ? {
                background: "rgba(217,119,6,0.15)",
                color: "#d97706",
                border: "1px solid rgba(217,119,6,0.35)",
                cursor: "pointer",
              }
            : {
                background: "var(--bg-elevated)",
                color: "var(--fg-subtle)",
                border: "1px solid var(--border)",
              };

          const canClick = isAnswered || (isSkipped && !isCurrent);

          return (
            <button
              key={i}
              disabled={!canClick && !isCurrent}
              onClick={() => {
                if (isAnswered) onReview(i);
                else if (isSkipped && !isCurrent) onNavigate(i);
              }}
              className="relative shrink-0 transition-opacity hover:opacity-80"
              style={{
                ...dotStyle,
                width: 28,
                height: 28,
                borderRadius: "var(--radius-sm)",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title={
                isAnswered
                  ? `Q${i + 1} — click to review`
                  : isSkipped && !isCurrent
                  ? `Q${i + 1} — skipped, click to answer`
                  : `Q${i + 1}`
              }
            >
              {i + 1}
              {isFlaggedQ && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-warning border border-background">
                  <Flag className="h-1.5 w-1.5 text-white" fill="currentColor" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const PULSE_CONFIG: Record<Difficulty, { bars: number; color: string; label: string }> = {
  Easy:   { bars: 1, color: "#059669", label: "Easy"   },
  Medium: { bars: 2, color: "#d97706", label: "Medium" },
  Hard:   { bars: 3, color: "#dc2626", label: "Hard"   },
};

const StethoscopePulse = ({ difficulty }: { difficulty: Difficulty }) => {
  const cfg = PULSE_CONFIG[difficulty];

  const heights = [8, 16, 24];
  const activeHeights = [8, 18, 28];

  return (
    <div className="flex items-center gap-2">
      <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />

      <div className="flex items-end gap-[3px]" aria-label={`Difficulty: ${cfg.label}`}>
        {[0, 1, 2].map((i) => {
          const isActive = i < cfg.bars;
          const h = isActive ? activeHeights[i] : heights[i];
          return (
            <div
              key={i}
              style={{
                height: `${h}px`,
                width: "4px",
                borderRadius: "2px",
                backgroundColor: isActive ? cfg.color : "hsl(var(--muted-foreground) / 0.2)",
                transition: "height 0.3s ease, background-color 0.3s ease",
              }}
            />
          );
        })}
      </div>

      <span
        className="text-[11px] font-semibold"
        style={{ color: cfg.color }}
      >
        {cfg.label}
      </span>
    </div>
  );
};

interface ExplanationContentProps {
  explanation: string;
  teachingPoint: string;
  difficulty: Difficulty;
  isCorrect: boolean;
  media?: QuestionMedia[];
  onOpenLightbox: (items: QuestionMedia[], index: number) => void;
  domain: string;
}

const ExplanationContent = ({
  explanation,
  teachingPoint,
  difficulty,
  isCorrect,
  media,
  onOpenLightbox,
  domain,
}: ExplanationContentProps) => (
  <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between">
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 12px",
          borderRadius: "var(--radius-pill)",
          border: isCorrect ? "1px solid var(--accent)" : "1px solid var(--signal)",
          background: isCorrect ? "var(--accent-soft)" : "rgba(197,69,58,0.08)",
          color: isCorrect ? "var(--accent)" : "var(--signal)",
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        {isCorrect ? (
          <CheckCircle style={{ width: 13, height: 13 }} />
        ) : (
          <XCircle style={{ width: 13, height: 13 }} />
        )}
        {isCorrect ? "Correct" : "Incorrect"}
      </div>
      <StethoscopePulse difficulty={difficulty} />
    </div>

    <div style={{ height: 1, background: "var(--border)" }} />

    {media && media.length > 0 && (
      <MediaBlock media={media} context="explanation" onOpen={onOpenLightbox} />
    )}

    <div>
      <p style={{ ...MONO_EYEBROW, color: "var(--accent)", marginBottom: 8 }}>
        Explanation
      </p>
      <p
        className="whitespace-pre-line [&_strong]:text-foreground [&_strong]:font-bold"
        style={{ fontSize: 12, lineHeight: 1.8, color: "var(--fg-muted)" }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(explanation ?? "") }}
      />
    </div>

    <div
      style={{
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        borderInlineStart: "3px solid var(--accent)",
        background: "var(--accent-soft)",
        padding: "12px 16px",
      }}
    >
      <p style={{ ...MONO_EYEBROW, color: "var(--accent)", marginBottom: 6 }}>
        Key teaching point
      </p>
      <p
        style={{ fontSize: 13, lineHeight: 1.6, color: "var(--fg)" }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(teachingPoint ?? "") }}
      />
    </div>

    <div className="flex items-center gap-2 pt-1">
      <span style={MONO_EYEBROW}>Domain</span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "4px 10px",
          borderRadius: "var(--radius-pill)",
          border: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--fg-muted)",
        }}
      >
        {domain}
      </span>
    </div>

    {/* Explanations and teaching points are model-generated; this surface
        previously carried no notice at all. */}
    <AIDisclaimer variant="short" className="pt-1" />
  </div>
);

interface OptionTileProps {
  letter: OptionKey;
  text: string;
  answerState: AnswerState;
  pendingKey: OptionKey | null;
  onSelect: (key: OptionKey) => void;
}

const LETTER_LABELS: Record<OptionKey, string> = {
  a: "A", b: "B", c: "C", d: "D", e: "E",
};

const OptionTile = ({ letter, text, answerState, pendingKey, onSelect }: OptionTileProps) => {
  const isAnswered = answerState.status === "answered";
  const isSelected = isAnswered && answerState.selected === letter;
  const isCorrect  = isAnswered && answerState.correct === letter;
  const isWrong    = isSelected && !isCorrect;
  const isDimmed   = isAnswered && !isSelected && !isCorrect;

  const isPending = answerState.status === "selected" && pendingKey === letter;

  const tileStyle: React.CSSProperties = isCorrect
    ? { border: "1px solid var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
    : isWrong
    ? { border: "1px solid var(--signal)", background: "rgba(197,69,58,0.08)", color: "var(--signal)" }
    : isDimmed
    ? {
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        color: "var(--fg-subtle)",
        cursor: "default",
      }
    : isPending
    ? {
        border: "1px solid var(--accent)",
        background: "var(--accent-soft)",
        color: "var(--fg)",
        cursor: "pointer",
      }
    : {
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        color: "var(--fg)",
        cursor: "pointer",
      };

  const letterStyle: React.CSSProperties = isCorrect
    ? { background: "var(--accent)", color: "var(--bg)" }
    : isWrong
    ? { background: "var(--signal)", color: "#fff" }
    : isDimmed
    ? { background: "var(--border)", color: "var(--fg-subtle)" }
    : isPending
    ? { background: "var(--accent)", color: "var(--bg)" }
    : { background: "var(--border)", color: "var(--fg-muted)" };

  return (
    <button
      type="button"
      onClick={() => !isAnswered && onSelect(letter)}
      disabled={isAnswered}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "14px 16px",
        borderRadius: "var(--radius-md)",
        textAlign: "left",
        transition: "all var(--dur-micro) var(--ease-out)",
        ...tileStyle,
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: "var(--radius-sm)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          fontWeight: 600,
          flexShrink: 0,
          ...letterStyle,
        }}
      >
        {LETTER_LABELS[letter]}
      </span>
      <span style={{ fontSize: 14, lineHeight: 1.6, paddingTop: 2 }}>{text}</span>
    </button>
  );
};

interface MediaBlockProps {
  media: QuestionMedia[];
  context: 'stem' | 'explanation';
  onOpen: (items: QuestionMedia[], index: number) => void;
}

const MediaBlock = ({ media, context, onOpen }: MediaBlockProps) => {
  const items = media.filter(
    (m) => m.display_context === context || m.display_context === 'both'
  );

  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      {items.map((m, i) => (
        <div key={i} className="rounded-xl overflow-hidden border border-border/40 bg-white">
          <img
            src={m.file_url}
            alt={m.caption ?? m.media_type}
            className="mx-auto block max-h-[380px] w-auto max-w-full object-contain cursor-zoom-in"
            onClick={() => onOpen(items, i)}
          />
          {(m.caption || (m.license === 'CC-BY' && m.attribution)) && (
            <div className="px-3 py-2 space-y-0.5">
              {m.caption && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {m.caption}
                </p>
              )}
              {m.license === 'CC-BY' && m.attribution && (
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  {m.attribution}
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

interface QuestionNavigatorProps {
  total: number;
  currentIndex: number;
  answers: { question_id: string; is_correct: boolean }[];
  questions: { id: string }[];
  reviewIndex: number | null;
  onReview: (index: number) => void;
  onNavigate: (index: number) => void;
  displayedNumber: number;
  flaggedIds: Set<string>;
  skippedIds: string[];
}

const QuestionNavigator = ({
  total,
  currentIndex,
  answers,
  questions,
  reviewIndex,
  onReview,
  onNavigate,
  displayedNumber,
  flaggedIds,
  skippedIds,
}: QuestionNavigatorProps) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="md:hidden inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors"
      >
        Q{displayedNumber} of {total}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      <div
        className={`md:hidden fixed inset-x-0 bottom-0 z-50 bg-card border-t border-border/60 rounded-t-2xl transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex flex-col items-center pt-3 pb-2 px-4">
          <div className="w-10 h-1 rounded-full bg-border/60 mb-3" />
          <div className="flex items-center justify-between w-full">
            <span className="text-xs font-bold text-foreground">
              Questions ({total})
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 px-4 pb-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-success/20 border border-success/40" />
            <span className="text-[10px] text-muted-foreground">Correct</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-danger/20 border border-danger/40" />
            <span className="text-[10px] text-muted-foreground">Incorrect</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-muted/30 border border-border/20" />
            <span className="text-[10px] text-muted-foreground">Unanswered</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-warning/20 border border-warning/40" />
            <span className="text-[10px] text-muted-foreground">Skipped</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="relative w-3 h-3 rounded-sm bg-muted/30 border border-border/20">
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2 items-center justify-center rounded-full bg-warning">
                <Flag className="h-1 w-1 text-white" fill="currentColor" />
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground">Flagged</span>
          </div>
        </div>

        <div className="px-4 pb-8 max-h-[50vh] overflow-y-auto">
          <div className="grid grid-cols-8 gap-2">
            {Array.from({ length: total }, (_, i) => {
              const q = questions[i];
              const answer = q ? answers.find((a) => a.question_id === q.id) : undefined;
              const isAnswered = !!answer;
              const isCurrent = i === currentIndex && reviewIndex === null;
              const isReviewingThis = i === reviewIndex;
              const isCorrect = answer?.is_correct;
              const isSkipped = q ? skippedIds.includes(q.id) : false;
              const isFlaggedQ = q ? flaggedIds.has(q.id) : false;

              let bg = "bg-muted/30 text-muted-foreground border-border/20";
              if (isCurrent || isReviewingThis) {
                bg = "bg-primary/20 text-primary border-primary/50";
              } else if (isAnswered) {
                bg = isCorrect
                  ? "bg-success/15 text-success border-success/40"
                  : "bg-danger/15 text-danger border-danger/40";
              } else if (isSkipped) {
                bg = "bg-warning/20 text-warning border-warning/40";
              }

              const canClick = isAnswered || (isSkipped && !isCurrent);

              return (
                <button
                  key={i}
                  disabled={!canClick && !isCurrent}
                  onClick={() => {
                    if (isAnswered) {
                      onReview(i);
                      setOpen(false);
                    } else if (isSkipped && !isCurrent) {
                      onNavigate(i);
                      setOpen(false);
                    }
                  }}
                  className={`relative aspect-square rounded-lg border text-[10px] font-bold flex items-center justify-center transition-opacity ${bg} ${
                    canClick ? "cursor-pointer hover:opacity-80" : "cursor-default"
                  }`}
                >
                  {i + 1}
                  {isFlaggedQ && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-warning border border-background">
                      <Flag className="h-1.5 w-1.5 text-white" fill="currentColor" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
};

interface ReviewExplanationDrawerProps {
  explanation: string;
  teachingPoint: string;
  difficulty: Difficulty;
  isCorrect: boolean;
  media?: QuestionMedia[];
  onOpenLightbox: (items: QuestionMedia[], index: number) => void;
  domain: string;
}

const ReviewExplanationDrawer = ({
  explanation,
  teachingPoint,
  difficulty,
  isCorrect,
  media,
  onOpenLightbox,
  domain,
}: ReviewExplanationDrawerProps) => {
  const [open, setOpen] = useState(true);

  return (
    <div
      className={`relative bg-card border-t border-border/60 rounded-t-2xl transition-transform duration-300 ease-out ${
        open ? "translate-y-0" : "translate-y-[calc(100%-48px)]"
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex flex-col items-center gap-1 pt-3 pb-2 px-4"
      >
        <div className="w-10 h-1 rounded-full bg-border/60" />
        <div className="flex items-center justify-between w-full mt-1">
          <span className="text-[11px] font-semibold tracking-wider text-primary uppercase">
            Explanation
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-bold ${
                isCorrect ? "text-success" : "text-danger"
              }`}
            >
              {isCorrect ? "✓ Correct" : "✗ Incorrect"}
            </span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${
                open ? "rotate-0" : "rotate-180"
              }`}
            />
          </div>
        </div>
      </button>

      <div className="px-4 pb-8 max-h-[55vh] overflow-y-auto">
        <ExplanationContent
          explanation={explanation}
          teachingPoint={teachingPoint}
          difficulty={difficulty}
          isCorrect={isCorrect}
          media={media}
          onOpenLightbox={onOpenLightbox}
          domain={domain}
        />
      </div>
    </div>
  );
};

const QBankSession = () => {
  const navigate = useNavigate();
  const {
    session,
    currentIndex,
    totalQuestions,
    isLastQuestion,
    submitAnswer,
    nextQuestion,
    endSession,
    reviewIndex,
    setReviewIndex,
    displayQuestion,
    displayAnswer,
    isReviewing,
    lastSummary,
    restoreSession,
    snapshotTimer,
    flaggedIds,
    toggleFlag,
    isFlagLoading,
    skipQuestion,
    goToQuestion,
    unansweredCount,
  } = useQBankContext();

  const isFlagged = displayQuestion ? flaggedIds.has(displayQuestion.id) : false;

  const restoredRef = useRef(false);

  const [searchParams] = useSearchParams();
  const sessionIdParam = searchParams.get("session");
  const reviewParam = searchParams.get("review");

  const [answerState, setAnswerState] = useState<AnswerState>({ status: "unanswered" });
  const [submitting, setSubmitting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [elapsedDisplay, setElapsedDisplay] = useState(0);
  const [lightboxItems, setLightboxItems] = useState<QuestionMedia[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomOffset, setZoomOffset] = useState({ x: 0, y: 0 });
  const lightboxOpen = lightboxItems.length > 0;
  const currentLightboxItem = lightboxItems[lightboxIndex] ?? null;

  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setLightboxItems([]); setZoomScale(1); setZoomOffset({ x: 0, y: 0 }); }
      if (e.key === 'ArrowRight') { setLightboxIndex((i) => Math.min(i + 1, lightboxItems.length - 1)); setZoomScale(1); setZoomOffset({ x: 0, y: 0 }); }
      if (e.key === 'ArrowLeft') { setLightboxIndex((i) => Math.max(i - 1, 0)); setZoomScale(1); setZoomOffset({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxOpen, lightboxItems.length]);

  const openLightbox = useCallback((items: QuestionMedia[], idx: number) => {
    setLightboxItems(items);
    setLightboxIndex(idx);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (reviewParam !== null) {
      const idx = parseInt(reviewParam, 10);
      if (!isNaN(idx)) setReviewIndex(idx);
    }
  }, []);

  useEffect(() => {
    if (!restoredRef.current) {
      restoredRef.current = true;

      if (session) return;

      const didRestore = restoreSession();

      if (!didRestore && !sessionIdParam && !lastSummary) {
        navigate("/qbank");
      }

      return;
    }

    if (!session && !sessionIdParam && !lastSummary) {
      navigate("/qbank");
    }
  }, [session, sessionIdParam, lastSummary, navigate, restoreSession]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const q = session?.questions[currentIndex];
    const existingAnswer = q
      ? session?.answers.find((a) => a.question_id === q.id)
      : undefined;

    if (existingAnswer && q) {
      setAnswerState({
        status: "answered",
        selected: existingAnswer.selected_option as OptionKey,
        correct: q.correct_option as OptionKey,
        isCorrect: existingAnswer.is_correct,
      });
    } else {
      setAnswerState({ status: "unanswered" });
    }
    setDrawerOpen(false);
  }, [currentIndex]);

  useEffect(() => {
    if (!session) return;
    const tick = () => {
      setElapsedDisplay(session.accumulatedMs + (Date.now() - session.resumedAt));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [session]);

  useEffect(() => {
    return () => {
      snapshotTimer();
    };
  }, [snapshotTimer]);

  const handleSelect = useCallback(
    (key: OptionKey) => {
      if (isReviewing) return;
      if (answerState.status === "answered") return;
      setAnswerState({ status: "selected", pending: key });
    },
    [isReviewing, answerState]
  );

  const handleConfirm = useCallback(async () => {
    if (answerState.status !== "selected") return;
    if (submitting) return;
    const pending = answerState.pending;
    setSubmitting(true);
    try {
      const result = await submitAnswer(pending);
      if (!result) return;
      setAnswerState({
        status: "answered",
        selected: pending,
        correct: result.correct_option,
        isCorrect: result.is_correct,
      });
      setTimeout(() => setDrawerOpen(true), 300);
    } finally {
      setSubmitting(false);
    }
  }, [answerState, submitAnswer, submitting]);

  const handleNext = useCallback(async () => {
    setDrawerOpen(false);
    if (unansweredCount === 0) {
      await endSession();
    } else {
      nextQuestion();
    }
  }, [unansweredCount, endSession, nextQuestion]);

  useEffect(() => {
    if (isReviewing) return;
    if (lightboxOpen) return;
    if (answerState.status === "answered") return;

    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      const k = e.key.toLowerCase();
      if (k === "a" || k === "b" || k === "c" || k === "d" || k === "e") {
        e.preventDefault();
        handleSelect(k as OptionKey);
      } else if (e.key === "Enter" && answerState.status === "selected") {
        e.preventDefault();
        handleConfirm();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isReviewing, lightboxOpen, answerState, handleSelect, handleConfirm]);

  const sessionQuestions = session?.questions ?? lastSummary?.questions ?? [];
  const sessionAnswers = session?.answers ?? lastSummary?.answers ?? [];
  const effectiveTotalQuestions = session ? totalQuestions : lastSummary?.total ?? 0;

  if (!displayQuestion) {
    return (
      <DashboardLayout width="app">
        <PageLoader context="qbank" />
      </DashboardLayout>
    );
  }

  const effectiveAnswerState: AnswerState =
    isReviewing && displayAnswer && displayQuestion
      ? {
          status: "answered",
          selected: displayAnswer.selected_option as OptionKey,
          correct: displayQuestion.correct_option,
          isCorrect: displayAnswer.is_correct,
        }
      : answerState;

  const isAnsweredEffective = effectiveAnswerState.status === "answered";

  const options: { key: OptionKey; text: string }[] = [
    { key: "a", text: displayQuestion!.option_a },
    { key: "b", text: displayQuestion!.option_b },
    { key: "c", text: displayQuestion!.option_c },
    { key: "d", text: displayQuestion!.option_d },
    { key: "e", text: displayQuestion!.option_e },
  ];

  const displayedNumber = (isReviewing ? reviewIndex! : currentIndex) + 1;

  return (
    <DashboardLayout width="app">
      {isReviewing && (() => {
        const fromSummary = !session && !!lastSummary;
        const hasNext = reviewIndex! + 1 < effectiveTotalQuestions;
        return (
          <div className="flex items-center justify-between mb-4 px-3 py-2 rounded-xl bg-primary/5 border border-primary/20">
            <button
              onClick={() => {
                if (fromSummary) {
                  setReviewIndex(null);
                  navigate("/qbank/summary");
                } else {
                  setReviewIndex(null);
                }
              }}
              className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
            >
              {fromSummary ? "← Back to Summary" : "← Back to current question"}
            </button>
            <span className="text-xs font-semibold text-primary">
              Reviewing Q{reviewIndex! + 1} of {effectiveTotalQuestions} — read only
            </span>
            <button
              onClick={() => {
                if (hasNext) {
                  setReviewIndex(reviewIndex! + 1);
                } else if (fromSummary) {
                  setReviewIndex(null);
                  navigate("/qbank/summary");
                } else {
                  setReviewIndex(null);
                }
              }}
              className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
            >
              {hasNext ? "Next →" : fromSummary ? "← Back to Summary" : "← Back to current question"}
            </button>
          </div>
        );
      })()}

      <div className="flex gap-3 items-start">
        {effectiveTotalQuestions > 0 && (
          <QuestionCounter
            total={effectiveTotalQuestions}
            currentIndex={currentIndex}
            answers={sessionAnswers}
            questions={sessionQuestions}
            reviewIndex={reviewIndex}
            onReview={(i) => setReviewIndex(i)}
            onNavigate={(i) => {
              setReviewIndex(null);
              goToQuestion(i);
            }}
            flaggedIds={flaggedIds}
            skippedIds={session?.skippedIds ?? []}
          />
        )}

        <div className="flex-1 min-w-0 flex gap-6 items-start">
          <div
            key={isReviewing ? `review-${reviewIndex}` : `question-${currentIndex}`}
            className="question-enter flex-1 min-w-0 space-y-5"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
                {displayQuestion!.subject}
              </span>
              <span className="hidden md:inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground">
                Q{displayedNumber} of {effectiveTotalQuestions}
              </span>

              {effectiveTotalQuestions > 0 && (
                <QuestionNavigator
                  total={effectiveTotalQuestions}
                  currentIndex={currentIndex}
                  answers={sessionAnswers}
                  questions={sessionQuestions}
                  reviewIndex={reviewIndex}
                  onReview={(i) => setReviewIndex(i)}
                  onNavigate={(i) => {
                    setReviewIndex(null);
                    goToQuestion(i);
                  }}
                  displayedNumber={displayedNumber}
                  flaggedIds={flaggedIds}
                  skippedIds={session?.skippedIds ?? []}
                />
              )}

              {session && !isReviewing && (
                <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground gap-1.5 tabular-nums">
                  <Clock className="h-3 w-3" />
                  {formatElapsed(elapsedDisplay)}
                </span>
              )}

              {!isReviewing && (
                <button
                  type="button"
                  onClick={() => displayQuestion && toggleFlag(displayQuestion.id)}
                  disabled={isFlagLoading || !displayQuestion}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                    isFlagged
                      ? "border-warning/50 bg-warning/10 text-warning hover:bg-warning/20"
                      : "border-border bg-card text-muted-foreground hover:border-warning/40 hover:text-warning"
                  } disabled:opacity-50`}
                  aria-label={isFlagged ? "Unflag question" : "Flag for review"}
                >
                  <Flag className="h-3 w-3" fill={isFlagged ? "currentColor" : "none"} />
                  <span className="hidden sm:inline">{isFlagged ? "Flagged" : "Flag"}</span>
                </button>
              )}
            </div>

            {/* Animated session progress fill */}
            {effectiveTotalQuestions > 0 && (
              <div
                className="h-1 w-full rounded-full overflow-hidden"
                style={{ background: "var(--border)" }}
                aria-hidden
              >
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${(sessionAnswers.length / effectiveTotalQuestions) * 100}%`,
                    background: "var(--accent)",
                  }}
                />
              </div>
            )}

            <div
              style={{
                border: "1px solid var(--border)",
                borderInlineStart: "3px solid var(--accent)",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-elevated)",
                padding: "20px 20px 24px",
              }}
            >
              <p style={{ ...MONO_EYEBROW, marginBottom: 12 }}>Clinical vignette</p>
              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 15,
                  lineHeight: 1.75,
                  color: "var(--fg)",
                  whiteSpace: "pre-line",
                }}
              >
                {displayQuestion!.question_text}
              </p>
            </div>

            {displayQuestion!.media && displayQuestion!.media.length > 0 && (
              <MediaBlock media={displayQuestion!.media} context="stem" onOpen={openLightbox} />
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span style={{ ...MONO_EYEBROW, letterSpacing: "0.1em" }}>
                Select one answer
              </span>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>

            <div className="space-y-2.5">
              {options.map(({ key, text }) => (
                <OptionTile
                  key={key}
                  letter={key}
                  text={text}
                  answerState={effectiveAnswerState}
                  pendingKey={effectiveAnswerState.status === "selected" ? effectiveAnswerState.pending : null}
                  onSelect={handleSelect}
                />
              ))}
            </div>

            {answerState.status === "unanswered" && !isReviewing && !isLastQuestion && (
              <div className="flex justify-start pt-1">
                <button
                  type="button"
                  onClick={skipQuestion}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 40,
                    padding: "0 16px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--fg-muted)",
                    fontFamily: "var(--font-sans)",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  <SkipForward style={{ width: 16, height: 16 }} />
                  Skip for now
                </button>
              </div>
            )}

            {effectiveAnswerState.status === "selected" && !isReviewing && (
              <div className="flex justify-end pt-1 animate-fade-in">
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={submitting}
                  style={darkButtonStyle(submitting)}
                >
                  <CheckCircle style={{ width: 16, height: 16 }} />
                  {submitting ? "Checking…" : "Confirm Answer"}
                </button>
              </div>
            )}

            {isAnsweredEffective && !isReviewing && (
              unansweredCount > 0 && isLastQuestion ? (
                <div className="flex flex-col gap-2 pt-1 animate-fade-in">
                  <div className="flex items-center gap-2 rounded-xl border border-warning/20 bg-warning/5 px-4 py-3">
                    <SkipForward className="h-4 w-4 text-warning shrink-0" />
                    <p className="text-xs text-warning font-medium">
                      {unansweredCount === 1
                        ? "You have 1 unanswered question — go back and answer it to finish."
                        : `You have ${unansweredCount} unanswered questions — go back and answer them to finish.`}
                    </p>
                  </div>
                </div>
              ) : unansweredCount === 0 ? (
                <div className="flex justify-end pt-1 animate-fade-in">
                  <button type="button" onClick={handleNext} style={darkButtonStyle()}>
                    Finish Session <ChevronRight style={{ width: 16, height: 16 }} />
                  </button>
                </div>
              ) : (
                <div className="flex justify-end pt-1 animate-fade-in">
                  <button type="button" onClick={handleNext} style={darkButtonStyle()}>
                    Next Question <ArrowRight style={{ width: 16, height: 16 }} />
                  </button>
                </div>
              )
            )}
          </div>

          <div
            className={`hidden lg:flex flex-col w-80 xl:w-96 shrink-0 transition-all duration-300 ${
              isAnsweredEffective ? "opacity-100 translate-x-0" : "opacity-0 pointer-events-none translate-x-4"
            }`}
          >
            {isAnsweredEffective && effectiveAnswerState.status === "answered" && (
              <div
                className="animate-fade-in sticky top-6"
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)",
                  background: "var(--bg-elevated)",
                  padding: 20,
                }}
              >
                <ExplanationContent
                  explanation={displayQuestion!.explanation}
                  teachingPoint={displayQuestion!.teaching_point}
                  difficulty={displayQuestion!.difficulty as Difficulty}
                  isCorrect={effectiveAnswerState.status === "answered" && effectiveAnswerState.isCorrect}
                  media={displayQuestion!.media}
                  onOpenLightbox={openLightbox}
                  domain={displayQuestion!.domain}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {isAnsweredEffective && effectiveAnswerState.status === "answered" && !isReviewing && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-50">
          <div
            className={`fixed inset-0 bg-black/40 transition-opacity duration-300 ${
              drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
            onClick={() => setDrawerOpen(false)}
          />

          <div
            className={`relative bg-card border-t border-border/60 rounded-t-2xl transition-transform duration-300 ease-out ${
              drawerOpen ? "translate-y-0" : "translate-y-full"
            }`}
          >
            <button
              onClick={() => setDrawerOpen((o) => !o)}
              className="w-full flex flex-col items-center gap-1 pt-3 pb-2 px-4"
            >
              <div className="w-10 h-1 rounded-full bg-border/60" />
              <div className="flex items-center justify-between w-full mt-1">
                <span className="text-[11px] font-semibold tracking-wider text-primary uppercase">
                  Explanation
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${
                    drawerOpen ? "rotate-0" : "rotate-180"
                  }`}
                />
              </div>
            </button>

            <div className="px-4 pb-6 max-h-[60vh] overflow-y-auto">
              <ExplanationContent
                explanation={displayQuestion!.explanation}
                teachingPoint={displayQuestion!.teaching_point}
                difficulty={displayQuestion!.difficulty as Difficulty}
                isCorrect={effectiveAnswerState.status === "answered" && effectiveAnswerState.isCorrect}
                media={displayQuestion!.media}
                onOpenLightbox={openLightbox}
                domain={displayQuestion!.domain}
              />

              <div className="pt-4">
                {unansweredCount > 0 && isLastQuestion ? (
                  <div className="flex items-center gap-2 rounded-xl border border-warning/20 bg-warning/5 px-4 py-3">
                    <SkipForward className="h-4 w-4 text-warning shrink-0" />
                    <p className="text-xs text-warning font-medium">
                      {unansweredCount === 1
                        ? "You have 1 unanswered question — go back and answer it to finish."
                        : `You have ${unansweredCount} unanswered questions — go back and answer them to finish.`}
                    </p>
                  </div>
                ) : unansweredCount === 0 ? (
                  <button
                    type="button"
                    onClick={handleNext}
                    style={{ ...darkButtonStyle(), width: "100%", height: 44 }}
                  >
                    Finish Session <ChevronRight style={{ width: 16, height: 16 }} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleNext}
                    style={{ ...darkButtonStyle(), width: "100%", height: 44 }}
                  >
                    Next Question <ArrowRight style={{ width: 16, height: 16 }} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* lg, not md: the desktop explanation rail only appears at lg+, so a
          `md:hidden` drawer left 768–1023px with no rationale anywhere on the
          page while reviewing. Matches the live-answer drawer's breakpoint. */}
      {isReviewing && effectiveAnswerState.status === "answered" && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-40">
          <ReviewExplanationDrawer
            explanation={displayQuestion!.explanation}
            teachingPoint={displayQuestion!.teaching_point}
            difficulty={displayQuestion!.difficulty as Difficulty}
            isCorrect={effectiveAnswerState.isCorrect}
            media={displayQuestion!.media}
            onOpenLightbox={openLightbox}
            domain={displayQuestion!.domain}
          />
        </div>
      )}

      {lightboxOpen && currentLightboxItem && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85"
          onClick={() => { setLightboxItems([]); setZoomScale(1); setZoomOffset({ x: 0, y: 0 }); }}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white text-3xl font-light leading-none z-10"
            onClick={() => { setLightboxItems([]); setZoomScale(1); setZoomOffset({ x: 0, y: 0 }); }}
            aria-label="Close"
          >
            ×
          </button>

          {lightboxItems.length > 1 && lightboxIndex > 0 && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl font-light z-10 px-3 py-2"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((i) => i - 1);
                setZoomScale(1);
                setZoomOffset({ x: 0, y: 0 });
              }}
              aria-label="Previous"
            >
              ‹
            </button>
          )}

          <div
            className="flex flex-row items-stretch gap-3 px-16"
            style={{ maxWidth: '95vw', maxHeight: '88vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            {currentLightboxItem.caption && (
              <div
                className="w-48 shrink-0 bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20 flex flex-col justify-center"
                style={{ alignSelf: 'stretch' }}
              >
                <p className="text-[10px] font-bold tracking-[0.12em] text-white/50 uppercase mb-2">
                  Description
                </p>
                <p className="text-white/90 text-xs leading-relaxed">
                  {currentLightboxItem.caption}
                </p>
                {currentLightboxItem.license === 'CC-BY' && currentLightboxItem.attribution && (
                  <p className="mt-3 text-white/40 text-[10px] leading-relaxed border-t border-white/10 pt-2">
                    {currentLightboxItem.attribution}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-col items-center gap-3 min-w-0">
              <div
                className="relative overflow-hidden rounded-lg flex items-center justify-center bg-white"
                style={{
                  width: currentLightboxItem.caption ? 'min(65vw, 900px)' : 'min(85vw, 1100px)',
                  height: 'min(72vh, 700px)',
                  cursor: zoomScale > 1 ? 'grab' : 'default',
                }}
                onMouseDown={(e) => {
                  if (zoomScale <= 1) return;
                  e.preventDefault();
                  const startX = e.clientX - zoomOffset.x;
                  const startY = e.clientY - zoomOffset.y;
                  const el = e.currentTarget;
                  el.style.cursor = 'grabbing';
                  const onMove = (ev: MouseEvent) => {
                    setZoomOffset({ x: ev.clientX - startX, y: ev.clientY - startY });
                  };
                  const onUp = () => {
                    el.style.cursor = zoomScale > 1 ? 'grab' : 'default';
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                  };
                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                }}
              >
                <img
                  src={currentLightboxItem.file_url}
                  alt={currentLightboxItem.caption ?? currentLightboxItem.media_type}
                  className="select-none rounded-lg shadow-2xl"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    transform: `scale(${zoomScale}) translate(${zoomOffset.x / zoomScale}px, ${zoomOffset.y / zoomScale}px)`,
                    transformOrigin: 'center center',
                    transition: 'transform 0.15s ease',
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                  draggable={false}
                />
              </div>

              <div
                className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2 border border-white/20"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="text-white/50 text-xs select-none">−</span>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.1}
                  value={zoomScale}
                  onChange={(e) => {
                    const next = parseFloat(e.target.value);
                    setZoomScale(next);
                    if (next === 1) setZoomOffset({ x: 0, y: 0 });
                  }}
                  className="w-32 accent-white cursor-pointer"
                />
                <span className="text-white/50 text-xs select-none">+</span>
                <span className="text-white/40 text-[10px] w-8 text-center select-none">
                  {zoomScale.toFixed(1)}×
                </span>
                {zoomScale > 1 && (
                  <button
                    className="text-white/50 hover:text-white text-[10px] underline ml-1"
                    onClick={() => { setZoomScale(1); setZoomOffset({ x: 0, y: 0 }); }}
                  >
                    reset
                  </button>
                )}
              </div>
            </div>
          </div>

          {lightboxItems.length > 1 && lightboxIndex < lightboxItems.length - 1 && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl font-light z-10 px-3 py-2"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((i) => i + 1);
                setZoomScale(1);
                setZoomOffset({ x: 0, y: 0 });
              }}
              aria-label="Next"
            >
              ›
            </button>
          )}

          {lightboxItems.length > 1 && (
            <div className="absolute bottom-4 flex gap-2">
              {lightboxItems.map((_, i) => (
                <button
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === lightboxIndex ? 'bg-white' : 'bg-white/30'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightboxIndex(i);
                    setZoomScale(1);
                    setZoomOffset({ x: 0, y: 0 });
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
};

export default QBankSession;
