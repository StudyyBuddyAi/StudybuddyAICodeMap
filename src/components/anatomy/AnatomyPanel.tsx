import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { callAnatomyExplain, type AnatomyImage } from "@/lib/callAnatomy";
import AnatomyFrame from "./AnatomyFrame";

/**
 * An anatomical illustration with tappable structure labels.
 *
 * The image is displayed unmodified — nothing is generated, segmented, or
 * traced. Interaction runs off the labels the illustrator already printed on
 * it, and the model supplies prose for one label at a time.
 *
 * Tap is the real trigger everywhere. There is no hover-capability detection in
 * this codebase and hover does not exist on touch, so hover is only ever a
 * visual hint layered on something already tappable.
 */

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const FALLBACK_RATIO = 4 / 3;

type ExplainFn = (
  params: { diagram: string; part: string },
  signal?: AbortSignal
) => Promise<{ text: string }>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface View {
  s: number;
  x: number;
  y: number;
}

const CHIP_BASE: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-pill, 999px)",
  background: "var(--bg)",
  color: "var(--fg-muted)",
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  padding: "6px 12px",
  cursor: "pointer",
};

export function AnatomySkeleton({ ratio = FALLBACK_RATIO }: { ratio?: number }) {
  return (
    <div className="anatomy-panel">
      <div className="anatomy-media" style={{ aspectRatio: ratio }}>
        <div className="anatomy-skeleton" />
      </div>
    </div>
  );
}

interface AnatomyPanelProps {
  image: AnatomyImage;
  /** Injected in tests; defaults to the real edge-function call. */
  explain?: ExplainFn;
}

