import { lazy, Suspense } from "react";
import { BarChart3, ImageIcon, Workflow } from "lucide-react";
import type { VisualImageResult, VisualSpec } from "@/types/generated-sheet";
import type { SheetImageRequester } from "@/lib/generate-sheet-image";
import SectionSkeleton from "@/components/SectionSkeleton";
import ImageVisual from "./ImageVisual";

// Each renderer pulls in a heavy library (mermaid, recharts), so a sheet only
// downloads the one its visual actually needs.
const FlowchartVisual = lazy(() => import("./FlowchartVisual"));
const ChartVisual = lazy(() => import("./ChartVisual"));

export interface SheetVisualProps {
  visual: VisualSpec;
  /** Sheet topic — half of an image request. */
  topic: string;
  visualImage?: VisualImageResult;
  onImageResolved?: (result: VisualImageResult, subject: string) => void;
  isPro?: boolean;
  /** Test/preview seam; defaults to the real edge function. */
  requestImage?: SheetImageRequester;
  /** Start the image request on mount — the student already asked, in the click that planned this. */
  autoStartImage?: boolean;
  /** Inside the Visual section the card already has a header, so drop the top margin. */
  bare?: boolean;
}

const KIND_META = {
  flowchart: { icon: Workflow, label: "Flowchart", note: "Drawn from this sheet's text · AI-generated · Verify before relying on it" },
  chart: { icon: BarChart3, label: "Chart", note: "Values taken from this sheet · AI-generated · Verify before relying on it" },
  image: { icon: ImageIcon, label: "Illustration", note: "AI-generated image · May contain anatomical errors · Verify against a trusted atlas before relying on it" },
} as const;

const FIGURE_STYLE: React.CSSProperties = {
  marginTop: 16,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-elevated)",
  padding: "12px 16px 10px",
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
 * The sheet's one visual aid, mounted at the end of the section it illustrates.
 * An enhancement, never load-bearing: every failure path degrades to text.
 */
const SheetVisual = ({ visual, topic, visualImage, onImageResolved, isPro, requestImage, autoStartImage, bare }: SheetVisualProps) => {
  const meta = KIND_META[visual.kind];
  const Icon = meta.icon;

  return (
    <figure
      className="animate-fade-in"
      style={bare ? { ...FIGURE_STYLE, marginTop: 0, border: "none", padding: 0, background: "transparent" } : FIGURE_STYLE}
      data-sheet-visual={visual.kind}
    >
      <figcaption className="mb-3 flex items-center gap-2">
        <Icon style={{ width: 14, height: 14, color: "var(--accent)", flexShrink: 0 }} />
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--fg)",
          }}
        >
          {visual.title || meta.label}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--fg-subtle)",
          }}
        >
          {meta.label}
        </span>
      </figcaption>

      {visual.kind === "image" ? (
        <ImageVisual
          topic={topic}
          view={visual.imageView}
          subject={visual.imageSubject}
          alt={visual.imageAlt}
          visualImage={visualImage}
          onResolved={(result) => onImageResolved?.(result, visual.imageSubject)}
          isPro={isPro}
          requestImage={requestImage}
          autoStart={autoStartImage}
        />
      ) : (
        <Suspense fallback={<SectionSkeleton variant="sheet-body" />}>
          {visual.kind === "flowchart" ? (
            <FlowchartVisual spec={visual.flowchart} title={visual.title} />
          ) : (
            <ChartVisual spec={visual.chart} title={visual.title} />
          )}
        </Suspense>
      )}

      <p style={FOOTNOTE_STYLE}>{meta.note}</p>
    </figure>
  );
};

export default SheetVisual;
