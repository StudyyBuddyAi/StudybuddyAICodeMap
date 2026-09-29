import type { CSSProperties } from "react";
import { BRANCH_KIND, BRANCH_TYPE_LABEL, type BranchType } from "@/lib/sheet-branches";

/**
 * The marks a deep dive carries: its kind, as a chart's shorthand on a
 * coloured stub, and the trace it shows while it is being written.
 */

/** The kind's colour, for anything inside to read as `hsl(var(--k))`. */
export const kindStyle = (type: BranchType): CSSProperties => ({ ["--k" as string]: BRANCH_KIND[type].color });

/** A heartbeat drawn across a small strip, over and over: something is being written. */
export function EcgTrace({ className = "h-3 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 30 14" aria-hidden className={`ecg-trace ${className}`} fill="none">
      <path
        d="M1 8h7l2-5 3 9 2-6 1 2h13"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The kind on its own: the stub, as a badge — in the panel's heading and its list. */
export function KindBadge({ type, size = "sm" }: { type: BranchType; size?: "sm" | "md" }) {
  return (
    <span
      style={kindStyle(type)}
      title={BRANCH_TYPE_LABEL[type]}
      className={`inline-flex shrink-0 items-center justify-center rounded-[4px] bg-[hsl(var(--k))] font-mono font-semibold tracking-[0.08em] text-[hsl(var(--kind-fg))] ${
        size === "md" ? "h-6 min-w-[42px] px-1.5 text-[10.5px]" : "h-[18px] min-w-[34px] px-1 text-[9px]"
      }`}
    >
      {BRANCH_KIND[type].short}
    </span>
  );
}
