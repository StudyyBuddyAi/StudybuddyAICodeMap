import type { CSSProperties, ReactNode } from "react";

/**
 * Shared chrome for the anatomy panel.
 *
 * The caption separates two different kinds of trust on purpose: the
 * illustration comes from a published source and is not generated, while the
 * explanations are model-written. Blurring those — "AI-generated diagram" —
 * would understate the picture and overstate the prose at the same time.
 * Permanent and non-collapsible, because a panel gets screenshotted away from
 * the sheet that qualified it.
 */
export const ANATOMY_PROVENANCE =
  "Explanations are AI-generated from general medical knowledge. Verify before exam or clinical use.";

const FRAME_STYLE: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-elevated)",
  padding: 16,
  margin: 0,
};

const BARE_STYLE: CSSProperties = { margin: 0 };

const TITLE_STYLE: CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "-0.004em",
  color: "var(--fg)",
  marginBottom: 12,
};

const CAPTION_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  lineHeight: 1.5,
  color: "var(--fg-muted)",
  marginTop: 12,
};

interface AnatomyFrameProps {
  title: string;
  /**
   * Drops the frame's own border and padding. Used when the panel sits inside
   * a sheet section card, which already supplies that chrome — nesting both
   * draws a box inside a box.
   */
  bare?: boolean;
  /** Credit for the illustration, shown alongside the provenance line. */
  attribution?: string | null;
  sourceUrl?: string | null;
  children: ReactNode;
}

const AnatomyFrame = ({ title, attribution, sourceUrl, bare, children }: AnatomyFrameProps) => (
  <figure className="anatomy-panel" style={bare ? BARE_STYLE : FRAME_STYLE}>
    <div style={TITLE_STYLE}>{title}</div>
    {children}
    <figcaption style={CAPTION_STYLE}>
      {ANATOMY_PROVENANCE}
      {attribution ? (
        <>
          {" · Illustration: "}
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              style={{ color: "inherit", textDecoration: "underline" }}
            >
              {attribution}
            </a>
          ) : (
            attribution
          )}
        </>
      ) : null}
    </figcaption>
  </figure>
);

export default AnatomyFrame;
