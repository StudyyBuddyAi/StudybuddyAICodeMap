import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FlaskConical,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  XCircle,
  ChevronDown,
  Flag,
  Loader2,
  AlertTriangle,
  X,
  Undo2,
} from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import PageLoader from "@/components/PageLoader";
import PlayerToolbar from "@/components/qbank/PlayerToolbar";
import EndBlockDialog from "@/components/qbank/EndBlockDialog";
import LabValuesSheet from "@/components/qbank/LabValuesSheet";
import ShortcutsDialog from "@/components/qbank/ShortcutsDialog";
import HighlightableText from "@/components/qbank/HighlightableText";
import { useQBankContext, type GenerationState } from "@/contexts/QBankContext";
import { useQBankFontScale } from "@/hooks/use-qbank-font-scale";
import { useToast } from "@/hooks/use-toast";
import { ruleLabel } from "@/lib/qbank-rule-labels";
import { renderMarkdown } from "@/lib/render-markdown";
import type { OptionKey, PlayMode, QuestionMedia } from "@/lib/qbank-types";

type AnswerState =
  | { status: "unanswered" }
  /** Tutor: picked, not yet confirmed. Timed: the recorded choice. */
  | { status: "selected"; pending: OptionKey }
  | {
      status: "answered";
      selected: OptionKey;
      correct: OptionKey;
      isCorrect: boolean;
    }
  /** Review of a question the set left unanswered: the key, and no choice. */
  | { status: "revealed"; correct: OptionKey };

type Difficulty = "Easy" | "Medium" | "Hard";

const OPTION_KEYS: OptionKey[] = ["a", "b", "c", "d", "e"];

// ── OpenMed token styles ────────────────────────────────────────────────────

const MONO_EYEBROW: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--fg-muted)",
};

/** Scales a base pixel size by the player's text-size preference. */
const fs = (px: number) => `calc(${px}px * var(--qb-scale, 1))`;

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

const outlineButtonStyle = (disabled = false): React.CSSProperties => ({
  ...darkButtonStyle(disabled),
  background: "transparent",
  color: "var(--fg-muted)",
  border: "1px solid var(--border)",
  padding: "0 16px",
});

// ── Question grid ───────────────────────────────────────────────────────────

type CellKind = "correct" | "incorrect" | "answered" | "skipped" | "unanswered" | "unwritten";

interface GridCell {
  kind: CellKind;
  current: boolean;
  flagged: boolean;
}

const CELL_STYLE: Record<CellKind, React.CSSProperties> = {
  correct: { background: "rgba(5,150,105,0.15)", color: "#059669", border: "1px solid rgba(5,150,105,0.4)" },
  incorrect: { background: "rgba(220,38,38,0.12)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.35)" },
  answered: { background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent)" },
  skipped: { background: "rgba(217,119,6,0.15)", color: "#d97706", border: "1px solid rgba(217,119,6,0.35)" },
  unanswered: { background: "var(--bg-elevated)", color: "var(--fg-subtle)", border: "1px solid var(--border)" },
  // Not written yet. A generated set shows its full length from the start, so
  // these slots exist before their questions do — dashed and dimmed so the
  // student can see the set filling in.
  unwritten: { background: "transparent", color: "var(--fg-subtle)", border: "1px dashed var(--border)", opacity: 0.5 },
};

const CELL_TITLE: Record<CellKind, string> = {
  correct: "correct",
  incorrect: "incorrect",
  answered: "answered",
  skipped: "skipped",
  unanswered: "unanswered",
  unwritten: "not written yet",
};

const cellStyle = (cell: GridCell): React.CSSProperties =>
  cell.current
    ? { ...CELL_STYLE[cell.kind], boxShadow: "0 0 0 2px var(--accent)", opacity: 1 }
    : CELL_STYLE[cell.kind];

const FlagDot = ({ size = 12 }: { size?: number }) => (
  <span
    className="absolute -top-1 -right-1 flex items-center justify-center rounded-full bg-amber-500 border border-background"
    style={{ width: size, height: size }}
  >
    <Flag className="text-white" style={{ width: size / 2, height: size / 2 }} fill="currentColor" />
  </span>
);

interface GridProps {
  cells: GridCell[];
  onSelect: (index: number) => void;
}

