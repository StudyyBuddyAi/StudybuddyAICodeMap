import { useState } from "react";
import { MoreHorizontal, Undo2, Wand2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { REGEN_CHOICES, type RegenStyle } from "@/lib/sheet-depth";

/**
 * What can be done to one section: rewrite it in a direction the student
 * picks, in their own words, or take the rewrite back.
 */

// ── What is running on one section ───────────────────────────────────────────

export interface SectionJob {
  action: "regenerate";
  status: "running" | "error";
  /** For a rewrite: the direction, as the menu names it. */
  label?: string;
  error?: string;
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
