import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { HeartPulse } from "lucide-react";
import { callAnatomyMatch, type AnatomyImage } from "@/lib/callAnatomy";
import AnatomyPanel, { AnatomySkeleton } from "./AnatomyPanel";
import AnatomyBoundary from "./AnatomyBoundary";

/**
 * Topic in, matched illustration out.
 *
 * Self-hiding: most topics have no matching image and render nothing at all,
 * which is the intended outcome. Showing no diagram is always better than
 * showing the wrong organ, so there is no "closest match" fallback here — the
 * similarity floor lives in match_anatomy and this component simply respects
 * an empty result.
 *
 * Loads independently of the sheet stream, so a slow match can never delay the
 * sheet itself.
 */

type MatchFn = (topic: string, signal?: AbortSignal) => Promise<{ images: AnatomyImage[] }>;
type ExplainFn = (
  params: { diagram: string; part: string },
  signal?: AbortSignal
) => Promise<{ text: string }>;

/**
 * Mirrors the sheet's own section cards (see OutputSection) so anatomy reads as
 * part of the document rather than something bolted underneath it. Expressed in
 * the same tokens rather than imported, to avoid making those private constants
 * part of OutputSection's public surface.
 */
const CARD_STYLE: CSSProperties = {
  border: "1px solid var(--border)",
  borderLeft: "3px solid var(--accent)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-elevated)",
  overflow: "hidden",
};

const HEADER_STYLE: CSSProperties = {
  padding: "20px 24px 8px",
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const ICON_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--bg)",
  flexShrink: 0,
};

const CARD_TITLE_STYLE: CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: "-0.004em",
  color: "var(--fg)",
  margin: 0,
};

const BODY_STYLE: CSSProperties = { padding: "4px 24px 20px" };

const Card = ({ children }: { children: React.ReactNode }) => (
  <section
    data-section-key="anatomy"
    className="section-visuals animate-fade-in"
    style={CARD_STYLE}
  >
    <div style={HEADER_STYLE}>
      <span style={ICON_STYLE}>
        <HeartPulse style={{ width: 15, height: 15, color: "var(--accent)" }} />
      </span>
      <h3 style={CARD_TITLE_STYLE}>🫀 Anatomy</h3>
    </div>
    <div style={BODY_STYLE}>{children}</div>
  </section>
);

const TAB_STYLE: CSSProperties = {
  border: "none",
  background: "none",
  padding: "6px 10px",
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  color: "var(--fg-muted)",
  cursor: "pointer",
};

interface AnatomySectionProps {
  topic: string;
  /** Injected in tests; default hits the edge function. */
  match?: MatchFn;
  explain?: ExplainFn;
}

export default function AnatomySection({
  topic,
  match = callAnatomyMatch,
  explain,
}: AnatomySectionProps) {
  // null means "still matching" — distinct from [] , which means "no match".
  const [images, setImages] = useState<AnatomyImage[] | null>(null);
  const [active, setActive] = useState(0);

  const tabsRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setImages(null);
    setActive(0);

    match(topic, controller.signal)
      .then((result) => {
        if (alive) setImages(result?.images ?? []);
      })
      .catch(() => {
        // A failed match is not an error the reader should see; the sheet is
        // still complete without a diagram.
        if (alive) setImages([]);
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [topic, match]);

  // Slide the underline to the active tab. Runs on click, not per frame, and
  // degrades to a zero-width indicator where there is no layout (jsdom).
  useLayoutEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const tab = strip.children[active] as HTMLElement | undefined;
    if (!tab) return;
    setIndicator({ left: tab.offsetLeft, width: tab.offsetWidth });
  }, [active, images]);

  // The card holds its shape while matching, so the sheet does not jump when
  // the illustration lands. No match renders nothing at all — no empty card.
  if (images === null)
    return (
      <Card>
        <AnatomySkeleton />
      </Card>
    );
  if (images.length === 0) return null;

  const current = images[Math.min(active, images.length - 1)];

  return (
    <Card>
      {images.length > 1 && (
        <div className="anatomy-tabs" ref={tabsRef} style={{ display: "flex", gap: 4 }}>
          {images.map((image, i) => (
            <button
              key={image.id}
              type="button"
              aria-pressed={i === active}
              onClick={() => setActive(i)}
              style={{
                ...TAB_STYLE,
                ...(i === active ? { color: "var(--accent)", fontWeight: 600 } : null),
              }}
            >
              {image.title}
            </button>
          ))}
          <span
            className="anatomy-tabs-indicator"
            style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
          />
        </div>
      )}

      <AnatomyBoundary>
        <AnatomyPanel image={current} bare explain={explain} />
      </AnatomyBoundary>
    </Card>
  );
}