const QuestionCounter = ({ cells, onSelect }: GridProps) => (
  <div className="hidden md:flex flex-col items-center gap-1.5 w-8 shrink-0 pt-1">
    <div className="flex flex-col gap-1.5 overflow-y-auto max-h-[calc(100vh-160px)] scrollbar-none p-0.5">
      {cells.map((cell, i) => (
        <button
          key={i}
          disabled={cell.kind === "unwritten"}
          onClick={() => onSelect(i)}
          className="relative shrink-0 transition-opacity hover:opacity-80 disabled:cursor-default"
          style={{
            ...cellStyle(cell),
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
          title={`Q${i + 1} — ${CELL_TITLE[cell.kind]}${cell.flagged ? ", flagged" : ""}`}
        >
          {i + 1}
          {cell.flagged && <FlagDot />}
        </button>
      ))}
    </div>
  </div>
);

const QuestionNavigator = ({
  cells,
  onSelect,
  displayedNumber,
  mode,
}: GridProps & { displayedNumber: number; mode: PlayMode | "review" }) => {
  const [open, setOpen] = useState(false);
  const legend: CellKind[] =
    mode === "timed" ? ["answered", "skipped", "unanswered"] : ["correct", "incorrect", "skipped", "unanswered"];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="md:hidden inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors"
      >
        Q{displayedNumber} of {cells.length}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && <div className="md:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />}

      <div
        className={`md:hidden fixed inset-x-0 bottom-0 z-50 bg-card border-t border-border/60 rounded-t-2xl transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex flex-col items-center pt-3 pb-2 px-4">
          <div className="w-10 h-1 rounded-full bg-border/60 mb-3" />
          <div className="flex items-center justify-between w-full">
            <span className="text-xs font-bold text-foreground">Questions ({cells.length})</span>
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 px-4 pb-3 flex-wrap">
          {legend.map((kind) => (
            <div key={kind} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={CELL_STYLE[kind]} />
              <span className="text-[10px] text-muted-foreground capitalize">{CELL_TITLE[kind]}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="flex h-2.5 w-2.5 items-center justify-center rounded-full bg-amber-500">
              <Flag className="h-1.5 w-1.5 text-white" fill="currentColor" />
            </span>
            <span className="text-[10px] text-muted-foreground">Flagged</span>
          </div>
        </div>

        <div className="px-4 pb-8 max-h-[50vh] overflow-y-auto">
          <div className="grid grid-cols-8 gap-2 p-0.5">
            {cells.map((cell, i) => (
              <button
                key={i}
                disabled={cell.kind === "unwritten"}
                onClick={() => {
                  onSelect(i);
                  setOpen(false);
                }}
                className="relative aspect-square rounded-lg text-[10px] font-bold flex items-center justify-center transition-opacity hover:opacity-80 disabled:cursor-default"
                style={cellStyle(cell)}
              >
                {i + 1}
                {cell.flagged && <FlagDot size={10} />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

// ── Explanation ─────────────────────────────────────────────────────────────

const PULSE_CONFIG: Record<Difficulty, { bars: number; color: string; label: string }> = {
  Easy:   { bars: 1, color: "#059669", label: "Easy"   },
  Medium: { bars: 2, color: "#d97706", label: "Medium" },
  Hard:   { bars: 3, color: "#dc2626", label: "Hard"   },
};

const StethoscopePulse = ({ difficulty }: { difficulty: Difficulty }) => {
  const cfg = PULSE_CONFIG[difficulty] ?? PULSE_CONFIG.Medium;

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

      <span className="text-[11px] font-semibold" style={{ color: cfg.color }}>
        {cfg.label}
      </span>
    </div>
  );
};

interface ExplanationContentProps {
  explanation: string;
  teachingPoint: string;
  difficulty: Difficulty;
  /** Null for a question the set left unanswered. */
  isCorrect: boolean | null;
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
          border:
            isCorrect === null ? "1px solid var(--border)" : isCorrect ? "1px solid var(--accent)" : "1px solid var(--signal)",
          background:
            isCorrect === null ? "var(--bg-subtle)" : isCorrect ? "var(--accent-soft)" : "rgba(197,69,58,0.08)",
          color: isCorrect === null ? "var(--fg-muted)" : isCorrect ? "var(--accent)" : "var(--signal)",
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        {isCorrect === null ? null : isCorrect ? (
          <CheckCircle style={{ width: 13, height: 13 }} />
        ) : (
          <XCircle style={{ width: 13, height: 13 }} />
        )}
        {isCorrect === null ? "Omitted" : isCorrect ? "Correct" : "Incorrect"}
      </div>
      <StethoscopePulse difficulty={difficulty} />
    </div>

    <div style={{ height: 1, background: "var(--border)" }} />

    {media && media.length > 0 && (
      <MediaBlock media={media} context="explanation" onOpen={onOpenLightbox} />
    )}

    <div>
      <p style={{ ...MONO_EYEBROW, color: "var(--accent)", marginBottom: 8 }}>Explanation</p>
      <p
        className="whitespace-pre-line [&_strong]:text-foreground [&_strong]:font-bold"
        style={{ fontSize: fs(12), lineHeight: 1.8, color: "var(--fg-muted)" }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(explanation ?? "") }}
      />
    </div>

    <div
      style={{
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        borderLeft: "3px solid var(--accent)",
        background: "var(--accent-soft)",
        padding: "12px 16px",
      }}
    >
      <p style={{ ...MONO_EYEBROW, color: "var(--accent)", marginBottom: 6 }}>Key teaching point</p>
      <p
        style={{ fontSize: fs(13), lineHeight: 1.6, color: "var(--fg)" }}
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
  </div>
);

// ── Options ─────────────────────────────────────────────────────────────────

interface OptionTileProps {
  letter: OptionKey;
  text: string;
  /** Why this option is wrong. Undefined for the key, and before grading. */
  explanation?: string;
  answerState: AnswerState;
  struck: boolean;
  /** Absent when the question can no longer be marked. */
  onToggleStrike?: (key: OptionKey) => void;
  onSelect: (key: OptionKey) => void;
}

const OptionTile = ({ letter, text, explanation, answerState, struck, onToggleStrike, onSelect }: OptionTileProps) => {
  const isGraded = answerState.status === "answered" || answerState.status === "revealed";
  const correctKey = isGraded ? answerState.correct : null;
  const isSelected = answerState.status === "answered" && answerState.selected === letter;
  const isCorrect = correctKey === letter;
  const isWrong = isSelected && !isCorrect;
  const isDimmed = isGraded && !isSelected && !isCorrect;
  const isPending = answerState.status === "selected" && answerState.pending === letter;

  const tileStyle: React.CSSProperties = isCorrect
    ? { border: "1px solid var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
    : isWrong
    ? { border: "1px solid var(--signal)", background: "rgba(197,69,58,0.08)", color: "var(--signal)" }
    : isDimmed
    ? { border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--fg-subtle)", cursor: "default" }
    : isPending
    ? { border: "1px solid var(--accent)", background: "var(--accent-soft)", color: "var(--fg)", cursor: "pointer" }
    : { border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--fg)", cursor: "pointer" };

  const letterStyle: React.CSSProperties = isCorrect
    ? { background: "var(--accent)", color: "var(--bg)" }
    : isWrong
    ? { background: "var(--signal)", color: "#fff" }
    : isDimmed
    ? { background: "var(--border)", color: "var(--fg-subtle)" }
    : isPending
    ? { background: "var(--accent)", color: "var(--bg)" }
    : { background: "var(--border)", color: "var(--fg-muted)" };

  const tile = (
    <div className="group relative">
      <button
        type="button"
        onClick={() => !isGraded && onSelect(letter)}
        onContextMenu={(e) => {
          if (!onToggleStrike) return;
          e.preventDefault();
          onToggleStrike(letter);
        }}
        disabled={isGraded}
        aria-pressed={isPending}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: onToggleStrike ? "14px 44px 14px 16px" : "14px 16px",
          borderRadius: "var(--radius-md)",
          textAlign: "left",
          transition: "all var(--dur-micro) var(--ease-out)",
          ...tileStyle,
          opacity: struck && !isCorrect && !isSelected ? 0.55 : 1,
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
          {letter.toUpperCase()}
        </span>
        <span
          style={{
            fontSize: fs(14),
            lineHeight: 1.6,
            paddingTop: 2,
            textDecoration: struck ? "line-through" : undefined,
          }}
        >
          {text}
        </span>
      </button>
      {onToggleStrike && (
        <button
          type="button"
          onClick={() => onToggleStrike(letter)}
          aria-label={struck ? `Restore option ${letter.toUpperCase()}` : `Strike out option ${letter.toUpperCase()}`}
          title={struck ? "Restore (Shift+" + letter.toUpperCase() + ")" : "Strike out (Shift+" + letter.toUpperCase() + ")"}
          className={`absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md transition-opacity hover:bg-[var(--bg-subtle)] ${
            struck ? "opacity-100" : "opacity-40 group-hover:opacity-100 focus:opacity-100"
          }`}
          style={{ color: "var(--fg-muted)" }}
        >
          {struck ? <Undo2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );

  // Nothing to say until the question is graded, and never for the key — the
  // reason the correct answer is correct is the explanation panel's job.
  if (!isGraded || !explanation || isCorrect) return tile;

  return (
    <div>
      {tile}
      <div
        style={{
          marginTop: 6,
          marginLeft: 40,
          paddingLeft: 12,
          borderLeft: isWrong ? "2px solid var(--signal)" : "2px solid var(--border)",
        }}
      >
        {isWrong && (
          <p style={{ ...MONO_EYEBROW, color: "var(--signal)", marginBottom: 4 }}>Why your answer is wrong</p>
        )}
        <p
          className="[&_strong]:text-foreground [&_strong]:font-semibold"
          style={{ fontSize: fs(12), lineHeight: 1.7, color: "var(--fg-muted)" }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(explanation) }}
        />
      </div>
    </div>
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

/**
 * Live state of the set being written underneath the session.
 *
 * The generation runs behind the player, which means the only honest way to
 * report it is in the player — otherwise a run that stalls or dies is invisible
 * until the student reaches the end and finds the set shorter than they asked
 * for. Silent once a set has been delivered in full.
 */
const GenerationStrip = ({
  generation,
  loaded,
}: {
  generation: GenerationState;
  loaded: number;
}) => {
  const running = generation.status === "running";
  const short = !running && loaded < generation.target;
  if (!running && !short) return null;

  const pct = generation.target > 0 ? Math.round((loaded / generation.target) * 100) : 0;

  // Grouped by reason rather than listed per question. The held-back items are
  // not in the session, so they have no question number the student could match
  // them to.
  const heldBackByReason = generation.heldBackItems.reduce<Record<string, number>>(
    (acc, item) => {
      acc[item.reason] = (acc[item.reason] ?? 0) + 1;
      return acc;
    },
    {}
  );

  return (
    <div
      className="mb-4 rounded-xl px-4 py-3"
      style={{
        border: `1px solid ${short ? "rgba(217,119,6,0.35)" : "var(--border)"}`,
        background: short ? "rgba(217,119,6,0.06)" : "var(--bg-subtle)",
      }}
    >
      <div className="flex items-center gap-2.5">
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: "var(--fg-muted)" }} />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        )}
        <p className="text-xs font-medium" style={{ color: short ? "#d97706" : "var(--fg-muted)" }}>
          {running
            ? `Writing your set — ${loaded} of ${generation.target} ready`
            : `This set ended at ${loaded} of ${generation.target} questions`}
        </p>
        <span
          className="ml-auto tabular-nums text-[11px]"
          style={{ fontFamily: "var(--font-mono)", color: "var(--fg-subtle)" }}
        >
          {loaded}/{generation.target}
        </span>
      </div>

      {running && (
        <div
          className="mt-2 h-1 w-full overflow-hidden rounded-full"
          style={{ background: "var(--border)" }}
          aria-hidden
        >
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{ width: `${pct}%`, background: "var(--accent)" }}
          />
        </div>
      )}

      {/* Why the set is short. The rules name what went wrong without quoting
          the text it went wrong in, which would describe the answer. */}
      {generation.heldBackItems.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5">
          {Object.entries(heldBackByReason).map(([reason, count]) => (
            <li key={reason} className="text-[11px]" style={{ color: "var(--fg-muted)" }}>
              {count} rewritten — {ruleLabel(reason).toLowerCase()}
            </li>
          ))}
        </ul>
      )}

      {!running && generation.error && (
        <p className="mt-1.5 text-[11px]" style={{ color: "var(--fg-muted)" }}>
          {generation.error}
        </p>
      )}
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
    goToQuestion,
    endBlockStats,
    saveState,
  } = useQBankContext();

  const [searchParams] = useSearchParams();
  const sessionIdParam = searchParams.get("session");
  const reviewParam = searchParams.get("review");

  const [pendingKey, setPendingKey] = useState<OptionKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [labsOpen, setLabsOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [exiting, setExiting] = useState(false);
  /** Why the set could not be loaded from the server, when it could not. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Bumped by Try again, to re-run the load. */
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [lightboxItems, setLightboxItems] = useState<QuestionMedia[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomOffset, setZoomOffset] = useState({ x: 0, y: 0 });
  const lightboxOpen = lightboxItems.length > 0;
  const currentLightboxItem = lightboxItems[lightboxIndex] ?? null;
  const font = useQBankFontScale();
  const loadStartedRef = useRef<string | null>(null);

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

  // A tutor pick is per question; moving on forgets it.
  const questionId = displayQuestion?.id ?? null;
  useEffect(() => {
    setPendingKey(null);
    setDrawerOpen(false);
  }, [questionId]);

  // ── Lightbox ──────────────────────────────────────────────────────────────

  const closeLightbox = useCallback(() => {
    setLightboxItems([]);
    setZoomScale(1);
    setZoomOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') { setLightboxIndex((i) => Math.min(i + 1, lightboxItems.length - 1)); setZoomScale(1); setZoomOffset({ x: 0, y: 0 }); }
      if (e.key === 'ArrowLeft') { setLightboxIndex((i) => Math.max(i - 1, 0)); setZoomScale(1); setZoomOffset({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxOpen, lightboxItems.length, closeLightbox]);

  const openLightbox = useCallback((items: QuestionMedia[], idx: number) => {
    setLightboxItems(items);
    setLightboxIndex(idx);
  }, []);

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

  const isGraded = answerState.status === "answered" || answerState.status === "revealed";
  const canMark = inSession && !isGraded;

  const handleSelect = useCallback(
    (key: OptionKey) => {
      if (!inSession || isGraded) return;
      if (mode === "timed") selectTimedAnswer(key);
      else setPendingKey(key);
    },
    [inSession, isGraded, mode, selectTimedAnswer]
  );

  const handleConfirm = useCallback(async () => {
    if (mode !== "tutor" || !pendingKey || submitting || isGraded) return;
    setSubmitting(true);
    try {
      const result = await submitAnswer(pendingKey);
      if (!result) {
        toast({ title: "Could not check that answer", description: "Try again in a moment.", variant: "destructive" });
        return;
      }
      setPendingKey(null);
      setTimeout(() => setDrawerOpen(true), 300);
    } finally {
      setSubmitting(false);
    }
  }, [mode, pendingKey, submitting, isGraded, submitAnswer, toast]);

  // ── Navigation ────────────────────────────────────────────────────────────

  const loadedCount = isReviewing ? lastSummary?.questions.length ?? 0 : session?.questions.length ?? 0;
  const position = isReviewing ? reviewIndex ?? 0 : currentIndex;
  const canPrev = position > 0;
  const canNext = position < loadedCount - 1;

  const handlePrev = useCallback(() => {
    setDrawerOpen(false);
    if (isReviewing) {
      if (reviewIndex! > 0) setReviewIndex(reviewIndex! - 1);
    } else prevQuestion();
  }, [isReviewing, reviewIndex, setReviewIndex, prevQuestion]);

  const handleNext = useCallback(() => {
    setDrawerOpen(false);
    if (isReviewing) {
      if (reviewIndex! + 1 < loadedCount) setReviewIndex(reviewIndex! + 1);
    } else nextQuestion();
  }, [isReviewing, reviewIndex, loadedCount, setReviewIndex, nextQuestion]);

  const handleEndBlock = useCallback(async () => {
    if (ending) return;
    setEnding(true);
    try {
      await endSession();
    } finally {
      setEnding(false);
      setEndDialogOpen(false);
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

  // ── Keyboard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (lightboxOpen || endDialogOpen || shortcutsOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      // A held key repeats. Every shortcut here is a one-shot action — and for
      // toggles (flag, strike, panels) a repeat flips them back and forth.
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
      if (e.key === "Enter" && pendingKey && mode === "tutor" && inSession) {
        e.preventDefault();
        void handleConfirm();
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
        setLabsOpen((o) => !o);
      } else if (k === "k") {
        e.preventDefault();
        setCalcOpen((o) => !o);
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    lightboxOpen,
    endDialogOpen,
    shortcutsOpen,
    displayQuestion,
    canMark,
    toggleStrike,
    handleSelect,
    pendingKey,
    mode,
    inSession,
    handleConfirm,
    canNext,
    canPrev,
    handleNext,
    handlePrev,
    toggleFlag,
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
        <div className="mx-auto mt-16 max-w-sm space-y-3 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-amber-500" />
          <p className="text-sm font-medium" style={{ color: "var(--fg)" }}>
            This set couldn’t be loaded.
          </p>
          <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
            {loadError}
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button type="button" onClick={retry} disabled={retrying} style={darkButtonStyle(retrying)}>
              {retrying && <Loader2 className="h-4 w-4 animate-spin" />}
              Try again
            </button>
            <button type="button" onClick={() => navigate("/qbank")} style={outlineButtonStyle()}>
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

  const cells: GridCell[] = isReviewing
    ? (lastSummary?.questions ?? []).map((sq, i) => {
        const a = lastSummary?.answers.find((x) => x.question_id === sq.id);
        return {
          kind: a ? (a.is_correct ? "correct" : "incorrect") : "unanswered",
          current: i === reviewIndex,
          flagged: (lastSummary?.flaggedIds ?? []).includes(sq.id),
        };
      })
    : Array.from({ length: totalQuestions }, (_, i) => {
        const sq = session?.questions[i];
        if (!sq) return { kind: "unwritten" as const, current: false, flagged: false };
        const a = session!.answers.find((x) => x.question_id === sq.id);
        const kind: CellKind =
          mode === "timed"
            ? session!.selections[sq.id]
              ? "answered"
              : session!.skippedIds.includes(sq.id)
                ? "skipped"
                : "unanswered"
            : a
              ? a.is_correct
                ? "correct"
                : "incorrect"
              : session!.skippedIds.includes(sq.id)
                ? "skipped"
                : "unanswered";
        return { kind, current: i === currentIndex, flagged: flaggedIds.has(sq.id) };
      });

  const onGridSelect = (i: number) => {
    setDrawerOpen(false);
    if (isReviewing) setReviewIndex(i);
    else goToQuestion(i);
  };

  const answeredCount = session ? (mode === "timed" ? Object.keys(session.selections).length : session.answers.length) : 0;
  const showExplanation = isGraded && (isReviewing || mode === "tutor");
  const struckKeys = (session?.annotations.struck[q.id] ?? []) as OptionKey[];
  const highlights = session?.annotations.highlights[q.id] ?? [];
  const isFlagged = flaggedIds.has(q.id);
  const atEndOfWritten = inSession && currentIndex >= (session?.questions.length ?? 0) - 1;

  const explanationProps = showExplanation
    ? {
        explanation: q.explanation ?? "",
        teachingPoint: q.teaching_point ?? "",
        difficulty: q.difficulty as Difficulty,
        isCorrect: answerState.status === "answered" ? answerState.isCorrect : null,
        media: q.media,
        onOpenLightbox: openLightbox,
        domain: q.domain,
      }
    : null;

  /** Next, or End block when there is nothing after this one. */
  const primaryNav = (fullWidth = false) => {
    const size: React.CSSProperties = fullWidth ? { width: "100%", height: 44 } : {};
    if (isWaitingForNext || (atEndOfWritten && isAwaitingMore)) {
      return (
        <div
          className="flex items-center gap-2.5 rounded-xl px-4 py-3"
          style={{ border: "1px solid var(--border)", background: "var(--bg-subtle)", ...size, height: undefined }}
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: "var(--fg-muted)" }} />
          <p className="text-xs font-medium" style={{ color: "var(--fg-muted)" }}>
            Writing question {(session?.questions.length ?? 0) + 1} of {totalQuestions}… it appears here in a moment
            {mode === "timed" ? " — your clock is paused." : "."}
          </p>
        </div>
      );
    }
    if (atEndOfWritten) {
      return (
        <button type="button" onClick={() => setEndDialogOpen(true)} style={{ ...darkButtonStyle(), ...size }}>
          End block
        </button>
      );
    }
    return (
      <button type="button" onClick={handleNext} style={{ ...darkButtonStyle(), ...size }}>
        Next question <ArrowRight style={{ width: 16, height: 16 }} />
      </button>
    );
  };

  return (
    <DashboardLayout wide>
      <div style={{ ["--qb-scale" as string]: font.scale } as React.CSSProperties}>
        {isReviewing ? (
          <div className="flex items-center justify-between mb-4 px-3 py-2 rounded-xl bg-primary/5 border border-primary/20">
            <button
              onClick={() => {
                setReviewIndex(null);
                navigate(sessionIdParam ? `/qbank/summary?session=${sessionIdParam}` : "/qbank/summary");
              }}
              className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
            >
              ← Back to Summary
            </button>
            <span className="text-xs font-semibold text-primary">
              Reviewing Q{displayedNumber} of {totalForDisplay} — read only
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={handlePrev}
                disabled={!canPrev}
                className="text-xs font-semibold text-primary hover:text-primary/80 disabled:opacity-30 transition-colors"
              >
                ← Prev
              </button>
              <button
                onClick={handleNext}
                disabled={!canNext}
                className="text-xs font-semibold text-primary hover:text-primary/80 disabled:opacity-30 transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        ) : (
          session && (
            <PlayerToolbar
              mode={mode}
              displayedNumber={displayedNumber}
              total={totalQuestions}
              getElapsedMs={getElapsedMs}
              getTimeRemainingMs={getTimeRemainingMs}
              clockPaused={!session.clockRunning}
              onTimeUp={handleTimeUp}
              canPrev={canPrev}
              canNext={canNext}
              onPrev={handlePrev}
              onNext={handleNext}
              isFlagged={isFlagged}
              onFlag={() => void toggleFlag(q.id)}
              labsOpen={labsOpen}
              onToggleLabs={() => setLabsOpen((o) => !o)}
              calcOpen={calcOpen}
              onCalcOpenChange={setCalcOpen}
              fontStep={font.step}
              maxFontStep={font.maxStep}
              onFontStep={font.change}
              onShortcuts={() => setShortcutsOpen(true)}
              saving={exiting}
              saveState={saveState}
              onSaveExit={handleSaveExit}
              onEndBlock={() => setEndDialogOpen(true)}
              mobileNavigator={
                <QuestionNavigator cells={cells} onSelect={onGridSelect} displayedNumber={displayedNumber} mode={mode} />
              }
            />
          )
        )}

        {session?.generation && generation && !isReviewing && (
          <GenerationStrip generation={generation} loaded={session.questions.length} />
        )}

        <div className="flex gap-3 items-start">
          {cells.length > 0 && <QuestionCounter cells={cells} onSelect={onGridSelect} />}

          <div className="flex-1 min-w-0 flex gap-6 items-start">
            <div
              key={isReviewing ? `review-${reviewIndex}` : `question-${q.id}`}
              className={`question-enter flex-1 min-w-0 space-y-5 ${explanationProps ? "pb-16 lg:pb-0" : ""}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
                  {q.subject}
                </span>
                {isReviewing && (
                  <QuestionNavigator
                    cells={cells}
                    onSelect={onGridSelect}
                    displayedNumber={displayedNumber}
                    mode="review"
                  />
                )}
                {inSession && isFlagged && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    <Flag className="h-3 w-3" fill="currentColor" /> Flagged
                  </span>
                )}
              </div>

              {/* Session progress fill */}
              {totalForDisplay > 0 && !isReviewing && (
                <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: "var(--border)" }} aria-hidden>
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: `${(answeredCount / totalForDisplay) * 100}%`,
                      background: "var(--accent)",
                    }}
                  />
                </div>
              )}

              <div
                style={{
                  border: "1px solid var(--border)",
                  borderLeft: "3px solid var(--accent)",
                  borderRadius: "var(--radius-md)",
                  background: "var(--bg-elevated)",
                  padding: "20px 20px 24px",
                }}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p style={MONO_EYEBROW}>Clinical vignette</p>
                  {inSession && (
                    <p className="hidden text-[10px] sm:block" style={{ color: "var(--fg-subtle)" }}>
                      Select text to highlight
                    </p>
                  )}
                </div>
                <HighlightableText
                  text={q.question_text}
                  ranges={highlights}
                  onAdd={inSession ? (range) => addHighlight(q.id, range, q.question_text.length) : undefined}
                  onRemove={inSession ? (offset) => removeHighlight(q.id, offset) : undefined}
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: fs(15),
                    lineHeight: 1.75,
                    color: "var(--fg)",
                  }}
                />
              </div>

              {q.media && q.media.length > 0 && (
                <MediaBlock media={q.media} context="stem" onOpen={openLightbox} />
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                <span style={{ ...MONO_EYEBROW, letterSpacing: "0.1em" }}>
                  {mode === "timed" && inSession ? "Choose one answer — you can change it" : "Select one answer"}
                </span>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>

              <div className="space-y-2.5">
                {OPTION_KEYS.map((key) => (
                  <OptionTile
                    key={key}
                    letter={key}
                    text={q[`option_${key}` as const]}
                    explanation={showExplanation ? q.distractor_explanations?.[key] : undefined}
                    answerState={answerState}
                    struck={struckKeys.includes(key)}
                    onToggleStrike={canMark ? (k) => toggleStrike(q.id, k) : undefined}
                    onSelect={handleSelect}
                  />
                ))}
              </div>

              {inSession && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button type="button" onClick={handlePrev} disabled={!canPrev} style={outlineButtonStyle(!canPrev)}>
                    <ArrowLeft style={{ width: 16, height: 16 }} /> Previous
                  </button>

                  {mode === "tutor" && answerState.status === "selected" ? (
                    <button
                      type="button"
                      onClick={handleConfirm}
                      disabled={submitting}
                      style={darkButtonStyle(submitting)}
                      className="animate-fade-in"
                    >
                      <CheckCircle style={{ width: 16, height: 16 }} />
                      {submitting ? "Checking…" : "Confirm Answer"}
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">{primaryNav()}</div>
                  )}
                </div>
              )}
            </div>

            <div
              className={`hidden lg:flex flex-col w-80 xl:w-96 shrink-0 transition-all duration-300 ${
                showExplanation ? "opacity-100 translate-x-0" : "opacity-0 pointer-events-none translate-x-4"
              }`}
            >
              {explanationProps && (
                <div
                  className="animate-fade-in sticky top-20"
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-lg)",
                    background: "var(--bg-elevated)",
                    padding: 20,
                  }}
                >
                  <ExplanationContent {...explanationProps} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile explanation drawer. */}
        {explanationProps && (
          <div className={`lg:hidden fixed inset-x-0 bottom-0 ${isReviewing ? "z-40" : "z-50"}`}>
            <div
              className={`fixed inset-0 bg-black/40 transition-opacity duration-300 ${
                drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
              onClick={() => setDrawerOpen(false)}
            />

            <div
              className={`relative bg-card border-t border-border/60 rounded-t-2xl transition-transform duration-300 ease-out ${
                drawerOpen ? "translate-y-0" : "translate-y-[calc(100%-48px)]"
              }`}
            >
              <button
                onClick={() => setDrawerOpen((o) => !o)}
                className="w-full flex flex-col items-center gap-1 pt-3 pb-2 px-4"
              >
                <div className="w-10 h-1 rounded-full bg-border/60" />
                <div className="flex items-center justify-between w-full mt-1">
                  <span className="text-[11px] font-semibold tracking-wider text-primary uppercase">Explanation</span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${drawerOpen ? "rotate-0" : "rotate-180"}`}
                  />
                </div>
              </button>

              <div className="px-4 pb-6 max-h-[60vh] overflow-y-auto">
                <ExplanationContent {...explanationProps} />
                {inSession && <div className="pt-4">{primaryNav(true)}</div>}
              </div>
            </div>
          </div>
        )}
      </div>

      {inSession && session && (
        <>
          <EndBlockDialog
            open={endDialogOpen}
            onOpenChange={setEndDialogOpen}
            stats={endBlockStats}
            mode={mode}
            ending={ending}
            onConfirm={handleEndBlock}
          />
          <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} mode={mode} />
        </>
      )}
      <LabValuesSheet open={labsOpen} onOpenChange={setLabsOpen} />

      {lightboxOpen && currentLightboxItem && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85"
          onClick={closeLightbox}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white text-3xl font-light leading-none z-10"
            onClick={closeLightbox}
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
