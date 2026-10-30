import { useEffect, useState } from "react";
import { Check, Loader2, Lightbulb } from "lucide-react";
import type { GenerationState } from "@/contexts/QBankContext";
import type { ExamTarget } from "@/lib/qbank-suggestions";
import { EXAM_THEME, tipsFor } from "@/lib/qbank-exam-theme";
import { WRITING_STAGES, stageIndex, type WritingStage } from "@/lib/qbank-writing-stage";
import LabLightning from "./LabLightning";

/** A first question runs to roughly this many characters of JSON. */
const TYPICAL_ITEM_CHARS = 4500;

const STEP_LABEL: Record<string, string> = { "1st": "1-step", "2nd": "2-step", "3rd": "3-step" };

/**
 * The twenty-odd seconds before a set's first question exists.
 *
 * Three things, each for a reason (docs/qbank/topic-selection-ux.md §10):
 *  - real progress — the stage the writer is at with question one, read off
 *    the stream by field name, never content — because an explained wait
 *    feels shorter than an uncertain one;
 *  - the set's blueprint — topics and reasoning steps — so the student knows
 *    what is coming;
 *  - something to do: a lab-values round and an exam tip, because occupied
 *    time passes faster than empty time.
 * The page opens the session the moment question one is ready, as before.
 */
const WritingOverlay = ({
  open,
  target,
  generation,
  elapsed,
  size,
  topics,
  onCancel,
}: {
  open: boolean;
  target: ExamTarget;
  generation: GenerationState | null;
  elapsed: number;
  size: number;
  topics: string[];
  onCancel: () => void;
}) => {
  const theme = EXAM_THEME[target];
  const tips = tipsFor(target);
  const [tip, setTip] = useState(() => Math.floor(Math.random() * tips.length));

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setTip((t) => (t + 1) % tips.length), 8000);
    return () => window.clearInterval(id);
  }, [open, tips.length]);

  if (!open) return null;

  const routed = !!generation?.systemName;
  const stage: WritingStage = generation?.writing?.stage ?? (routed ? "planning" : "routing");
  const at = stageIndex(stage);

  // A bar that never runs backwards and never sits still: stage gives the
  // floor, characters written move it within the writing stages.
  const chars = generation?.writing?.chars ?? 0;
  const byStage = at / (WRITING_STAGES.length - 1);
  const byChars = at >= 2 && at <= 5 ? 0.25 + Math.min(1, chars / TYPICAL_ITEM_CHARS) * 0.62 : 0;
  const fraction = Math.min(stage === "checking" ? 0.96 : 0.9, Math.max(0.04, byStage, byChars));

  const blueprint = generation?.blueprint ?? [];
  const focuses = generation?.focuses ?? (topics.length === 1 ? [{ topic: topics[0], systemName: generation?.systemName ?? "" }] : []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="qb-writing-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-background/95 backdrop-blur-sm animate-fade-in"
    >
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center gap-5 px-4 py-8">
        <div>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${theme.badge}`}>
            {theme.label} · {theme.tagline}
          </span>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <h2 id="qb-writing-title" className="text-xl font-semibold text-foreground">
              Writing your first question
            </h2>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{elapsed}s · usually 20–30s</span>
          </div>

          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{ width: `${Math.round(fraction * 100)}%`, background: theme.hsl }}
            />
          </div>

          <ol className="mt-3 grid gap-1.5" aria-label="Progress">
            {WRITING_STAGES.map((s, i) => {
              const done = i < at;
              const active = i === at;
              return (
                <li key={s.id} className="flex items-center gap-2.5 text-sm">
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                      done ? theme.icon : active ? "border-2 border-current" : "border border-border"
                    } ${active ? theme.text : "text-muted-foreground"}`}
                  >
                    {done ? (
                      <Check className="h-3 w-3" strokeWidth={3} />
                    ) : active ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : null}
                  </span>
                  <span className={done || active ? "text-foreground" : "text-muted-foreground"}>{s.label}</span>
                  {s.id === "routing" && routed && (
                    <span className="ml-auto truncate text-xs text-muted-foreground">{generation?.systemName}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {/* The set's blueprint — topics and reasoning steps, nothing more. */}
        {(blueprint.length > 0 || focuses.length > 0) && (
          <div className="rounded-2xl border border-border bg-[color:var(--color-card)] p-4">
            <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Your set · {size} question{size === 1 ? "" : "s"}
            </p>
            {focuses.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {focuses.map((f) => (
                  <li key={f.topic} className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground">
                    {f.topic}
                    {f.systemName && f.systemName !== f.topic && (
                      <span className="ml-1 text-muted-foreground">· {f.systemName}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {blueprint.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                First wave:{" "}
                {blueprint
                  .map((b) => `Q${b.index} ${STEP_LABEL[b.reasoningOrder] ?? b.reasoningOrder}${b.focus ? ` (${b.focus})` : ""}`)
                  .join(" · ")}
              </p>
            )}
          </div>
        )}

        <LabLightning />

        <p className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground" aria-live="polite">
          <Lightbulb className={`mt-0.5 h-4 w-4 shrink-0 ${theme.text}`} aria-hidden />
          <span>
            <span className="font-medium text-foreground">{theme.label === "Both" ? "Exam tip" : `${theme.label} tip`}:</span>{" "}
            {tips[tip]}
          </span>
        </p>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={onCancel}
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Cancel this set
          </button>
        </div>
      </div>
    </div>
  );
};

export default WritingOverlay;
