import { forwardRef, useEffect, useRef, useState } from "react";
import {
  AArrowDown,
  AArrowUp,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Clock,
  CloudOff,
  Flag,
  FlaskConical,
  Keyboard,
  Loader2,
  LogOut,
  MoreHorizontal,
  Square,
  Timer,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import QBankCalculator from "./QBankCalculator";
import type { PlayMode } from "@/lib/qbank-types";

const formatClock =(ms: number): string => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

/**
 * The block clock. Ticks on its own so the rest of the player does not re-render
 * every second. Tutor mode counts up; timed mode counts down and calls onTimeUp
 * once when it reaches zero.
 */
const SessionClock = ({
  mode,
  getElapsedMs,
  getTimeRemainingMs,
  paused,
  onTimeUp,
}: {
  mode: PlayMode;
  getElapsedMs: () => number;
  getTimeRemainingMs: () => number | null;
  paused: boolean;
  onTimeUp?: () => void;
}) => {
  const [, setTick] = useState(0);
  const firedRef = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remaining = mode === "timed" ? getTimeRemainingMs() : null;

  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !firedRef.current) {
      firedRef.current = true;
      onTimeUp?.();
    }
  });

  const tone =
    remaining === null
      ? "var(--fg-muted)"
      : remaining < 60_000
        ? "#dc2626"
        : remaining < 5 * 60_000
          ? "#d97706"
          : "var(--fg-muted)";

  const Icon = mode === "timed" ? Timer : Clock;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium tabular-nums"
      style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: tone }}
      title={
        paused
          ? "Paused while the next question is written"
          : mode === "timed"
            ? "Time remaining in this block"
            : "Time in this set"
      }
    >
      <Icon className="h-3 w-3" />
      {formatClock(remaining ?? getElapsedMs())}
      {paused && <span style={{ color: "var(--fg-subtle)" }}>· paused</span>}
    </span>
  );
};

