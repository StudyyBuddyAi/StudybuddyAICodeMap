import type { ChallengeLevel } from "@/lib/qbank-types";
import { CHALLENGE_LABELS } from "@/lib/qbank-types";

/**
 * The difficulty dial as a scale that reads left to right, easier to harder.
 *
 * It used to be three pills that wrapped onto two rows, so nothing said which
 * was easy and which was hard. Each step now carries its rank in three ways —
 * position on one row, signal bars, and a colour ramp under a track labelled
 * Easier → Harder — and says what it means in one line.
 */
const STEPS: {
  id: ChallengeLevel;
  bars: number;
  rank: string;
  line: string;
  on: string;
  bar: string;
}[] = [
  {
    id: "foundations",
    bars: 1,
    rank: "Easier",
    line: "Single-step: recognise it, name it.",
    on: "border-success bg-success-soft",
    bar: "bg-success",
  },
  {
    id: "balanced",
    bars: 2,
    rank: "Exam level",
    line: "Like the real exam — about 65–70% correct.",
    on: "border-warning bg-warning-soft",
    bar: "bg-warning",
  },
  {
    id: "challenge",
    bars: 3,
    rank: "Harder",
    line: "Multi-step reasoning and close look-alikes.",
    on: "border-danger bg-danger-soft",
    bar: "bg-danger",
  },
];

const Bars = ({ filled, tone }: { filled: number; tone: string }) => (
  <span className="flex h-4 items-end gap-0.5" aria-hidden>
    {[1, 2, 3].map((n) => (
      <span
        key={n}
        className={`w-1.5 rounded-sm ${n <= filled ? tone : "bg-border"}`}
        style={{ height: `${n * 33}%` }}
      />
    ))}
  </span>
);

const DifficultyScale = ({
  value,
  onChange,
  disabled,
}: {
  value: ChallengeLevel;
  onChange: (level: ChallengeLevel) => void;
  disabled?: boolean;
}) => (
  <div>
    <div role="radiogroup" aria-label="Difficulty, from easier to harder" className="grid grid-cols-3 gap-2">
      {STEPS.map((s) => {
        const on = value === s.id;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(s.id)}
            className={`flex flex-col gap-1.5 rounded-xl border-2 p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              on ? s.on : "border-border hover:border-muted-foreground/40"
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">{CHALLENGE_LABELS[s.id]}</span>
              <Bars filled={s.bars} tone={on ? s.bar : "bg-muted-foreground"} />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s.rank}</span>
            <span className="hidden text-xs leading-snug text-muted-foreground sm:block">{s.line}</span>
          </button>
        );
      })}
    </div>
    {/* The track: the ramp itself, so the direction is never in doubt. */}
    <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground" aria-hidden>
      <span>Easier</span>
      <span className="h-1 flex-1 rounded-full bg-gradient-to-r from-success via-warning to-danger opacity-70" />
      <span>Harder</span>
    </div>
  </div>
);

export default DifficultyScale;
