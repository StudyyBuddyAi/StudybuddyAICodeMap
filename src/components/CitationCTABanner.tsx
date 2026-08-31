import { BookOpen } from "lucide-react";
import { LIMITS } from "@/config/product";
import { t } from "@/config/i18n";

interface CitationCTABannerProps {
  onSignInClick: () => void;
  /** Uses left today. Omit while the count is still loading. */
  remaining?: number;
}

/**
 * Anonymous-user prompt for the citation feature.
 *
 * The copy used to read "no account needed" directly beside a button labelled
 * "Sign In", and never said how much of the free allowance was left. Both are
 * now stated from config: the offer explains what you get *without* an account,
 * and the button explains what signing in *adds* — so the two halves agree.
 */
const CitationCTABanner = ({
  onSignInClick,
  remaining,
}: CitationCTABannerProps) => {
  // Anonymous users get so few that the difference between "you have one" and
  // "you have used it" is the whole message. Until the count loads, state the
  // allowance rather than guessing at it.
  const offer =
    remaining === undefined
      ? t("citations.anonOffer", { anon: LIMITS.citations.anon })
      : remaining > 0
      ? t("citations.anonOffer", { anon: remaining })
      : t("citations.exhausted");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        borderInlineStart: "3px solid var(--accent)",
        background: "var(--bg)",
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          flexShrink: 0,
        }}
      >
        <BookOpen style={{ width: 14, height: 14, color: "var(--accent)" }} />
      </div>
      <p
        style={{
          flex: 1,
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          color: "var(--fg-muted)",
          lineHeight: 1.4,
          margin: 0,
        }}
      >
        {offer}{" "}
        <span style={{ color: "var(--fg)" }}>
          A free account gets {LIMITS.citations.free} a day.
        </span>
      </p>
      <button
        type="button"
        onClick={onSignInClick}
        style={{
          padding: "6px 12px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-strong)",
          background: "var(--bg-elevated)",
          color: "var(--fg)",
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          fontWeight: 500,
          cursor: "pointer",
          flexShrink: 0,
          transition: "border-color var(--dur-micro) var(--ease-out)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "var(--fg)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--border-strong)";
        }}
      >
        Sign in
      </button>
    </div>
  );
};

export default CitationCTABanner;
