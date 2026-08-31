import { Info } from "lucide-react";
import { t } from "@/config/i18n";

interface AIDisclaimerProps {
  /** `full` for a document a student may act on; `short` for tight surfaces. */
  variant?: "full" | "short";
  className?: string;
}

/**
 * The standing notice for anything a model wrote.
 *
 * Two things were wrong before this existed. It appeared on only two surfaces —
 * the study sheet and the flashcard review — while QBank explanations, the
 * session summary, StudyMode and the Explain panel all render model output with
 * no notice at all. And where it did appear it was 10px in `--fg-subtle`,
 * roughly 3.9:1 against the paper ground, and collapsible: the most legally
 * consequential line on the page was the least legible one and could be
 * dismissed.
 *
 * This renders in `--fg-muted` at 12px and has no dismiss control. Mount it on
 * every surface that shows generated content.
 */
const AIDisclaimer = ({ variant = "full", className = "" }: AIDisclaimerProps) => (
  <p
    className={`flex items-start gap-1.5 text-[12px] leading-relaxed text-muted-foreground ${className}`}
    data-no-print
  >
    <Info className="mt-[2px] h-3 w-3 shrink-0" aria-hidden="true" />
    <span>{t(variant === "short" ? "disclaimer.short" : "disclaimer.full")}</span>
  </p>
);

export default AIDisclaimer;
