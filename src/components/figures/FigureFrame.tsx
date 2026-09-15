import type { CSSProperties, ReactNode } from "react";

/**
 * Shared chrome for every figure.
 *
 * The provenance line is permanent and not collapsible by design: a diagram is
 * screenshotted and shared away from the sheet that qualified it, so the
 * qualifier has to travel inside the figure's own frame.
 */
export const FIGURE_PROVENANCE =
  "AI-generated diagram — from general medical knowledge, not the retrieved guidelines. Verify before exam or clinical use.";

const FRAME_STYLE: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-elevated)",
  padding: 16,
  margin: 0,
};

const TITLE_STYLE: CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "-0.004em",
  color: "var(--fg)",
  marginBottom: 12,
};

const PROVENANCE_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  lineHeight: 1.5,
  color: "var(--fg-muted)",
  marginTop: 12,
};

interface FigureFrameProps {
  title: string;
  children: ReactNode;
}

const FigureFrame = ({ title, children }: FigureFrameProps) => (
  <figure style={FRAME_STYLE}>
    <div style={TITLE_STYLE}>{title}</div>
    {children}
    <figcaption style={PROVENANCE_STYLE}>{FIGURE_PROVENANCE}</figcaption>
  </figure>
);

export default FigureFrame;
