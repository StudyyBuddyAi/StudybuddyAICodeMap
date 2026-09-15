import { useCallback, useEffect, useRef, useState } from "react";
import { Highlighter } from "lucide-react";
import { segmentText } from "@/lib/qbank-highlights";
import type { HighlightRange } from "@/lib/qbank-types";

interface HighlightableTextProps {
  text: string;
  ranges: HighlightRange[];
  onAdd?: (range: HighlightRange) => void;
  onRemove?: (offset: number) => void;
  style?: React.CSSProperties;
}

/**
 * The stem, rendered as text runs the student can highlight.
 *
 * Each run is a span carrying its start offset, and holds exactly one text
 * node, so a DOM selection maps straight back to character offsets without
 * walking the tree. Offsets, not markup, are what gets saved.
 */
const HighlightableText = ({ text, ranges, onAdd, onRemove, style }: HighlightableTextProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<{ range: HighlightRange; top: number; left: number } | null>(null);
  const editable = !!onAdd;

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

  const readSelection = useCallback(() => {
    if (!editable) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setPending(null);
      return;
    }
    const r = sel.getRangeAt(0);
    const a = offsetOf(r.startContainer, r.startOffset);
    const b = offsetOf(r.endContainer, r.endOffset);
    const container = containerRef.current;
    if (a === null || b === null || !container || Math.max(a, b) <= Math.min(a, b)) {
      setPending(null);
      return;
    }
    const rect = r.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    setPending({
      range: [Math.min(a, b), Math.max(a, b)],
      top: rect.top - box.top - 36,
      left: Math.min(Math.max(rect.left - box.left + rect.width / 2 - 48, 0), Math.max(box.width - 96, 0)),
    });
  }, [editable, offsetOf]);

  const commit = useCallback(() => {
    if (!pending || !onAdd) return;
    onAdd(pending.range);
    setPending(null);
    window.getSelection()?.removeAllRanges();
  }, [pending, onAdd]);

  // "H" highlights the current selection. Registered only while there is one,
  // so the key means nothing otherwise.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "h" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        commit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pending, commit]);

  // A new question clears a half-made highlight.
  useEffect(() => setPending(null), [text]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        onMouseUp={readSelection}
        onTouchEnd={() => window.setTimeout(readSelection, 0)}
        onKeyUp={readSelection}
        style={{ whiteSpace: "pre-line", ...style }}
      >
        {segmentText(text, ranges).map((seg) =>
          seg.highlighted ? (
            <mark
              key={seg.start}
              data-hl-start={seg.start}
              onClick={() => {
                if (!onRemove) return;
                const sel = window.getSelection();
                if (sel && !sel.isCollapsed) return;
                onRemove(seg.start);
              }}
              title={onRemove ? "Click to remove highlight" : undefined}
              className={onRemove ? "cursor-pointer" : undefined}
              style={{ background: "rgba(250, 204, 21, 0.45)", color: "inherit", borderRadius: 2, padding: 0 }}
            >
              {seg.text}
            </mark>
          ) : (
            <span key={seg.start} data-hl-start={seg.start}>
              {seg.text}
            </span>
          )
        )}
      </div>

      {pending && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          className="absolute z-20 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium shadow-md"
          style={{
            top: Math.max(pending.top, -8),
            left: pending.left,
            background: "var(--fg)",
            color: "var(--bg)",
          }}
        >
          <Highlighter className="h-3.5 w-3.5" /> Highlight
        </button>
      )}
    </div>
  );
};

export default HighlightableText;
