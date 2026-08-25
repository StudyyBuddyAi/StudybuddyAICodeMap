import { AlertTriangle } from "lucide-react";
import { SECTION_LABELS } from "@/lib/grounding";
import type { GroundingLevel, SourceCoverage } from "@/types/generated-sheet";

const CARD_STYLE: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderLeft: "2px solid var(--highlight)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-elevated)",
  padding: "14px 16px",
  display: "flex",
  gap: 10,
};

const ICON_WRAP_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  borderRadius: "var(--radius-sm)",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  flexShrink: 0,
};

const HEADLINE_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--fg)",
  margin: 0,
};

const BODY_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  color: "var(--fg-muted)",
  lineHeight: 1.55,
  margin: "4px 0 0",
};

type NoticeReason = "no-match" | "not-relevant" | "disabled";

const NONE_HEADLINES: Record<NoticeReason, string> = {
  "no-match": "We don't have this topic in our reference library.",
  "not-relevant": "Our library didn't cover this topic well enough.",
  disabled: "Guideline library turned off for this sheet.",
};

const VERIFY_LINE = "Check this against a primary source before exam or clinical use.";

interface GroundingNoticeProps {
  level: GroundingLevel | null;
  coverage?: SourceCoverage;
  /**
   * Only meaningful when level === "none". Omit for a legacy row where the
   * reason genuinely isn't known — this renders the verify line with no
   * reason-specific headline rather than guessing "no-match".
   */
  reason?: NoticeReason;
}

/**
 * Non-dismissible warning shown above OutputSection when a sheet's content
 * doesn't fully rest on the retrieved guideline library. No close button, no
 * "don't show again" — this is a property of the document, not a toast, and
 * it must reappear identically every time the sheet is reopened.
 */
const GroundingNotice = ({ level, coverage, reason }: GroundingNoticeProps) => {
  if (level === "full" || level === null) return null;

  const headline =
    level === "none"
      ? reason
        ? NONE_HEADLINES[reason]
        : null
      : "Partly covered by our library.";

  const uncoveredLabels = (coverage?.uncovered ?? []).map((k) => SECTION_LABELS[k]).filter(Boolean);

  return (
    <div className="animate-fade-in" style={CARD_STYLE} role="note">
      <div style={ICON_WRAP_STYLE}>
        <AlertTriangle style={{ width: 13, height: 13, color: "var(--highlight)" }} />
      </div>
      <div style={{ minWidth: 0 }}>
        {headline && <p style={HEADLINE_STYLE}>{headline}</p>}
        {level === "partial" && uncoveredLabels.length > 0 && (
          <p style={BODY_STYLE}>
            {uncoveredLabels.join(", ")} {uncoveredLabels.length === 1 ? "was" : "were"} written from general
            medical knowledge.
          </p>
        )}
        <p style={{ ...BODY_STYLE, marginTop: headline || (level === "partial" && uncoveredLabels.length > 0) ? 4 : 0 }}>
          {VERIFY_LINE}
        </p>
      </div>
    </div>
  );
};

export default GroundingNotice;
