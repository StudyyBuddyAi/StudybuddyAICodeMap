import { useState, type ReactNode } from "react";
import { ChevronsDown, ChevronsUp, Layers, Loader2, MoreHorizontal, RotateCcw, Undo2, Wand2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { REGEN_CHOICES, type Depth, type RegenStyle } from "@/lib/sheet-depth";

/**
 * A section's depth, and what can be done to one section.
 *
 * Every section is written high-yield. Its comprehensive depth sits under it,
 * set apart the way AMBOSS shades the less essential part of an article: read
 * as "and beyond the core", never mistaken for it. The high-yield view hides
 * it; the section can show its own, or ask for it when it has none.
 */

// ── What is running on one section ───────────────────────────────────────────

export interface SectionJob {
  action: "expand" | "regenerate" | "expandAll";
  status: "running" | "error";
  /** For a rewrite: the direction, as the menu names it. */
  label?: string;
  error?: string;
}

// ── The depth block ───────────────────────────────────────────────────────────

interface DepthBlockProps {
  /** Still arriving: the label says so and Hide waits. */
  streaming?: boolean;
  onHide?: () => void;
  /** Undoes depth the student asked for (not depth written with the sheet). */
  onRemove?: () => void;
  children: ReactNode;
}

export function DepthBlock({ streaming, onHide, onRemove, children }: DepthBlockProps) {
  return (
    <div className="mt-4 border-t border-dashed border-border pt-3" data-depth-block>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          {streaming ? "Going deeper…" : "In depth"}
        </span>
        {streaming && <Loader2 aria-hidden className="h-3 w-3 animate-spin text-muted-foreground" />}
        <span className="ml-auto flex items-center gap-3">
          {!streaming && onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Remove
            </button>
          )}
          {!streaming && onHide && (
            <button
              type="button"
              onClick={onHide}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronsUp aria-hidden className="h-3 w-3" />
              High-yield only
            </button>
          )}
        </span>
      </div>
      <div className="border-l-2 border-primary/20 pl-3 opacity-90">{children}</div>
    </div>
  );
}

// ── The prompt under a section ────────────────────────────────────────────────

interface DepthPromptProps {
  /** "show": the depth exists, hidden. "deepen": there is none yet. "retry": asking failed. */
  kind: "show" | "deepen" | "retry";
  /** How many lines the hidden depth holds. */
  count?: number;
  busy?: boolean;
  onClick: () => void;
}

export function DepthPrompt({ kind, count, busy, onClick }: DepthPromptProps) {
  const Icon = busy ? Loader2 : kind === "show" ? ChevronsDown : kind === "retry" ? RotateCcw : Layers;
  const label =
    kind === "show"
      ? `Show in depth${count ? ` · ${count} more` : ""}`
      : kind === "retry"
      ? "Couldn't go deeper — try again"
      : busy
      ? "Going deeper…"
      : "Go deeper";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors duration-200 disabled:cursor-default ${
        kind === "retry"
          ? "border-warning/40 text-warning hover:border-warning"
          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
      }`}
    >
      <Icon aria-hidden className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
      {label}
    </button>
  );
}

// ── The section's menu ────────────────────────────────────────────────────────

interface SectionMenuProps {
  title: string;
  onRewrite: (style: Exclude<RegenStyle, "custom">) => void;
  onCustom: () => void;
  /** Present when the section is a rewrite the student can take back. */
  onUndo?: () => void;
  disabled?: boolean;
}

export function SectionMenu({ title, onRewrite, onCustom, onUndo, disabled }: SectionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${title}: rewrite`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Rewrite this section
        </DropdownMenuLabel>
        {REGEN_CHOICES.map((c) => (
          <DropdownMenuItem key={c.style} onSelect={() => onRewrite(c.style)} className="flex-col items-start gap-0">
            <span className="text-sm">{c.label}</span>
            <span className="text-xs text-muted-foreground">{c.hint}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={onCustom} className="gap-2">
          <Wand2 className="h-3.5 w-3.5" />
          In your own words…
        </DropdownMenuItem>
        {onUndo && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onUndo} className="gap-2">
              <Undo2 className="h-3.5 w-3.5" />
              Back to the original
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── A rewrite in the student's words ──────────────────────────────────────────

export function CustomRewrite({ onSubmit, onCancel }: { onSubmit: (instruction: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-secondary/40 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim());
      }}
    >
      <input
        autoFocus
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        placeholder="How should it change? e.g. focus on potassium"
        aria-label="How should this section change?"
        className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
      />
      <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
        Cancel
      </button>
      <button
        type="submit"
        disabled={!text.trim()}
        className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        Rewrite
      </button>
    </form>
  );
}

// ── The sheet's view ──────────────────────────────────────────────────────────

interface DepthToggleProps {
  value: Depth;
  onChange: (depth: Depth) => void;
  /** Depth for the whole sheet is being written. */
  busy?: boolean;
  disabled?: boolean;
}

/**
 * High-yield or comprehensive, for the whole sheet: AMBOSS's toolbar toggle.
 * Where the depth exists it is a view; where it doesn't, comprehensive asks
 * for it.
 */
export function DepthToggle({ value, onChange, busy, disabled }: DepthToggleProps) {
  const option = (depth: Depth, full: string, short: string) => {
    const on = value === depth;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        disabled={disabled}
        onClick={() => !on && onChange(depth)}
        className={`inline-flex h-full items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors duration-200 disabled:cursor-default ${
          on ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {busy && depth === "comprehensive" && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
        <span className="hidden sm:inline">{full}</span>
        <span className="sm:hidden">{short}</span>
      </button>
    );
  };
  return (
    <div
      role="radiogroup"
      aria-label="Sheet depth"
      className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card p-0.5"
    >
      {option("highYield", "High-yield", "HY")}
      {option("comprehensive", "Comprehensive", "Full")}
    </div>
  );
}
