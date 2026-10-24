import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Contrast, RotateCcw, X } from "lucide-react";
import type { QuestionMedia as Media } from "@/lib/qbank-types";

const shown = (media: Media[] | undefined, context: "stem" | "explanation") =>
  (media ?? []).filter((m) => m.display_context === context || m.display_context === "both");

/** A question's figures, each opening the viewer. */
export const MediaBlock = ({
  media,
  context,
  onOpen,
}: {
  media: Media[] | undefined;
  context: "stem" | "explanation";
  onOpen: (items: Media[], index: number) => void;
}) => {
  const items = shown(media, context);
  if (items.length === 0) return null;
  return (
    <div className="qb-media">
      {items.map((m, i) => (
        <figure key={`${m.file_url}-${i}`} className="qb-figure">
          <button type="button" onClick={() => onOpen(items, i)} aria-label={`Open image ${i + 1} full screen`}>
            <img src={m.file_url} alt={m.caption ?? m.media_type} />
          </button>
          {(m.caption || (m.license === "CC-BY" && m.attribution)) && (
            <figcaption>
              {m.caption}
              {m.license === "CC-BY" && m.attribution && (
                <span style={{ display: "block", fontSize: 12, marginTop: 2 }}>{m.attribution}</span>
              )}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
};

const DEFAULTS = { zoom: 1, contrast: 100, invert: false };

/**
 * The image viewer. The exam's image tools: zoom, and contrast and colour
 * inversion per image, for the subtle radiograph or the faint histology.
 */
export const ImageViewer = ({
  items,
  index,
  onIndexChange,
  onClose,
}: {
  items: Media[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) => {
  const open = items.length > 0;
  const item = items[index] ?? null;
  const [view, setView] = useState(DEFAULTS);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  // Each image opens at its own defaults.
  useEffect(() => {
    setView(DEFAULTS);
    setPan({ x: 0, y: 0 });
  }, [index, open]);

  const go = (step: number) => {
    const next = index + step;
    if (next >= 0 && next < items.length) onIndexChange(next);
  };

  const changed = view.zoom !== 1 || view.contrast !== 100 || view.invert;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="qb-viewer qb-exam-portal"
          aria-describedby={undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") go(1);
            if (e.key === "ArrowLeft") go(-1);
          }}
        >
          <div className="qb-viewer-bar">
            <DialogPrimitive.Title style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
              Image {index + 1} of {items.length}
            </DialogPrimitive.Title>
            <div style={{ flex: 1 }} />
            {items.length > 1 && (
              <>
                <button type="button" className="qb-btn qb-btn--icon" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous image">
                  <ChevronLeft />
                </button>
                <button
                  type="button"
                  className="qb-btn qb-btn--icon"
                  onClick={() => go(1)}
                  disabled={index === items.length - 1}
                  aria-label="Next image"
                >
                  <ChevronRight />
                </button>
              </>
            )}
            <DialogPrimitive.Close className="qb-btn" aria-label="Close image">
              <X /> Close
            </DialogPrimitive.Close>
          </div>

          <div
            className="qb-viewer-stage"
            style={{ cursor: view.zoom > 1 ? (drag.current ? "grabbing" : "grab") : "default" }}
            onPointerDown={(e) => {
              if (view.zoom <= 1) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            {item && (
              <img
                src={item.file_url}
                alt={item.caption ?? item.media_type}
                draggable={false}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${view.zoom})`,
                  filter: `contrast(${view.contrast}%)${view.invert ? " invert(1)" : ""}`,
                  background: "#fff",
                }}
              />
            )}
          </div>

          <div>
            {item?.caption && (
              <p className="qb-viewer-caption">
                {item.caption}
                {item.license === "CC-BY" && item.attribution ? ` · ${item.attribution}` : ""}
              </p>
            )}
            <div className="qb-viewer-controls">
              <label>
                Zoom
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.1}
                  value={view.zoom}
                  onChange={(e) => {
                    const zoom = Number(e.target.value);
                    setView((v) => ({ ...v, zoom }));
                    if (zoom === 1) setPan({ x: 0, y: 0 });
                  }}
                />
                <span style={{ minWidth: "3.5ch", fontVariantNumeric: "tabular-nums" }}>{view.zoom.toFixed(1)}×</span>
              </label>
              <label>
                Contrast
                <input
                  type="range"
                  min={50}
                  max={200}
                  step={5}
                  value={view.contrast}
                  onChange={(e) => setView((v) => ({ ...v, contrast: Number(e.target.value) }))}
                />
                <span style={{ minWidth: "4.5ch", fontVariantNumeric: "tabular-nums" }}>{view.contrast}%</span>
              </label>
              <div className="qb-viewer-bar" style={{ padding: 0 }}>
                <button
                  type="button"
                  className="qb-btn"
                  aria-pressed={view.invert}
                  onClick={() => setView((v) => ({ ...v, invert: !v.invert }))}
                >
                  <Contrast /> Invert
                </button>
                <button
                  type="button"
                  className="qb-btn"
                  disabled={!changed}
                  onClick={() => {
                    setView(DEFAULTS);
                    setPan({ x: 0, y: 0 });
                  }}
                >
                  <RotateCcw /> Reset
                </button>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
