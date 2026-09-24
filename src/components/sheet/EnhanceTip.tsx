import { AnimatePresence, m } from "motion/react";
import { Sparkles } from "lucide-react";
import { RISE } from "@/lib/motion";

/**
 * A one-time pointer to highlight-to-enhance.
 *
 * It used to be a permanent row pinned above the document: read once, then
 * scrolled past on every screen for good. It floats instead, near the bottom
 * of the viewport, so showing it and dismissing it never moves the text being
 * read — an inline banner collapsing would shift everything under it.
 * It goes for good on "Got it" or the reader's first enhancement.
 */
const EnhanceTip = ({ show, onDismiss }: { show: boolean; onDismiss: () => void }) => (
  <AnimatePresence>
    {show && (
      <m.div
        key="enhance-tip"
        {...RISE}
        role="note"
        className="fixed inset-x-0 bottom-5 z-40 mx-auto flex w-max max-w-[calc(100vw-32px)] items-center gap-2.5 rounded-full border border-border bg-card/95 py-1.5 pl-4 pr-1.5 shadow-[var(--shadow-2)] backdrop-blur print:hidden"
      >
        <Sparkles aria-hidden className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--accent)" }} />
        <p className="text-xs leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">Tip:</span> highlight any text, or click a
          bold term, to expand it or get a clinical tie.
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="h-7 shrink-0 rounded-full px-3 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-secondary"
        >
          Got it
        </button>
      </m.div>
    )}
  </AnimatePresence>
);

export default EnhanceTip;
