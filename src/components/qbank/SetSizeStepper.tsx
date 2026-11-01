import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";

/** Sizes offered as one tap; 20 is the USMLE block. */
const QUESTION_PRESETS = [5, 10, 20];

const STEP_BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50";
const PRESET_BASE =
  "inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const PRESET_ON = "bg-primary border-primary text-primary-foreground";
const PRESET_OFF = "bg-card border-border text-muted-foreground hover:border-primary hover:text-primary";

/**
 * How many questions a set has: any number from one to `max`.
 *
 * It used to be four pills, 5 · 10 · 15 · 20, and students asked for the
 * numbers in between. The box takes what is typed and settles it into range
 * when it loses focus, so clearing it to type a new number never snaps back
 * mid-keystroke; the presets keep the common sizes one tap away.
 */
const SetSizeStepper = ({
  value,
  max,
  min = 1,
  onChange,
  disabled,
  presets = QUESTION_PRESETS,
  unit = "question",
}: {
  value: number;
  /** The largest set allowed today — the block for Pro, what is left for a free account. */
  max: number;
  /** The smallest set — a deck mixed across topics needs a few cards each. */
  min?: number;
  onChange: (size: number) => void;
  disabled?: boolean;
  /** One-tap sizes; those outside min–max are left out. */
  presets?: readonly number[];
  /** What is being counted, for the labels: "question" or "card". */
  unit?: string;
}) => {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const commit = () => {
    const n = Number.parseInt(text, 10);
    const next = Number.isFinite(n) ? clamp(n) : value;
    setText(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1.5">
        <button
          type="button"
          className={STEP_BUTTON}
          onClick={() => onChange(clamp(value - 1))}
          disabled={disabled || value <= min}
          aria-label={`One fewer ${unit}`}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          disabled={disabled}
          aria-label={`${unit[0].toUpperCase()}${unit.slice(1)}s, ${min} to ${max}`}
          className="h-8 w-14 rounded-lg border border-border bg-card text-center text-sm font-semibold tabular-nums text-foreground [appearance:textfield] focus:border-primary focus:outline-none disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          className={STEP_BUTTON}
          onClick={() => onChange(clamp(value + 1))}
          disabled={disabled || value >= max}
          aria-label={`One more ${unit}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {presets.filter((p) => p >= min && p <= max).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          disabled={disabled}
          aria-pressed={p === value}
          className={`${PRESET_BASE} ${p === value ? PRESET_ON : PRESET_OFF}`}
        >
          {p}
        </button>
      ))}
    </div>
  );
};

export default SetSizeStepper;
