import { m } from "motion/react";
import { RotateCcw } from "lucide-react";
import { BRANCH_KIND, type BranchType } from "@/lib/sheet-branches";
import { SPRING_POP } from "@/lib/motion";
import { EcgTrace, kindStyle } from "./kind";

/**
 * One deep dive, as an order tag on a chart: a stub with the kind in a
 * clinician's shorthand (MX, DDX, VS) in its colour, and the title beside it.
 * Written, it is a solid tag; suggested, a dashed one — an order not yet
 * signed; being written, its stub runs a heartbeat trace. A tag pops in once,
 * when its place appears; after that it changes in place.
 *
 * Tags take the brand's 4px corners, not a pill's: a tag is a label, not a
 * button asking to be pressed.
 */

export type BranchChipState = "grown" | "suggested" | "growing" | "error" | "placeholder";

// On a touch screen a tag is a little taller, and its tap area taller still (40px), without overlapping the next row.
const BASE =
  "relative inline-flex max-w-full items-stretch overflow-hidden rounded-[4px] font-medium leading-none transition-[transform,box-shadow,border-color,background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--k)/0.5)] disabled:cursor-default [@media(hover:hover)]:hover:-translate-y-px [@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:inset-x-0 [@media(pointer:coarse)]:before:-inset-y-1 [@media(pointer:coarse)]:before:content-['']";

const SIZE = {
  sm: { tag: "h-[26px] text-[11.5px] [@media(pointer:coarse)]:h-8", stub: "min-w-[36px] px-1.5 text-[9.5px]", label: "px-2" },
  md: { tag: "h-7 text-xs", stub: "min-w-[40px] px-1.5 text-[10px]", label: "px-2.5" },
};

const STATE: Record<BranchChipState, { tag: string; stub: string }> = {
  grown: {
    tag: "border border-border bg-card text-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.06),0_3px_10px_-6px_hsl(var(--foreground)/0.25)] hover:border-[hsl(var(--k)/0.6)]",
    stub: "bg-[hsl(var(--k))] text-[hsl(var(--kind-fg))]",
  },
  suggested: {
    tag: "border border-dashed border-[hsl(var(--k)/0.55)] bg-transparent text-muted-foreground hover:border-solid hover:bg-card hover:text-foreground disabled:opacity-60 disabled:hover:border-dashed disabled:hover:bg-transparent",
    stub: "border-r border-dashed border-[hsl(var(--k)/0.45)] text-[hsl(var(--k))]",
  },
  growing: {
    tag: "border border-[hsl(var(--k)/0.45)] bg-card text-foreground/80",
    stub: "bg-[hsl(var(--k)/0.12)] text-[hsl(var(--k))]",
  },
  error: {
    tag: "border border-warning/45 bg-warning-soft text-warning hover:border-warning",
    stub: "bg-warning/15 text-warning",
  },
  placeholder: {
    tag: "border border-dashed border-border bg-transparent text-muted-foreground",
    stub: "border-r border-dashed border-border text-muted-foreground",
  },
};

interface BranchChipProps {
  type: BranchType;
  label: string;
  state: BranchChipState;
  onClick: () => void;
  title?: string;
  ariaLabel?: string;
  /** Deep dives written from this one. */
  children?: number;
  /** Open in the panel. */
  selected?: boolean;
  disabled?: boolean;
  size?: keyof typeof SIZE;
  /** Its place among its siblings, for a staggered entrance. */
  index?: number;
}

export function BranchChip({
  type,
  label,
  state,
  onClick,
  title,
  ariaLabel,
  children = 0,
  selected,
  disabled,
  size = "sm",
  index = 0,
}: BranchChipProps) {
  const s = STATE[state];
  const z = SIZE[size];
  return (
    <m.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      style={kindStyle(state === "placeholder" ? "note" : type)}
      initial={{ opacity: 0, y: -6, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...SPRING_POP, delay: Math.min(index, 6) * 0.05 }}
      className={`${BASE} ${z.tag} ${s.tag} ${selected ? "ring-2 ring-[hsl(var(--k)/0.45)] ring-offset-1 ring-offset-background" : ""}`}
    >
      {/* The stub: the kind, or what is happening to it. Its content pops when that changes. */}
      <m.span
        key={state}
        aria-hidden
        className={`inline-flex shrink-0 items-center justify-center font-mono font-semibold tracking-[0.08em] ${z.stub} ${s.stub}`}
        initial={{ opacity: 0.2 }}
        animate={{ opacity: 1 }}
        transition={SPRING_POP}
      >
        {state === "growing" || state === "placeholder" ? (
          <EcgTrace className="h-3 w-6" />
        ) : state === "error" ? (
          <RotateCcw className="h-3 w-3" />
        ) : (
          BRANCH_KIND[type].short
        )}
      </m.span>
      {state === "placeholder" ? (
        <span aria-hidden className={`flex items-center ${z.label}`}>
          <span className="h-1.5 w-24 animate-pulse rounded-full bg-muted" />
        </span>
      ) : (
        <span className={`flex min-w-0 items-center ${z.label}`}>
          <span className="truncate">{label}</span>
        </span>
      )}
      {children > 0 && (
        <span className="flex items-center pr-2 font-mono text-[9.5px] text-muted-foreground" title={`${children} follow-up${children === 1 ? "" : "s"}`}>
          +{children}
        </span>
      )}
    </m.button>
  );
}
