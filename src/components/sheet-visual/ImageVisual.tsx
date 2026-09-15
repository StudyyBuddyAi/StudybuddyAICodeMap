import { useEffect, useState } from "react";
import { ImageIcon, Loader2, RotateCcw } from "lucide-react";
import type { VisualImageResult } from "@/types/generated-sheet";
import {
  isTrustedVisualImageUrl,
  requestSheetImage,
  SheetImageError,
  type SheetImageRequester,
} from "@/lib/generate-sheet-image";

export interface ImageVisualProps {
  topic: string;
  subject: string;
  alt: string;
  visualImage?: VisualImageResult;
  onResolved?: (result: VisualImageResult) => void;
  isPro?: boolean;
  requestImage?: SheetImageRequester;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading"; startedAt: number }
  | { kind: "error"; code: "quota_exceeded" | "unavailable"; cap?: number }
  | { kind: "done"; result: VisualImageResult };

const BUTTON_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 32,
  padding: "0 14px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-elevated)",
  color: "var(--fg)",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const PANEL_STYLE: React.CSSProperties = {
  border: "1px dashed var(--border-strong)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg)",
  padding: "16px",
};

/**
 * Opt-in: nothing is requested until the student asks. Images are the least
 * reliable kind of visual and the only one that costs money per view of a new
 * subject, so the default state is a button, not a spinner.
 */
const ImageVisual = ({
  topic,
  subject,
  alt,
  visualImage,
  onResolved,
  isPro = false,
  requestImage = requestSheetImage,
}: ImageVisualProps) => {
  const saved = visualImage && isTrustedVisualImageUrl(visualImage.url) ? visualImage : undefined;
  const [status, setStatus] = useState<Status>(() =>
    saved ? { kind: "done", result: saved } : { kind: "idle" }
  );
  const [imgFailed, setImgFailed] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (status.kind !== "loading") return;
    const t = window.setInterval(() => setElapsed(Math.round((Date.now() - status.startedAt) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [status]);

  const generate = async () => {
    setElapsed(0);
    setImgFailed(false);
    setStatus({ kind: "loading", startedAt: Date.now() });
    try {
      const result = await requestImage({ topic, subject });
      setStatus({ kind: "done", result });
      onResolved?.(result);
    } catch (err) {
      if (err instanceof SheetImageError) {
        setStatus({ kind: "error", code: err.code, cap: err.cap });
      } else {
        setStatus({ kind: "error", code: "unavailable" });
      }
    }
  };

  if (status.kind === "done" && !imgFailed) {
    return (
      <img
        src={status.result.url}
        alt={alt}
        loading="lazy"
        onError={() => setImgFailed(true)}
        style={{
          display: "block",
          width: "100%",
          maxHeight: 560,
          objectFit: "contain",
          borderRadius: "var(--radius-sm)",
          // The model draws on white; keep it white in dark mode too rather
          // than letting a transparent edge read as a broken frame.
          background: "#FFFFFF",
        }}
      />
    );
  }

  if (status.kind === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center justify-center gap-2"
        // Roughly the drawn image's footprint, so the page doesn't jump much when it lands.
        style={{ ...PANEL_STYLE, borderStyle: "solid", width: "100%", height: 340 }}
      >
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--accent)" }} />
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--fg-muted)" }}>
          Drawing {subject}…
        </p>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-subtle)" }}>
          {elapsed}s · usually 10–30 seconds
        </p>
      </div>
    );
  }

  const failedToLoad = status.kind === "done" && imgFailed;
  const message =
    status.kind === "error" && status.code === "quota_exceeded"
      ? `You've used today's ${status.cap ?? 3} free illustrations. They reset at midnight UTC — Pro has no daily limit.`
      : status.kind === "error" || failedToLoad
      ? "Illustration unavailable right now. The rest of the sheet is unaffected."
      : null;

  return (
    <div style={PANEL_STYLE}>
      <div className="flex flex-wrap items-center gap-3">
        <ImageIcon style={{ width: 16, height: 16, color: "var(--fg-subtle)", flexShrink: 0 }} />
        <p style={{ flex: "1 1 200px", fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.5 }}>
          Suggested illustration: <span style={{ color: "var(--fg)", fontWeight: 500 }}>{subject}</span>
        </p>
        {!(status.kind === "error" && status.code === "quota_exceeded") && (
          <button type="button" style={BUTTON_STYLE} onClick={generate}>
            {message ? <RotateCcw style={{ width: 13, height: 13 }} /> : <ImageIcon style={{ width: 13, height: 13 }} />}
            {message ? "Try again" : "Generate illustration"}
          </button>
        )}
      </div>
      <p style={{ marginTop: 8, fontFamily: "var(--font-sans)", fontSize: 12, color: message ? "var(--fg)" : "var(--fg-subtle)", lineHeight: 1.5 }}>
        {message ??
          `AI illustrations can get anatomy wrong — check labels against your atlas.${isPro ? "" : " Free plan: 3 per day."}`}
      </p>
    </div>
  );
};

export default ImageVisual;
