import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { m } from "motion/react";
import { Layers, Lightbulb, Lock, Sparkles, Stethoscope, Trash2, Wand2 } from "lucide-react";
import { ENTER, EXIT } from "@/lib/motion";
import { REWRITE_STYLES, type RewriteStyle } from "@/lib/personalize";
import type { HighlightIntent } from "@/lib/sheet-layer";

/** The three reasons a passage gets marked, in the order the toolbar offers them. */
export const INTENTS: { intent: HighlightIntent; label: string; hint: string; swatch: string }[] = [
  { intent: "key", label: "Key", hint: "Key — the point to take away", swatch: "hsl(var(--warning))" },
  { intent: "confusing", label: "Confusing", hint: "Confusing — explain or drill this", swatch: "hsl(var(--danger))" },
  { intent: "memorize", label: "Memorize", hint: "Memorize — turn it into a card", swatch: "hsl(var(--info))" },
];

const BUBBLE_STYLE: React.CSSProperties = {
  position: "absolute",
  zIndex: 60,
  borderRadius: 14,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-elevated)",
  boxShadow: "var(--shadow-2)",
  padding: 4,
  // Its own width — not the room left of where it is anchored — and never
  // wider than a phone screen, where the rows wrap instead.
  width: "max-content",
  maxWidth: "calc(100vw - 32px)",
};

const PILL =
  "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-medium transition-colors hover:bg-secondary";

const Divider = () => <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />;

/**
 * A bubble centred on `left`, kept inside the document. The page clamps its
 * menus for a fixed 250px width; these are wider, and the AI row widens the
 * toolbar again when it opens, so the bubble measures itself after every
 * render and slides its centre in from whichever edge it would cross.
 */
function useClampedBubble(left: number, innerRef: React.Ref<HTMLDivElement>) {
  const own = useRef<HTMLDivElement | null>(null);
  const [x, setX] = useState(left);
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      own.current = el;
      if (typeof innerRef === "function") innerRef(el);
      else if (innerRef) (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [innerRef]
  );
  useLayoutEffect(() => {
    const el = own.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return setX(left);
    const half = el.offsetWidth / 2;
    const margin = 4;
    const max = Math.max(half + margin, parent.clientWidth - half - margin);
    setX(Math.min(Math.max(left, half + margin), max));
  });
  return { ref, x };
}

function Swatch({ color, active }: { color: string; active?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 rounded-full"
      style={{ background: color, boxShadow: active ? `0 0 0 2px var(--bg-elevated), 0 0 0 3.5px ${color}` : undefined }}
    />
  );
}

export type AiChoice =
  | { action: "rewrite"; style: Exclude<RewriteStyle, "custom">; label: string }
  | { action: "explain" | "card"; label: string };

interface SelectionToolbarProps {
  top: number;
  left: number;
  innerRef: React.Ref<HTMLDivElement>;
  /** The sheet's own enhancements, free for everyone, as before. */
  onEnhance: (kind: "enhance" | "expand" | "clinical") => void;
  /** Whether the selection sits inside one line the layer can anchor to. */
  canMark: boolean;
  /** A prose line or list item can be rewritten; a table row cannot. */
  canRewrite: boolean;
  /** Not Pro and not a premium sheet: the personal actions explain Pro instead. */
  locked: boolean;
  onHighlight: (intent: HighlightIntent) => void;
  onAi: (choice: AiChoice) => void;
  /** Ask a deep dive about the selected words — absent where the sheet can't take one. */
  onAsk?: () => void;
}

/**
 * What a selection on the sheet offers: mark it (and why), ask the AI to do
 * something with its line, or the sheet's own enhancements. The AI row opens
 * inside the bubble rather than as a menu of its own — a portalled menu sits
 * outside the bubble, and a click there reads as a click away from it.
 */
