import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Flame, X } from "lucide-react";
import { makeLabQuizItem, type LabQuizItem, type LabVerdict } from "@/lib/lab-quiz";

const CHOICES: { id: LabVerdict; label: string; key: string }[] = [
  { id: "low", label: "Low", key: "1" },
  { id: "normal", label: "Normal", key: "2" },
  { id: "high", label: "High", key: "3" },
];

/**
 * A lab-values lightning round for the wait: one value, three buttons, the
 * reference range after the tap, the next one a beat later. Keys 1-3 answer.
 * Nothing is saved — it is a warm-up, not a score anyone keeps.
 */
const LabLightning = ({ autoFocus = true }: { autoFocus?: boolean }) => {
  const [item, setItem] = useState<LabQuizItem>(() => makeLabQuizItem());
  const [picked, setPicked] = useState<LabVerdict | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0, streak: 0 });
  const firstRef = useRef<HTMLButtonElement>(null);
  const nextTimer = useRef<number | null>(null);

  useEffect(() => {
    if (autoFocus) firstRef.current?.focus();
    return () => {
      if (nextTimer.current) window.clearTimeout(nextTimer.current);
    };
  }, [autoFocus]);

  const next = useCallback(() => {
    if (nextTimer.current) window.clearTimeout(nextTimer.current);
    setItem(makeLabQuizItem());
    setPicked(null);
  }, []);

  const answer = useCallback(
    (v: LabVerdict) => {
      if (picked) return;
      setPicked(v);
      const right = v === item.answer;
      setScore((s) => ({ right: s.right + (right ? 1 : 0), total: s.total + 1, streak: right ? s.streak + 1 : 0 }));
      nextTimer.current = window.setTimeout(next, right ? 1100 : 2200);
    },
    [picked, item.answer, next]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = CHOICES.find((x) => x.key === e.key);
      if (c) answer(c.id);
      else if (picked && (e.key === "Enter" || e.key === " ")) next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, next, picked]);

  const right = picked === item.answer;

  return (
    <div className="rounded-2xl border border-border bg-[color:var(--color-card)] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Warm-up · high, low or normal?
        </p>
        <p className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {score.streak >= 3 && <Flame className="h-3.5 w-3.5 text-warning" aria-hidden />}
          {score.right}/{score.total}
        </p>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        {item.range.name}
        {item.range.note ? ` · ${item.range.note}` : ""}
      </p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground">
        {item.valueLabel}
        {item.range.unit && <span className="ml-1.5 text-sm font-normal text-muted-foreground">{item.range.unit}</span>}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {CHOICES.map((c, i) => {
          const isAnswer = picked !== null && c.id === item.answer;
          const isWrongPick = picked === c.id && !right;
          return (
            <button
              key={c.id}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              onClick={() => answer(c.id)}
              disabled={picked !== null}
              aria-keyshortcuts={c.key}
              className={`flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors ${
                isAnswer
                  ? "border-success bg-success-soft text-success"
                  : isWrongPick
                    ? "border-danger bg-danger-soft text-danger"
                    : "border-border text-foreground hover:border-primary disabled:opacity-60"
              }`}
            >
              {isAnswer && <Check className="h-4 w-4" aria-hidden />}
              {isWrongPick && <X className="h-4 w-4" aria-hidden />}
              {c.label}
            </button>
          );
        })}
      </div>

      <p className="mt-2 min-h-[1.25rem] text-xs text-muted-foreground" role="status">
        {picked
          ? `${right ? "Right" : "Not quite"} — normal is ${item.range.label}.`
          : "Tap, or press 1 · 2 · 3."}
      </p>
    </div>
  );
};

export default LabLightning;