type ToolButtonProps = {
  label: string;
  active?: boolean;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

// Forwards its ref: it is used as a Radix PopoverTrigger, which positions the
// popover from the trigger's DOM node.
const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(
  ({ label, active, children, className = "", ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      // A click must not leave focus on the button. Focused, it takes the next
      // Enter or Space — the keys a student presses to confirm an answer — and
      // clicks itself again: Flag, then Enter to confirm, silently unflagged.
      // Tab still focuses it for keyboard users.
      onMouseDown={(e) => e.preventDefault()}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      style={
        active
          ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
          : { borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--fg-muted)" }
      }
      {...rest}
    >
      {children}
    </button>
  )
);
ToolButton.displayName = "ToolButton";

export interface PlayerToolbarProps {
  mode: PlayMode;
  displayedNumber: number;
  total: number;
  getElapsedMs: () => number;
  getTimeRemainingMs: () => number | null;
  clockPaused: boolean;
  onTimeUp: () => void;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  isFlagged: boolean;
  onFlag: () => void;
  labsOpen: boolean;
  onToggleLabs: () => void;
  calcOpen: boolean;
  onCalcOpenChange: (open: boolean) => void;
  fontStep: number;
  maxFontStep: number;
  onFontStep: (delta: number) => void;
  onShortcuts: () => void;
  saving: boolean;
  /** Progress save state; an error means the last save failed and is retrying. */
  saveState?: "idle" | "saving" | "error";
  onSaveExit: () => void;
  onEndBlock: () => void;
  /** The question navigator trigger for small screens. */
  mobileNavigator?: React.ReactNode;
}

const PlayerToolbar = (p: PlayerToolbarProps) => {
  const fontControls = (
    <>
      <ToolButton label="Smaller text" onClick={() => p.onFontStep(-1)} disabled={p.fontStep <= 0}>
        <AArrowDown className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton label="Larger text" onClick={() => p.onFontStep(1)} disabled={p.fontStep >= p.maxFontStep}>
        <AArrowUp className="h-3.5 w-3.5" />
      </ToolButton>
    </>
  );

  return (
    <div
      className="sticky top-0 z-30 -mx-1 mb-4 flex flex-wrap items-center gap-2 rounded-xl px-2 py-2 backdrop-blur"
      style={{
        border: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--bg) 88%, transparent)",
      }}
    >
      <span
        className="hidden items-center rounded-full border px-3 py-1 text-[11px] font-medium tabular-nums md:inline-flex"
        style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--fg-muted)" }}
      >
        Q{p.displayedNumber} of {p.total}
      </span>
      {p.mobileNavigator}

      <span
        className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
        style={
          p.mode === "timed"
            ? { background: "rgba(217,119,6,0.12)", color: "#d97706" }
            : { background: "var(--accent-soft)", color: "var(--accent)" }
        }
      >
        {p.mode === "timed" ? "Timed" : "Tutor"}
      </span>

      <SessionClock
        mode={p.mode}
        getElapsedMs={p.getElapsedMs}
        getTimeRemainingMs={p.getTimeRemainingMs}
        paused={p.clockPaused}
        onTimeUp={p.onTimeUp}
      />

      <div className="flex items-center gap-1">
        <ToolButton label="Previous question (←)" onClick={p.onPrev} disabled={!p.canPrev}>
          <ChevronLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Prev</span>
        </ToolButton>
        <ToolButton label="Next question (→)" onClick={p.onNext} disabled={!p.canNext}>
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </ToolButton>
      </div>

      <ToolButton
        label={p.isFlagged ? "Unflag question (F)" : "Flag for review (F)"}
        onClick={p.onFlag}
        active={p.isFlagged}
        className={p.isFlagged ? "!border-amber-500/50 !bg-amber-500/10 !text-amber-600 dark:!text-amber-400" : ""}
      >
        <Flag className="h-3.5 w-3.5" fill={p.isFlagged ? "currentColor" : "none"} />
        <span className="hidden sm:inline">{p.isFlagged ? "Flagged" : "Flag"}</span>
      </ToolButton>

      {/* Study tools: inline from md up, folded into a menu below that. */}
      <div className="hidden items-center gap-1 md:flex">
        <ToolButton label="Lab values (L)" onClick={p.onToggleLabs} active={p.labsOpen}>
          <FlaskConical className="h-3.5 w-3.5" /> Labs
        </ToolButton>
        <Popover open={p.calcOpen} onOpenChange={p.onCalcOpenChange}>
          <PopoverTrigger asChild>
            <ToolButton label="Calculator (K)" active={p.calcOpen}>
              <Calculator className="h-3.5 w-3.5" /> Calc
            </ToolButton>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-3">
            <QBankCalculator />
          </PopoverContent>
        </Popover>
        {fontControls}
        <ToolButton label="Keyboard shortcuts (?)" onClick={p.onShortcuts}>
          <Keyboard className="h-3.5 w-3.5" />
        </ToolButton>
      </div>

      <div className="md:hidden">
        <Popover>
          <PopoverTrigger asChild>
            <ToolButton label="More tools">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </ToolButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-auto flex-wrap gap-1.5 p-2">
            <ToolButton label="Lab values" onClick={p.onToggleLabs} active={p.labsOpen}>
              <FlaskConical className="h-3.5 w-3.5" /> Labs
            </ToolButton>
            <ToolButton label="Calculator" onClick={() => p.onCalcOpenChange(!p.calcOpen)} active={p.calcOpen}>
              <Calculator className="h-3.5 w-3.5" /> Calc
            </ToolButton>
            {fontControls}
          </PopoverContent>
        </Popover>
      </div>

      <div className="ml-auto flex items-center gap-1">
        {p.saveState === "error" && (
          <span
            role="status"
            className="inline-flex items-center gap-1 px-1 text-[11px] font-medium"
            style={{ color: "#d97706" }}
            title="Your latest changes (flags, highlights, position) haven't reached the server yet. Retrying."
          >
            <CloudOff className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Not saved — retrying</span>
          </span>
        )}
        <ToolButton label="Save and exit — resume later" onClick={p.onSaveExit} disabled={p.saving}>
          {p.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">Save &amp; Exit</span>
        </ToolButton>
        <button
          type="button"
          onClick={p.onEndBlock}
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition-opacity hover:opacity-85"
          style={{ background: "var(--fg)", color: "var(--bg)" }}
        >
          <Square className="h-3 w-3" fill="currentColor" />
          End block
        </button>
      </div>
    </div>
  );
};

export default PlayerToolbar;
