import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { AnimatePresence, m, useScroll, useSpring, useTransform } from "motion/react";
import SheetProgress, { type GenerationStatus } from "@/components/SheetProgress";
import { SPRING_BAR, SPRING_POP, SWAP } from "@/lib/motion";
import type { SheetSectionSpec } from "@/types/generated-sheet";

/**
 * The sheet's own header, pinned under the app nav while reading.
 *
 * It replaces three rows that used to stack above the document — a sticky
 * status bar, a settings line with Save, and a permanent "highlight any text"
 * hint — and the settings column beside it. What the sheet is, how it was
 * made, where the generation has got to, and what can be done with it are all
 * here, in the one place the eye returns to.
 *
 * The second line carries the generation's progress while it runs, holds
 * "Sheet ready" for a moment so the finish is seen, then settles to the
 * sheet's settings. The bar along the bottom edge follows the same arc:
 * sections written, then how far the reader has got.
 */

/** How long "Sheet ready" stays before the line settles, in ms. */
const READY_LINGER = 2200;

interface SheetTopicBarProps {
  emoji?: string;
  /** The sheet's topic, or the text it was asked for until the topic arrives. */
  title: string;
  /** How the sheet was made, e.g. "Step 2 · Intermediate · Moderate". */
  summary: string;
  /** Extra facts for the settled line, e.g. "5 sources". */
  details?: string[];
  streaming: boolean;
  /** What the progress line counts: the reader's sections, minus the deck. */
  progress: {
    sections: SheetSectionSpec[];
    readyKeys: string[];
    liveKey?: string;
    status: GenerationStatus;
  };
  /** The document, for the reading-progress bar. */
  readingTarget: RefObject<HTMLElement>;
  /** Buttons on the right of the first line. */
  actions: ReactNode;
}

const SheetTopicBar = ({
  emoji,
  title,
  summary,
  details = [],
  streaming,
  progress,
  readingTarget,
  actions,
}: SheetTopicBarProps) => {
  const [statusVisible, setStatusVisible] = useState(streaming);
  useEffect(() => {
    if (streaming) {
      setStatusVisible(true);
      return;
    }
    const t = window.setTimeout(() => setStatusVisible(false), READY_LINGER);
    return () => window.clearTimeout(t);
  }, [streaming]);

  const total = progress.sections.length;
  const ready = progress.sections.filter((s) => progress.readyKeys.includes(s.key)).length;
  const fraction = streaming ? (total ? ready / total : 0) : 1;

  // How far through the document the reader is. Measured against the page
  // scroll on each change rather than handed to useScroll as a target: this
  // bar lives inside the document it measures, and React runs a child's
  // effects before it attaches the parent's ref, so a target ref would not
  // exist yet when the tracking starts. Eased so the bar glides after the
  // scroll rather than ticking with it.
  const { scrollY } = useScroll();
  const throughDocument = useTransform(scrollY, (y) => {
    const el = readingTarget.current;
    if (!el) return 0;
    const top = el.getBoundingClientRect().top + y;
    const travel = el.offsetHeight - window.innerHeight;
    if (travel <= 0) return 1;
    return Math.min(1, Math.max(0, (y - top) / travel));
  });
  const readingProgress = useSpring(throughDocument, { stiffness: 200, damping: 30, mass: 0.4 });

  return (
    <header
      className="sticky z-20 -mx-1 px-1"
      style={{
        top: "var(--nav-h, 64px)",
        background: "color-mix(in srgb, var(--bg) 88%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div className="relative border-b border-border pb-3 pt-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="flex min-w-0 items-center gap-2 [font-family:var(--app-font-serif)] text-xl font-medium leading-tight tracking-[-0.01em] text-foreground sm:text-2xl">
              <AnimatePresence initial={false}>
                {emoji && (
                  <m.span
                    key={emoji}
                    aria-hidden
                    className="shrink-0 text-lg sm:text-xl"
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.4, opacity: 0 }}
                    transition={SPRING_POP}
                  >
                    {emoji}
                  </m.span>
                )}
              </AnimatePresence>
              <span className="truncate">{title}</span>
            </h1>

            {/* The second line: progress while it runs, then what the sheet is. */}
            <div className="relative mt-1 h-4 overflow-hidden font-mono text-[11px] tracking-[0.02em]">
              <AnimatePresence mode="wait" initial={false}>
                {statusVisible ? (
                  <m.div key="status" {...SWAP} className="absolute inset-0 flex items-center">
                    <SheetProgress
                      sections={progress.sections}
                      readyKeys={progress.readyKeys}
                      liveKey={progress.liveKey}
                      status={progress.status}
                      done={!streaming}
                    />
                  </m.div>
                ) : (
                  <m.p
                    key="summary"
                    {...SWAP}
                    className="absolute inset-0 truncate leading-4 text-muted-foreground"
                  >
                    {[summary, ...details].join(" · ")}
                  </m.p>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        </div>

        {/* One bar, two jobs: sections written, then reading progress. */}
        {statusVisible ? (
          <m.div
            aria-hidden
            initial={false}
            animate={{ scaleX: fraction }}
            transition={SPRING_BAR}
            className="absolute -bottom-px left-0 right-0 h-[2px] origin-left"
            style={{ background: "var(--accent)" }}
          />
        ) : (
          <m.div
            aria-hidden
            className="absolute -bottom-px left-0 right-0 h-[2px] origin-left"
            style={{ scaleX: readingProgress, background: "var(--accent)", opacity: 0.55 }}
          />
        )}
      </div>
    </header>
  );
};

export default SheetTopicBar;
