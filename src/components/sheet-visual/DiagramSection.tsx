import { useState } from "react";
import type { GeneratedSheet } from "@/types/generated-sheet";
import { parseSheetVisual } from "@/lib/parse-sheet-visual";
import SheetVisual from "./SheetVisual";
import { PlanningNote, PlanPrompt, type PlanStatus, type VisualPlanner } from "./visual-section-ui";

export interface DiagramSectionProps {
  sheet: GeneratedSheet;
  topic: string;
  disabled?: boolean;
  ensurePlan: VisualPlanner;
}

/**
 * The free half of the sheet's visuals: a flowchart or chart rendered from the
 * sheet's own words. One click plans it; nothing is requested before that.
 */
const DiagramSection = ({ sheet, topic, disabled = false, ensurePlan }: DiagramSectionProps) => {
  const [status, setStatus] = useState<PlanStatus>("idle");
  // Re-validated rather than trusted: this also comes from saved sheets.
  const diagram = parseSheetVisual(sheet.visual);

  const generate = async () => {
    setStatus("planning");
    try {
      const plan = await ensurePlan(sheet, topic);
      setStatus(plan.diagram ? "idle" : "none");
    } catch {
      setStatus("failed");
    }
  };

  if (diagram) return <SheetVisual visual={diagram} bare />;
  if (status === "planning") return <PlanningNote>Reading this sheet for a pathway or comparable numbers…</PlanningNote>;

  return (
    <PlanPrompt
      status={status}
      idleText="Turn this sheet into a diagram — a flowchart of its pathway, or a chart of the numbers it states. Free and instant."
      noneText="No diagram fits this sheet: it has no branching pathway and no comparable numbers."
      buttonLabel="Generate diagram"
      disabled={disabled}
      onClick={generate}
    />
  );
};

export default DiagramSection;
