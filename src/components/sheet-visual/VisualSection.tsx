import { useState } from "react";
import { Sparkles, RotateCcw, Loader2 } from "lucide-react";
import type { GeneratedSheet, VisualImageResult, VisualSpec } from "@/types/generated-sheet";
import type { SheetImageRequester } from "@/lib/generate-sheet-image";
import { planSheetVisual } from "@/lib/plan-sheet-visual";
import { parseSheetVisual } from "@/lib/parse-sheet-visual";
import SheetVisual from "./SheetVisual";

export type VisualPlanner = (sheet: GeneratedSheet, fallbackTopic: string) => Promise<VisualSpec | undefined>;

export interface VisualSectionProps {
  sheet: GeneratedSheet;
  topic: string;
  isPro?: boolean;
  /** True while the sheet is still streaming — there is nothing to plan from yet. */
  disabled?: boolean;
  onPlanned?: (visual: VisualSpec) => void;
  onImageResolved?: (result: VisualImageResult, subject: string) => void;
  /** Test/preview seams; default to the real edge functions. */
  requestPlan?: VisualPlanner;
  requestImage?: SheetImageRequester;
}

type Status = "idle" | "planning" | "none" | "failed";

const BUTTON_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 34,
  padding: "0 16px",
  borderRadius: "var(--radius-md)",
  border: "1px solid transparent",
  background: "var(--fg)",
  color: "var(--bg)",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const NOTE_STYLE: React.CSSProperties = {
  flex: "1 1 240px",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  color: "var(--fg-muted)",
  lineHeight: 1.55,
};

/**
 * The sheet's visual aid, as its own section.
 *
 * One button: it asks sheet-visual what this sheet's content calls for, and
 * renders whatever comes back — a flowchart or chart straight away (free), or
 * an illustration, which starts generating in the same click since the student
 * already asked for it. Nothing is requested until that click.
 */
const VisualSection = ({
  sheet,
  topic,
  isPro,
  disabled = false,
  onPlanned,
  onImageResolved,
  requestPlan = planSheetVisual,
  requestImage,
}: VisualSectionProps) => {
  const [status, setStatus] = useState<Status>("idle");
  // Only a visual planned by this click auto-generates its image; one restored
  // from a saved sheet waits for the student to ask again.
  const [planClicked, setPlanClicked] = useState(false);

  // Re-validated rather than trusted: this also comes from saved sheets, whose
  // JSON may predate the current shape.
  const visual = parseSheetVisual(sheet.visual);

  const generate = async () => {
    setStatus("planning");
    setPlanClicked(true);
    try {
      const planned = await requestPlan(sheet, topic);
      if (!planned) {
        setStatus("none");
        return;
      }
      setStatus("idle");
      onPlanned?.(planned);
    } catch {
      setStatus("failed");
    }
  };

  if (visual) {
    return (
      <SheetVisual
        visual={visual}
        topic={topic}
        visualImage={sheet.visualImage}
        onImageResolved={onImageResolved}
        isPro={isPro}
        requestImage={requestImage}
        autoStartImage={planClicked}
        bare
      />
    );
  }

  if (status === "planning") {
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-2" style={NOTE_STYLE}>
        <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--accent)" }} />
        Reading this sheet to choose the right visual…
      </div>
    );
  }

  const message =
    status === "none"
      ? "This sheet reads better as text — no diagram or illustration would add to it."
      : status === "failed"
      ? "Couldn't build a visual just now. The rest of the sheet is unaffected."
      : "Build one visual from this sheet: a flowchart for a pathway, a chart for its numbers, or a labeled illustration for a structure.";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p style={NOTE_STYLE}>{message}</p>
      <button type="button" style={{ ...BUTTON_STYLE, opacity: disabled ? 0.5 : 1 }} onClick={generate} disabled={disabled}>
        {status === "idle" ? <Sparkles style={{ width: 14, height: 14 }} /> : <RotateCcw style={{ width: 14, height: 14 }} />}
        {status === "idle" ? "Generate visual" : "Try again"}
      </button>
    </div>
  );
};

export default VisualSection;
