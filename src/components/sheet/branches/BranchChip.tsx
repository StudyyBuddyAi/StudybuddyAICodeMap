import { m } from "motion/react";
import { Loader2, RotateCcw } from "lucide-react";
import type { BranchType } from "@/lib/sheet-branches";
import { SPRING_POP } from "@/lib/motion";
import { BRANCH_ICON } from "./branch-context";

/**
 * One branch, as a pill. Branches are AI help, so they wear the product's AI
 * violet — the colour "Explain this" already means — which sets them apart
 * from the teal and ink of the sheet they grow out of. A grown branch is
 * filled and lifted; a suggestion is a tint, waiting to be grown; a
 * placeholder holds the place of one the sheet is still choosing. A chip pops
 * in once, when its place appears; after that it changes in place, its icon
 * popping to say so.
 */

export type BranchChipState = "grown" | "suggested" | "growing" | "error" | "placeholder";

const BASE =
  "inline-flex max-w-full items-center gap-1.5 rounded-full font-medium leading-none transition-[transform,box-shadow,border-color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/50 disabled:cursor-default disabled:opacity-60 [@media(hover:hover)]:hover:-translate-y-px";

const SIZE = {
  sm: "h-[26px] px-2.5 text-[11.5px]",
  md: "h-7 px-3 text-xs",
};

const STATE: Record<BranchChipState, string> = {
  grown: "bg-info text-info-foreground shadow-[0_3px_10px_-4px_hsl(var(--info)/0.55)] hover:shadow-[0_5px_14px_-4px_hsl(var(--info)/0.6)]",
  suggested: "border border-info/25 bg-info-soft text-info hover:border-info/60",
  growing: "border border-info/40 bg-info-soft text-info",
  error: "border border-warning/40 bg-warning-soft text-warning hover:border-warning",
  placeholder: "border border-dashed border-info/30 bg-info-soft/60 text-info/60",
};

interface BranchChipProps {
  type: BranchType;
  label: string;
  state: BranchChipState;
  onClick: () => void;
  title?: string;
  ariaLabel?: string;
  /** Branches grown from this one. */
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
  const Icon = state === "growing" || state === "placeholder" ? Loader2 : state === "error" ? RotateCcw : BRANCH_ICON[type];
  return (
    <m.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      initial={{ opacity: 0, y: -6, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...SPRING_POP, delay: Math.min(index, 6) * 0.05 }}
      className={`${BASE} ${SIZE[size]} ${STATE[state]} ${
        selected ? "ring-2 ring-info/45 ring-offset-1 ring-offset-background" : ""
      }`}
    >
      <m.span
        key={state}
        aria-hidden
        className="inline-flex shrink-0"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={SPRING_POP}
      >
        <Icon className={`h-3 w-3 ${state === "growing" || state === "placeholder" ? "animate-spin" : ""}`} />
      </m.span>
      {state === "placeholder" ? (
        <span aria-hidden className="h-1.5 w-24 animate-pulse rounded-full bg-info/25" />
      ) : (
        <span className="truncate">{label}</span>
      )}
      {children > 0 && (
        <span
          className={`-mr-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] ${
            state === "grown" ? "bg-white/20" : "bg-info/10"
          }`}
        >
          +{children}
        </span>
      )}
    </m.button>
  );
}
