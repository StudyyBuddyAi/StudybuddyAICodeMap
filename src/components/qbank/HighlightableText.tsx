import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Highlighter } from "lucide-react";
import { leadInStart, segmentText, splitSegmentsAt } from "@/lib/qbank-highlights";
import type { HighlightRange } from "@/lib/qbank-types";

interface HighlightableTextProps {
  id?: string;
  text: string;
  ranges: HighlightRange[];
  onAdd?: (range: HighlightRange) => void;
  onRemove?: (offset: number) => void;
  /** Set the closing question paragraph apart from the history above it. */
  emphasizeLead?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** What the floating button will do: add the selection, or remove a highlight. */
type Pending =
  | { kind: "add"; range: HighlightRange; top: number; left: number }
  | { kind: "remove"; offset: number; top: number; left: number };

const BUTTON_W = 112;

/**
 * The stem, rendered as text runs the student can highlight.
 *
 * Each run is a span carrying its start offset, and holds exactly one text
 * node, so a DOM selection maps straight back to character offsets without
 * walking the tree. Offsets, not markup, are what gets saved.
 *
 * Selecting text offers Highlight; clicking a highlight offers Remove. Neither
 * acts until the button is pressed, so a stray click never wipes a mark.
 */
const HighlightableText = ({ id, text, ranges, onAdd, onRemove, emphasizeLead, className, style }: HighlightableTextProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const editable = !!onAdd;
  const lead = emphasizeLead ? leadInStart(text) : null;

  const offsetOf = useCallback((node: Node | null, offset: number): number | null => {
    const container = containerRef.current;
    if (!node || !container || !container.contains(node)) return null;
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
    const span = el?.closest<HTMLElement>("[data-hl-start]");
    if (!span) {
      // Selection edge on the container itself: offset counts child spans.
      if (node === container) {
        const child = container.childNodes[offset] as HTMLElement | undefined;
        return child?.dataset?.hlStart ? Number(child.dataset.hlStart) : text.length;
      }
      return null;
    }
    const start = Number(span.dataset.hlStart);
    return node.nodeType === Node.TEXT_NODE ? start + offset : start;
  }, [text.length]);

  const place = useCallback((rect: DOMRect) => {
    const box = containerRef.current!.getBoundingClientRect();
    return {
      top: rect.top - box.top - 40,
      left: Math.min(Math.max(rect.left - box.left + rect.width / 2 - BUTTON_W / 2, 0), Math.max(box.width - BUTTON_W, 0)),
    };
  }, []);

  const readSelection = useCallback(() => {
    if (!editable) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setPending((p) => (p?.kind === "add" ? null : p));
      return;
    }
    const r = sel.getRangeAt(0);
    const a = offsetOf(r.startContainer, r.startOffset);
    const b = offsetOf(r.endContainer, r.endOffset);
    if (a === null || b === null || !containerRef.current || Math.max(a, b) <= Math.min(a, b)) {
      setPending(null);
      return;
    }
    setPending({ kind: "add", range: [Math.min(a, b), Math.max(a, b)], ...place(r.getBoundingClientRect()) });
  }, [editable, offsetOf, place]);

  const commit = useCallback(() => {
    if (!pending) return;
    if (pending.kind === "add") onAdd?.(pending.range);
    else onRemove?.(pending.offset);
    setPending(null);
    window.getSelection()?.removeAllRanges();
  }, [pending, onAdd, onRemove]);

  // "H" acts on the pending selection or highlight. Registered only while
  // there is one, so the key means nothing otherwise.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "h" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        commit();
      } else if (e.key === "Escape") {
        setPending(null);
      }
    };
    // A press anywhere else lets the offer go.
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || containerRef.current?.contains(t)) return;
      setPending(null);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [pending, commit]);

  // A new question clears a half-made highlight.
  useEffect(() => setPending(null), [text]);

  return (
    <div className="relative">
      <div
        id={id}
        ref={containerRef}
        className={className}
        onMouseDown={() => setPending(null)}
        onMouseUp={readSelection}
        onTouchEnd={() => window.setTimeout(readSelection, 0)}
        onKeyUp={readSelection}
        style={{ whiteSpace: "pre-line", ...style }}
      >
        {splitSegmentsAt(segmentText(text, ranges), lead).map((seg) =>
          seg.highlighted ? (
            <mark
              key={seg.start}
              data-hl-start={seg.start}
              onClick={(e) => {
                if (!onRemove) return;
                const sel = window.getSelection();
                if (sel && !sel.isCollapsed) return;
                setPending({ kind: "remove", offset: seg.start, ...place(e.currentTarget.getBoundingClientRect()) });
              }}
              className={[onRemove ? "cursor-pointer" : "", lead !== null && seg.start >= lead ? "qb-lead" : ""].join(" ").trim() || undefined}
            >
              {seg.text}
            </mark>
          ) : (
            <span
              key={seg.start}
              data-hl-start={seg.start}
              className={lead !== null && seg.start >= lead ? "qb-lead" : undefined}
            >
              {seg.text}
            </span>
          )
        )}
      </div>

      {pending && (
        <button
          ref={buttonRef}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          className="absolute z-20 inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium shadow-md"
          style={{
            top: Math.max(pending.top, -12),
            left: pending.left,
            minWidth: BUTTON_W,
            background: "var(--fg)",
            color: "var(--bg)",
          }}
        >
          {pending.kind === "add" ? (
            <>
              <Highlighter className="h-4 w-4" /> Highlight
            </>
          ) : (
            <>
              <Eraser className="h-4 w-4" /> Remove
            </>
          )}
        </button>
      )}
    </div>
  );
};

export default HighlightableText;
