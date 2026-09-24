import { useLayoutEffect, useRef, useState } from "react";
import { m } from "motion/react";
import { closeOpenBold } from "@/lib/close-open-bold";

/**
 * Pieces for text that is still arriving.
 *
 * A section's draft re-renders on every animation frame while the model writes
 * it. Each word gets its own span, keyed by position, so React keeps the spans
 * it already has and mounts only the new ones — which means only the newest
 * words play the fade-in, and the text already read never flickers.
 */

/** One run of text, split into words that fade in as they mount. */
function Words({ text, keyPrefix }: { text: string; keyPrefix: string }) {
  // Whitespace stays as plain text between the spans so wrapping is unchanged.
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((part, i) =>
        part === "" ? null : /^\s+$/.test(part) ? (
          part
        ) : (
          <span key={`${keyPrefix}-${i}`} className="sb-word-in">
            {part}
          </span>
        )
      )}
    </>
  );
}

/**
 * A line of draft text with `**bold**` keywords, animated word by word.
 * Deliberately inert: keyword clicks and enhancement marks attach once the
 * section has closed and the finished renderer takes over.
 */
export function StreamingWords({ text }: { text: string }) {
  const segments = closeOpenBold(text)
    .split(/(\*\*[^*]*\*\*)/g)
    .filter((s) => s !== "");
  return (
    <>
      {segments.map((seg, i) =>
        seg.startsWith("**") && seg.endsWith("**") && seg.length >= 4 ? (
          <strong key={i} className="font-semibold text-foreground">
            <Words text={seg.slice(2, -2)} keyPrefix={`b${i}`} />
          </strong>
        ) : (
          <span key={i}>
            <Words text={seg} keyPrefix={`t${i}`} />
          </span>
        )
      )}
    </>
  );
}

/** Blinking bar where the next word will land. */
export function Caret() {
  return (
    <span
      aria-hidden
      className="sb-caret"
      style={{
        display: "inline-block",
        width: 2,
        height: "1.05em",
        marginLeft: 3,
        verticalAlign: "-0.15em",
        borderRadius: 1,
        background: "var(--accent)",
      }}
    />
  );
}

/**
 * Animates its own height to fit its content, so a card whose body swaps from
 * a skeleton to text, or grows a line at a time mid-stream, glides to its new
 * size instead of jumping. The content is measured with a ResizeObserver;
 * where none exists (jsdom) it simply stays at its natural height.
 */
export function AutoHeight({ children }: { children: React.ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0];
      setHeight(box ? box.blockSize : el.offsetHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <m.div
      initial={false}
      animate={{ height }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      style={{ overflow: "hidden" }}
    >
      <div ref={innerRef}>{children}</div>
    </m.div>
  );
}