export default function AnatomyPanel({
  image,
  explain = callAnatomyExplain,
}: AnatomyPanelProps) {
  const [part, setPart] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [justPressed, setJustPressed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });

  const mediaRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const panFrom = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);
  const pinchFrom = useRef<{ dist: number; s: number } | null>(null);

  const zoomed = view.s > MIN_SCALE;

  useEffect(() => () => abortRef.current?.abort(), []);

  /** Zoom toward a client point, keeping that point fixed under the cursor. */
  const applyZoom = useCallback((nextScale: number, at?: { x: number; y: number }) => {
    setView((v) => {
      const s = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      const rect = mediaRef.current?.getBoundingClientRect();
      // jsdom has no layout; without a box there is nothing to clamp against.
      if (!rect || !rect.width || !rect.height) return { s, x: 0, y: 0 };

      let { x, y } = v;
      if (at) {
        const cx = at.x - (rect.left + rect.width / 2);
        const cy = at.y - (rect.top + rect.height / 2);
        x = cx - ((cx - v.x) / v.s) * s;
        y = cy - ((cy - v.y) / v.s) * s;
      }
      const bx = ((s - 1) / 2) * rect.width;
      const by = ((s - 1) / 2) * rect.height;
      return { s, x: clamp(x, -bx, bx), y: clamp(y, -by, by) };
    });
  }, []);

  const resetZoom = useCallback(() => setView({ s: 1, x: 0, y: 0 }), []);

  // Non-passive, because React's synthetic wheel listener cannot preventDefault.
  // Plain wheel must keep scrolling the page; only Ctrl/Cmd + wheel zooms.
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setView((v) => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const s = clamp(v.s * factor, MIN_SCALE, MAX_SCALE);
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return { s, x: 0, y: 0 };
        const cx = e.clientX - (rect.left + rect.width / 2);
        const cy = e.clientY - (rect.top + rect.height / 2);
        const x = cx - ((cx - v.x) / v.s) * s;
        const y = cy - ((cy - v.y) / v.s) * s;
        const bx = ((s - 1) / 2) * rect.width;
        const by = ((s - 1) / 2) * rect.height;
        return { s, x: clamp(x, -bx, bx), y: clamp(y, -by, by) };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchFrom.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), s: view.s };
      panFrom.current = null;
    } else if (pointers.current.size === 1 && zoomed) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      panFrom.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinchFrom.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchFrom.current.dist > 0) {
        applyZoom((pinchFrom.current.s * dist) / pinchFrom.current.dist, {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
        });
      }
      return;
    }

    if (panFrom.current) {
      const rect = mediaRef.current?.getBoundingClientRect();
      if (!rect?.width) return;
      const bx = ((view.s - 1) / 2) * rect.width;
      const by = ((view.s - 1) / 2) * rect.height;
      setView((v) => ({
        s: v.s,
        x: clamp(panFrom.current!.vx + (e.clientX - panFrom.current!.px), -bx, bx),
        y: clamp(panFrom.current!.vy + (e.clientY - panFrom.current!.py), -by, by),
      }));
    }
  };

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchFrom.current = null;
    if (pointers.current.size === 0) panFrom.current = null;
  };

  const ask = useCallback(
    async (label: string) => {
      const name = label.trim();
      if (!name) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      // Last write wins: four fast taps must not land answers under wrong labels.
      const mine = ++reqId.current;

      setPart(name);
      setJustPressed(name);
      setAnswer("");
      setStatus("loading");

      try {
        const result = await explain({ diagram: image.title, part: name }, controller.signal);
        if (mine !== reqId.current) return;
        setAnswer(result.text ?? "");
        setStatus("ready");
      } catch {
        if (mine !== reqId.current || controller.signal.aborted) return;
        setAnswer("Couldn't load that explanation. Try again.");
        setStatus("error");
      }
    },
    [explain, image.title]
  );

  const open = status !== "idle";

  return (
    <AnatomyFrame
      title={image.title}
      attribution={image.attribution}
      sourceUrl={image.sourceUrl}
    >
      <div
        ref={mediaRef}
        className="anatomy-media"
        data-zoomed={zoomed ? "true" : "false"}
        style={{ aspectRatio: image.aspectRatio ?? FALLBACK_RATIO }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={(e) =>
          applyZoom(zoomed ? MIN_SCALE : DOUBLE_TAP_SCALE, { x: e.clientX, y: e.clientY })
        }
      >
        {!loaded && <div className="anatomy-skeleton" />}
        <img
          src={image.url}
          alt={image.title}
          data-loaded={loaded ? "true" : "false"}
          onLoad={() => setLoaded(true)}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
            transition: panFrom.current || pinchFrom.current ? "none" : undefined,
          }}
        />
      </div>

      {/* Zoom controls exist because pinch and Ctrl+wheel are unreachable by keyboard. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => applyZoom(view.s / 1.4)}
          style={CHIP_BASE}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => applyZoom(view.s * 1.4)}
          style={CHIP_BASE}
        >
          +
        </button>
        {zoomed && (
          <button type="button" aria-label="Reset zoom" onClick={resetZoom} style={CHIP_BASE}>
            Reset
          </button>
        )}
      </div>

      {image.labels.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {image.labels.map((label, i) => {
            const active = part === label;
            return (
              <button
                key={label}
                type="button"
                className="anatomy-chip"
                aria-pressed={active}
                data-just-pressed={justPressed === label ? "true" : undefined}
                onAnimationEnd={() => justPressed === label && setJustPressed(null)}
                onClick={() => ask(label)}
                style={{
                  ...CHIP_BASE,
                  // Capped: forty labels must not take a second to finish appearing.
                  animationDelay: `${Math.min(i * 22, 260)}ms`,
                  ...(active ? { borderColor: "var(--accent)", color: "var(--accent)" } : null),
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : (
        // Many published illustrations have their labels outlined as vectors, so
        // nothing is extractable. Typing the structure reaches the same path.
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(query);
          }}
          style={{ display: "flex", gap: 6, marginTop: 12 }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask about a structure…"
            aria-label="Structure to explain"
            style={{ ...CHIP_BASE, flex: 1, cursor: "text", color: "var(--fg)" }}
          />
          <button type="submit" style={CHIP_BASE}>
            Explain
          </button>
        </form>
      )}

      <div className="anatomy-answer" data-open={open ? "true" : "false"}>
        <div>
          <div
            aria-live="polite"
            style={{
              paddingTop: 12,
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              lineHeight: 1.6,
              color: "var(--fg)",
            }}
          >
            {open && (
              <>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{part}</div>
                {status === "loading" ? (
                  <span style={{ color: "var(--fg-muted)" }}>Explaining…</span>
                ) : (
                  <div className="anatomy-answer-text" data-visible="true">
                    {answer}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </AnatomyFrame>
  );
}
