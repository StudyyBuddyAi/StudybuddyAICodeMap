import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { ArrowDown, ArrowUp, Check, Flame, X } from "lucide-react";
import { SWAP } from "@/lib/motion";
import type { WarmupQuestion } from "@/lib/sheet-outline";

/**
 * Two quick questions while a sheet is written — the sheet's answer to the
 * QBank's lab-values round, but about this topic.
 *
 * A guess before reading makes the answer stick when it is read, even a wrong
 * guess (the pretesting effect). So each question is one the sheet is about to
 * answer, and its reveal says which block answers it, with a jump there once
 * that block has landed: the warm-up points the student into the sheet rather
 * than away from it. Nothing is saved or scored anywhere.
 *
 * It sits above the sheet and outlives the preparation card, so a question
 * half-answered when the first words arrive isn't snatched away. Questions
 * that arrive after the sheet has started would push the text being read
 * down, so the page holds those for the end and shows them under the sheet
 * as a quick check — answering after reading is retrieval practice too.
 */

const COPY = {
  warmup: {
    label: "Warm-up",
    hint: "Guess before you read — even a wrong guess makes the answer stick.",
    done: "now read it properly.",
    pending: (block: string) => `Coming up in ${block}`,
  },
  check: {
    label: "Quick check",
    hint: "Answer from what you just read.",
    done: "that's the sheet checked.",
    pending: (block: string) => `It's in ${block}`,
  },
};

const CARD_STYLE: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderLeft: "3px solid var(--accent)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-elevated)",
  overflow: "hidden",
};

/** Keys answer only while the student isn't typing somewhere else on the page. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

interface SheetWarmupProps {
  questions: WarmupQuestion[];
  /** The section key of the block a question points at, by the block's title. */
  keyForBlock: (title: string) => string | undefined;
  /** Whether that section has landed, so the jump has somewhere to go. */
  sectionReady: (key: string) => boolean;
  onJump: (key: string) => void;
  onClose: () => void;
  /** The first answer, so the page keeps the card after the stream ends. */
  onTouched?: () => void;
  /** Before reading (above the sheet) or after it (below). */
  mode?: "warmup" | "check";
}

const SheetWarmup = ({ questions, keyForBlock, sectionReady, onJump, onClose, onTouched, mode = "warmup" }: SheetWarmupProps) => {
  const copy = COPY[mode];
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [right, setRight] = useState(0);

  const q = questions[index];
  const done = index >= questions.length;
  const isLast = index === questions.length - 1;

  const answer = useCallback(
    (i: number) => {
      if (picked !== null || !q || i >= q.options.length) return;
      setPicked(i);
      if (i === q.answer) setRight((r) => r + 1);
      onTouched?.();
    },
    [picked, q, onTouched]
  );

  const next = useCallback(() => {
    setPicked(null);
    setIndex((n) => n + 1);
  }, []);

  useEffect(() => {
    if (done) return;
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (picked === null && n >= 1 && n <= (q?.options.length ?? 0)) {
        e.preventDefault();
        answer(n - 1);
      } else if (picked !== null && e.key === "Enter") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, next, picked, q, done]);

  if (done) {
    return (
      <section aria-label="Warm-up" style={CARD_STYLE} className="flex items-center gap-3 px-6 py-3.5">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: "var(--accent)" }}>
          <Check className="h-3 w-3" style={{ color: "var(--bg-elevated)" }} strokeWidth={3} />
        </span>
        <p className="m-0 flex-1 text-sm text-foreground">
          {copy.label} done · {right} of {questions.length} right
          <span className="text-muted-foreground"> — {copy.done}</span>
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close the ${copy.label.toLowerCase()}`}
          className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </section>
    );
  }

  const correct = picked !== null && picked === q.answer;
  const blockKey = q.block ? keyForBlock(q.block) : undefined;
  const canJump = !!blockKey && sectionReady(blockKey);

  return (
    <section aria-label={mode === "warmup" ? "Warm-up while your sheet is written" : "Quick check on this sheet"} style={CARD_STYLE}>
      <div className="flex items-center justify-between gap-3 px-6 pb-1 pt-4">
        <p className="m-0 font-mono text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: "var(--accent)" }}>
          {copy.label} · {index + 1} of {questions.length}
        </p>
        <div className="flex items-center gap-3">
          {right >= 2 && <Flame className="h-3.5 w-3.5 text-warning" aria-hidden />}
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Skip
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <m.div key={index} {...SWAP} className="px-6 pb-5 pt-1.5">
          <p className="m-0 text-[15px] font-medium leading-relaxed text-foreground">{q.q}</p>

          <div className="mt-3 grid gap-2" role="group" aria-label="Choose an answer">
            {q.options.map((option, i) => {
              const isAnswer = picked !== null && i === q.answer;
              const isWrongPick = picked === i && !correct;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => answer(i)}
                  disabled={picked !== null}
                  aria-keyshortcuts={String(i + 1)}
                  className={`flex min-h-[44px] items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    isAnswer
                      ? "border-success bg-success-soft text-success"
                      : isWrongPick
                        ? "border-danger bg-danger-soft text-danger"
                        : "border-border text-foreground hover:border-primary disabled:opacity-60"
                  }`}
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded border border-current font-mono text-[11px]" aria-hidden>
                    {isAnswer ? <Check className="h-3 w-3" strokeWidth={3} /> : isWrongPick ? <X className="h-3 w-3" strokeWidth={3} /> : i + 1}
                  </span>
                  <span>{option}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 min-h-[1.25rem]" role="status" aria-live="polite">
            {picked === null ? (
              <p className="m-0 text-xs leading-relaxed text-muted-foreground">
                {copy.hint} Tap, or press 1–{q.options.length}.
              </p>
            ) : (
              <m.div {...SWAP} className="grid gap-2.5">
                <p className="m-0 text-sm leading-relaxed text-foreground">
                  <span className={`font-semibold ${correct ? "text-success" : "text-danger"}`}>{correct ? "Right." : "Not quite."}</span>{" "}
                  {q.why}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {q.block ? (
                    canJump ? (
                      <button
                        type="button"
                        onClick={() => onJump(blockKey!)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {mode === "warmup" ? <ArrowDown className="h-3.5 w-3.5" aria-hidden /> : <ArrowUp className="h-3.5 w-3.5" aria-hidden />}
                        {mode === "warmup" ? "Read it in" : "See it in"} {q.block}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">{copy.pending(q.block)}</span>
                    )
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={next}
                    className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground hover:border-primary"
                  >
                    {isLast ? "Done" : "Next question"}
                  </button>
                </div>
              </m.div>
            )}
          </div>
        </m.div>
      </AnimatePresence>
    </section>
  );
};

export default SheetWarmup;
