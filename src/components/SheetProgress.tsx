import { AnimatePresence, m } from "motion/react";
import { Check, Sparkles } from "lucide-react";
import type { SheetSectionSpec } from "@/types/generated-sheet";

/**
 * Where a generation has got to, in one line.
 *
 * Every step it names comes from a real signal on the stream — the plan frame,
 * the retrieval frame, the key the parser reports in flight — never a timer, so
 * it can't claim progress the server hasn't made. It lives in the document's
 * sticky bar, so it stays in view while the reader starts on the first sections.
 */

/** Grounding as far as the client knows it: turned off, awaited, or retrieved. */
export type SourcesStatus = "off" | "pending" | number;

export interface GenerationStatus {
  /** True once the server's plan frame has arrived. */
  planned: boolean;
  sources: SourcesStatus;
}

interface SheetProgressProps {
  /** The sections a reader will see, in order. Flashcards are left out: they
   *  arrive in their own frame at the end, not as a key the parser reports. */
  sections: SheetSectionSpec[];
  readyKeys: string[];
  /** The key the model is writing right now, if the parser has seen it. */
  liveKey?: string;
  status: GenerationStatus;
  /** The stream has ended. */
  done: boolean;
}

function currentLabel({ sections, readyKeys, liveKey, status, done }: SheetProgressProps) {
  if (done) return "Sheet ready";
  const live = sections.find((s) => s.key === liveKey);
  if (live) return `Writing ${live.title}`;
  const readyCount = sections.filter((s) => readyKeys.includes(s.key)).length;
  if (readyCount === sections.length && sections.length > 0) return "Adding flashcards";
  if (readyCount > 0) return "Writing";
  if (!status.planned) return "Planning the sections";
  if (status.sources === "pending") return "Searching the guideline library";
  return "Starting to write";
}

const Chip = ({ children }: { children: React.ReactNode }) => (
  <m.span
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ type: "spring", stiffness: 420, damping: 28 }}
    className="hidden sm:inline-flex"
    style={{
      alignItems: "center",
      height: 20,
      padding: "0 8px",
      borderRadius: "var(--radius-pill)",
      border: "1px solid var(--border)",
      background: "var(--bg-elevated)",
      color: "var(--fg-muted)",
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </m.span>
);

const SheetProgress = (props: SheetProgressProps) => {
  const { sections, readyKeys, status, done } = props;
  const total = sections.length;
  const readyCount = done ? total : sections.filter((s) => readyKeys.includes(s.key)).length;
  const label = currentLabel(props);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minWidth: 0 }}
    >
      <span
        style={{ display: "inline-flex", width: 12, height: 12, flexShrink: 0 }}
        aria-hidden
      >
        {done ? (
          <m.span
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 520, damping: 22 }}
            style={{ display: "inline-flex" }}
          >
            <Check style={{ width: 12, height: 12, color: "var(--accent)" }} />
          </m.span>
        ) : (
          <Sparkles
            className="animate-pulse"
            style={{ width: 12, height: 12, color: "var(--accent)" }}
          />
        )}
      </span>

      {/* The label rolls up out of the way as the next one arrives, like a
          departures board, so a change of step is noticed without a flash. */}
      <span
        style={{
          position: "relative",
          flex: 1,
          minWidth: 0,
          height: 16,
          overflow: "hidden",
        }}
      >
        {/* Both labels are absolutely placed, so the outgoing one can leave
            while the incoming one arrives in the same slot. */}
        <AnimatePresence initial={false}>
          <m.span
            key={label}
            initial={{ y: 14, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -14, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className={done ? undefined : "text-shimmer"}
            style={{
              position: "absolute",
              inset: 0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              lineHeight: "16px",
              color: done ? "var(--fg)" : "var(--fg-muted)",
            }}
          >
            {label}
            {!done && "…"}
          </m.span>
        </AnimatePresence>
      </span>

      {typeof status.sources === "number" && status.sources > 0 && (
        <Chip>
          {status.sources} source{status.sources === 1 ? "" : "s"}
        </Chip>
      )}
      {total > 0 && (
        <span
          style={{
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
            color: done ? "var(--accent)" : "var(--fg-muted)",
          }}
        >
          {readyCount}/{total}
        </span>
      )}
    </div>
  );
};

export default SheetProgress;
