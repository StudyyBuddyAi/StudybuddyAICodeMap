import type { CSSProperties } from "react";
import { ExternalLink, TriangleAlert } from "lucide-react";
import CortiLogo from "@/components/icons/CortiLogo";
import { modelLabel, type ModelUsed } from "@/lib/model-used";

export const CORTI_URL = "https://www.corti.ai";

/** Attribution copy shown next to the Corti logo. */
export const CORTI_TAGLINE = "Built for healthcare";

const pill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 9px",
  borderRadius: "var(--radius-pill)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 500,
  lineHeight: 1.3,
  whiteSpace: "nowrap",
  textDecoration: "none",
};

/**
 * "Powered by Corti" credit for premium output. Links to Corti's site in a new
 * tab, so a student can see who built the model behind their sheet.
 */
export const PoweredByCorti = ({ compact = false }: { compact?: boolean }) => (
  <a
    href={CORTI_URL}
    target="_blank"
    rel="noopener noreferrer"
    title="Written by Corti S1, an AI model built for healthcare. Opens corti.ai in a new tab."
    className="corti-credit"
    style={{
      ...pill,
      border: "1px solid var(--border-strong)",
      background: "var(--bg-elevated)",
      color: "var(--fg-muted)",
    }}
  >
    <span>Powered by</span>
    <CortiLogo style={{ fontSize: 14, color: "var(--fg)" }} />
    {!compact && <span aria-hidden="true">·</span>}
    {!compact && <span>{CORTI_TAGLINE}</span>}
    <ExternalLink aria-hidden="true" style={{ width: 10, height: 10 }} />
  </a>
);

/**
 * Shown when a request's usual Corti model was unavailable and Corti's other
 * model wrote the output instead — the student is told, rather than served a
 * different model silently. Legacy saved output may carry the old fallback
 * (Claude Haiku 4.5); it gets the same notice.
 */
export const CortiFallbackNotice = ({ used }: { used: ModelUsed }) => (
  <span
    role="note"
    title="The usual model was unavailable for this request, so a backup model wrote it. Try again later for the usual one."
    style={{
      ...pill,
      border: "1px solid var(--border)",
      background: "hsl(var(--warning-soft))",
      color: "hsl(var(--warning))",
    }}
  >
    <TriangleAlert aria-hidden="true" style={{ width: 11, height: 11 }} />
    <span>Backup model · usual model unavailable</span>
  </span>
);

/**
 * The right credit for a response: Corti's badge, or the fallback notice.
 * Every tier is Corti now. Older saved output from the retired free-tier
 * model (GPT-OSS) is never named — the student couldn't choose it, so its
 * name told them nothing. Renders nothing for it, or when the model is unknown.
 */
export const ModelCredit = ({ used, compact = false }: { used: ModelUsed | null | undefined; compact?: boolean }) => {
  if (!used || used.kind === "unknown") return null;
  if (used.fallback) return <CortiFallbackNotice used={used} />;
  if (used.kind === "corti") return <PoweredByCorti compact={compact} />;
  return null;
};