export function SelectionToolbar({ top, left, innerRef, onEnhance, canMark, canRewrite, locked, onHighlight, onAi, onAsk }: SelectionToolbarProps) {
  const [aiOpen, setAiOpen] = useState(false);
  const lock = locked ? <Lock className="h-3 w-3 opacity-60" /> : null;
  const bubble = useClampedBubble(left, innerRef);

  return (
    <m.div
      ref={bubble.ref}
      data-no-print
      initial={{ opacity: 0, y: 4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.97, transition: EXIT }}
      transition={ENTER}
      style={{ ...BUBBLE_STYLE, top, left: bubble.x, x: "-50%" }}
      onMouseDown={(e) => {
        // Keep the text selected, and keep the page's outside-click from
        // closing the bubble mid-click.
        e.stopPropagation();
        e.preventDefault();
      }}
      onMouseUp={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center">
        {onAsk && (
          <>
            <button type="button" onClick={onAsk} title="Ask a deep dive about what you selected" className={`${PILL} text-primary`}>
              <Stethoscope className="h-3.5 w-3.5" /> Ask
            </button>
            <Divider />
          </>
        )}
        {canMark && (
          <>
            {INTENTS.map((i) => (
              <button
                key={i.intent}
                type="button"
                title={i.hint}
                aria-label={`Highlight as ${i.label.toLowerCase()}`}
                onClick={() => onHighlight(i.intent)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-secondary"
              >
                <Swatch color={i.swatch} />
              </button>
            ))}
            <button
              type="button"
              aria-expanded={aiOpen}
              onClick={() => setAiOpen((o) => !o)}
              className={`${PILL} text-primary ${aiOpen ? "bg-secondary" : ""}`}
            >
              <Wand2 className="h-3.5 w-3.5" /> AI {lock}
            </button>
            <Divider />
          </>
        )}
        <button type="button" onClick={() => onEnhance("enhance")} className={`${PILL} text-primary`}>
          ✦ Enhance
        </button>
        <button type="button" onClick={() => onEnhance("expand")} className={`${PILL} text-foreground`}>
          ↗ Expand
        </button>
        <button type="button" onClick={() => onEnhance("clinical")} className={`${PILL} text-primary`}>
          🔗 Clinical
        </button>
      </div>

      {aiOpen && canMark && (
        <div className="mt-1 flex max-w-[calc(100vw-40px)] flex-wrap items-center gap-0.5 border-t border-border pt-1 sm:max-w-none sm:flex-nowrap">
          {canRewrite && REWRITE_STYLES.map((s) => (
            <button
              key={s.style}
              type="button"
              title={s.hint}
              onClick={() => onAi({ action: "rewrite", style: s.style, label: s.label })}
              className={`${PILL} text-foreground`}
            >
              {s.label}
            </button>
          ))}
          {canRewrite && <Divider />}
          <button type="button" onClick={() => onAi({ action: "explain", label: "Explained" })} className={`${PILL} text-foreground`}>
            <Lightbulb className="h-3.5 w-3.5" /> Explain
          </button>
          <button type="button" onClick={() => onAi({ action: "card", label: "New flashcard" })} className={`${PILL} text-foreground`}>
            <Layers className="h-3.5 w-3.5" /> Card
          </button>
        </div>
      )}
    </m.div>
  );
}

interface HighlightMenuProps {
  top: number;
  left: number;
  innerRef: React.Ref<HTMLDivElement>;
  intent: HighlightIntent;
  editable: boolean;
  onIntent: (intent: HighlightIntent) => void;
  onExplain: () => void;
  onCard: () => void;
  onRemove: () => void;
}

/** What clicking one of the student's own highlights offers. */
export function HighlightMenu({ top, left, innerRef, intent, editable, onIntent, onExplain, onCard, onRemove }: HighlightMenuProps) {
  const bubble = useClampedBubble(left, innerRef);
  return (
    <m.div
      ref={bubble.ref}
      data-no-print
      initial={{ opacity: 0, y: 4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.97, transition: EXIT }}
      transition={ENTER}
      style={{ ...BUBBLE_STYLE, top, left: bubble.x, x: "-50%" }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center">
        {editable &&
          INTENTS.map((i) => (
            <button
              key={i.intent}
              type="button"
              title={i.hint}
              aria-label={`Mark as ${i.label.toLowerCase()}`}
              aria-pressed={i.intent === intent}
              onClick={() => onIntent(i.intent)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-secondary"
            >
              <Swatch color={i.swatch} active={i.intent === intent} />
            </button>
          ))}
        {editable && <Divider />}
        <button type="button" onClick={onExplain} className={`${PILL} text-foreground`}>
          <Lightbulb className="h-3.5 w-3.5" /> Explain
        </button>
        <button type="button" onClick={onCard} className={`${PILL} text-foreground`}>
          <Layers className="h-3.5 w-3.5" /> Card
        </button>
        {editable && (
          <>
            <Divider />
            <button type="button" onClick={onRemove} aria-label="Remove highlight" className={`${PILL} text-muted-foreground`}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {!editable && <Sparkles className="mx-1.5 h-3.5 w-3.5 text-primary" aria-hidden />}
      </div>
    </m.div>
  );
}
