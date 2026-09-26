import { CloudOff, Eye, EyeOff, Loader2, Play, Sparkles } from "lucide-react";
import { summarizeLayer } from "@/lib/sheet-layer";
import { usePersonal } from "./personal-context";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const TOGGLE =
  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors";

/**
 * The top of a sheet the student has made theirs: what their layer holds, the
 * two ways of looking at it (as generated, or without what they know), and the
 * hand-off to QBank on what they marked. For a student without Pro it is one
 * line saying what the sheet could do.
 */
export function LayerBar() {
  const p = usePersonal();
  if (!p) return null;
  const s = summarizeLayer(p.layer);
  const any = s.highlights + s.edits + s.notes + s.additions + s.known + s.hidden + s.cards > 0;

  if (!p.entitled && !any) {
    if (p.readOnly) return null;
    return (
      <button
        type="button"
        data-no-print
        onClick={p.onLocked}
        className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-4 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span>
          <span className="font-medium text-foreground">Make this sheet yours</span> — highlight, rewrite lines with AI,
          add notes, and turn any line into a flashcard.
        </span>
        <span className="ml-auto shrink-0 font-medium text-primary">Pro</span>
      </button>
    );
  }
  if (!any && p.readOnly) return null;

  const parts = [
    s.highlights && plural(s.highlights, "highlight"),
    s.edits && plural(s.edits, "edit"),
    s.additions && plural(s.additions, "point"),
    s.notes && plural(s.notes, "note"),
    s.cards && plural(s.cards, "card"),
  ].filter(Boolean);

  return (
    <div
      data-no-print
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5"
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" /> Your sheet
      </span>
      <span className="text-xs text-muted-foreground">
        {parts.length ? parts.join(" · ") : p.editable ? "Select any text, or use ⋯ on a line, to make it yours." : "Nothing added yet."}
      </span>

      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        {(s.edits > 0 || s.hidden > 0 || s.additions > 0) && (
          <button
            type="button"
            aria-pressed={p.showOriginal}
            onClick={() => p.setShowOriginal(!p.showOriginal)}
            className={`${TOGGLE} ${p.showOriginal ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {p.showOriginal ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />} Original
          </button>
        )}
        {s.known > 0 && (
          <button
            type="button"
            aria-pressed={p.hideKnown}
            onClick={() => p.setHideKnown(!p.hideKnown)}
            className={`${TOGGLE} ${p.hideKnown ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            Hide {s.known} known
          </button>
        )}
        {p.onPractice && !p.readOnly && (
          <button
            type="button"
            onClick={() => p.guard(() => p.onPractice!(p.focus))}
            title={p.focus ? `Questions on: ${p.focus}` : "Questions on this sheet's topic"}
            className={`${TOGGLE} border-primary/40 text-primary hover:bg-primary/10`}
          >
            <Play className="h-3.5 w-3.5" /> {p.focus ? "Practice what I marked" : "Practice in QBank"}
          </button>
        )}
        {p.saveFailed ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-destructive" title="Your changes will be retried">
            <CloudOff className="h-3.5 w-3.5" /> Not saved
          </span>
        ) : p.unsaved ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving
          </span>
        ) : null}
      </span>
    </div>
  );
}
