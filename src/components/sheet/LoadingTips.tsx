import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { AutoHeight } from "@/components/StreamingText";
import { RISE, SWAP } from "@/lib/motion";
import {
  TIP_DURATION_MS,
  TIP_KIND_LABELS,
  readTipCursor,
  tipText,
  tipsForDevice,
  writeTipCursor,
} from "@/lib/study-tips";

/**
 * A loading-screen card for the wait before a sheet's first words.
 *
 * It floats over the placeholder cards rather than taking a place among them:
 * the placeholders are the document's real layout, so the card can come and
 * go — and it goes the moment text starts arriving — without moving anything
 * the reader is about to read. Inside the sections area it is sticky, so it
 * stays in view if the reader scrolls while waiting.
 *
 * Each tip stays for TIP_DURATION_MS, shown by a thin bar filling along the
 * card's foot. The bar's own animation ending is what moves to the next tip,
 * so what the bar shows and when the tip changes can never drift apart, and
 * hovering pauses both at once.
 */

/** A start this quick never shows the card, so it can't flash and vanish. */
const SHOW_AFTER_MS = 350;

const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

const hasCoarsePointer = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

const NAV_BUTTON =
  "flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground";

interface LoadingTipsProps {
  /** True while the sheet is generating and nothing has been written yet. */
  active: boolean;
}

const LoadingTips = ({ active }: LoadingTipsProps) => {
  const tips = useMemo(() => tipsForDevice(hasCoarsePointer()), []);
  const platform = useMemo(() => ({ mac: isMac() }), []);
  const [shown, setShown] = useState(false);
  const [index, setIndex] = useState(() => readTipCursor(tips.length));
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const t = window.setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [active]);

  // Every tip that is actually seen moves the cursor on, so the next wait
  // starts with a tip this reader hasn't just read.
  useEffect(() => {
    if (shown) writeTipCursor((index + 1) % tips.length);
  }, [shown, index, tips.length]);

  const go = (step: number) => setIndex((i) => (i + step + tips.length) % tips.length);

  const tip = tips[index];

  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden={!shown}>
      <div className="sticky px-3 pt-4 sm:px-8" style={{ top: "calc(var(--nav-h, 64px) + 96px)" }}>
        <AnimatePresence>
          {shown && tip && (
            <m.aside
              key="loading-tips"
              {...RISE}
              aria-label="A tip while the sheet is written"
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
              className="pointer-events-auto mx-auto w-full max-w-[560px] overflow-hidden rounded-[22px] border border-[color:var(--color-border)] bg-card/95 shadow-[var(--shadow-2)] backdrop-blur"
            >
              <div className="px-5 pb-4 pt-4">
                <div className="flex items-center gap-2">
                  <Sparkles
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 animate-pulse"
                    style={{ color: "var(--accent)" }}
                  />
                  <p className="min-w-0 flex-1 truncate font-mono text-[10.5px] font-medium uppercase tracking-widest text-muted-foreground">
                    {/* On a phone the tip's kind is what fits beside the arrows. */}
                    <span className="hidden sm:inline">While it writes · </span>
                    <span style={{ color: "var(--accent)" }}>{TIP_KIND_LABELS[tip.kind]}</span>
                  </p>
                  <div className="flex shrink-0 items-center">
                    <button type="button" aria-label="Previous tip" onClick={() => go(-1)} className={NAV_BUTTON}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-9 text-center font-mono text-[10.5px] tabular-nums text-muted-foreground">
                      {index + 1}/{tips.length}
                    </span>
                    <button type="button" aria-label="Next tip" onClick={() => go(1)} className={NAV_BUTTON}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Tips differ in length; the card glides to each one's height. */}
                <AutoHeight>
                  <AnimatePresence mode="wait" initial={false}>
                    <m.div key={index} {...SWAP} className="pt-3">
                      <p className="text-[15px] leading-relaxed text-foreground">{tipText(tip, platform)}</p>
                      {tip.source && <p className="mt-1.5 text-xs text-muted-foreground">{tip.source}</p>}
                    </m.div>
                  </AnimatePresence>
                </AutoHeight>
              </div>

              {/* The countdown to the next tip. Remounted per tip, so it starts
                  empty each time; its end is what advances the tip. */}
              <div className="h-[2px] w-full" style={{ background: "var(--border)" }}>
                <div
                  key={index}
                  data-testid="tip-timer"
                  className="sb-tip-timer h-full"
                  onAnimationEnd={() => go(1)}
                  style={{
                    background: "var(--accent)",
                    animationDuration: `${TIP_DURATION_MS}ms`,
                    animationPlayState: paused ? "paused" : "running",
                  }}
                />
              </div>
            </m.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default LoadingTips;
