import { useState } from "react";
import { ImageIcon } from "lucide-react";
import type { GeneratedSheet, VisualImageResult } from "@/types/generated-sheet";
import type { SheetImageRequester } from "@/lib/generate-sheet-image";
import { parseIllustration } from "@/lib/parse-sheet-visual";
import ImageVisual from "./ImageVisual";
import { PlanningNote, PlanPrompt, type PlanStatus, type VisualPlanner } from "./visual-section-ui";

export interface IllustrationSectionProps {
  sheet: GeneratedSheet;
  topic: string;
  isPro?: boolean;
  disabled?: boolean;
  ensurePlan: VisualPlanner;
  onImageResolved?: (result: VisualImageResult, subject: string) => void;
  requestImage?: SheetImageRequester;
}

const CAPTION_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 12,
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--fg)",
};

const FOOTNOTE_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  color: "var(--fg-subtle)",
  letterSpacing: "0.04em",
  lineHeight: 1.5,
  marginTop: 8,
};

/**
 * The paid, least reliable half: a picture an image model draws. Separate from
 * the diagram because it costs money per new subject and gets anatomy wrong —
 * so it is asked for on its own, and always carries its warning.
 */
const IllustrationSection = ({
  sheet,
  topic,
  isPro,
  disabled = false,
  ensurePlan,
  onImageResolved,
  requestImage,
}: IllustrationSectionProps) => {
  const [status, setStatus] = useState<PlanStatus>("idle");
  // True once this student asked: the image then starts without a second click.
  const [asked, setAsked] = useState(false);
  const illustration = parseIllustration(sheet.illustration);

  const generate = async () => {
    setStatus("planning");
    setAsked(true);
    try {
      const plan = await ensurePlan(sheet, topic);
      setStatus(plan.illustration ? "idle" : "none");
    } catch {
      setStatus("failed");
    }
  };

  if (illustration) {
    return (
      <figure style={{ margin: 0 }} data-sheet-visual="image">
        <figcaption style={CAPTION_STYLE}>
          <ImageIcon style={{ width: 14, height: 14, color: "var(--accent)", flexShrink: 0 }} />
          {illustration.title}
        </figcaption>
        <ImageVisual
          topic={topic}
          view={illustration.view}
          subject={illustration.subject}
          alt={illustration.alt}
          visualImage={sheet.visualImage}
          onResolved={(result) => onImageResolved?.(result, illustration.subject)}
          isPro={isPro}
          requestImage={requestImage}
          autoStart={asked}
        />
        <p style={FOOTNOTE_STYLE}>
          AI-generated image · May contain anatomical errors · Verify against a trusted atlas before relying on it
        </p>
      </figure>
    );
  }

  if (status === "planning") return <PlanningNote>Working out what this topic looks like…</PlanningNote>;

  return (
    <PlanPrompt
      status={status}
      idleText={`Draw the structure behind this topic as a labeled illustration.${isPro ? "" : " Free plan: 3 per day."}`}
      noneText="Nothing here to draw — this topic is a process or a management strategy, not a structure."
      buttonLabel="Generate illustration"
      disabled={disabled}
      onClick={generate}
    />
  );
};

export default IllustrationSection;
