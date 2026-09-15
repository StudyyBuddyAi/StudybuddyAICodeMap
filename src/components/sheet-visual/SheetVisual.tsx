import { lazy, Suspense } from "react";
import { BarChart3, Workflow } from "lucide-react";
import type { VisualSpec } from "@/types/generated-sheet";
import SectionSkeleton from "@/components/SectionSkeleton";

// Each renderer pulls in a heavy library (mermaid, recharts), so a sheet only
// downloads the one its visual actually needs.
const FlowchartVisual = lazy(() => import("./FlowchartVisual"));
const ChartVisual = lazy(() => import("./ChartVisual"));

export interface SheetVisualProps {
  visual: VisualSpec;
}

const KIND_META = {
  flowchart: { icon: Workflow, label: "Flowchart", note: "Drawn from this sheet's text" },
  chart: { icon: BarChart3, label: "Chart", note: "Values taken from this sheet" },
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
const SheetVisual = ({ visual }: SheetVisualProps) => {
  if (visual.kind !== "flowchart" && visual.kind !== "chart") return null;
  const meta = KIND_META[visual.kind];
  const Icon = meta.icon;

  return (
    <figure className="animate-fade-in" style={FIGURE_STYLE} data-sheet-visual={visual.kind}>
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

      <Suspense fallback={<SectionSkeleton variant="sheet-body" />}>
        {visual.kind === "flowchart" ? (
          <FlowchartVisual spec={visual.flowchart} title={visual.title} />
        ) : (
          <ChartVisual spec={visual.chart} title={visual.title} />
        )}
      </Suspense>

      <p style={FOOTNOTE_STYLE}>
        {meta.note} · AI-generated · Verify before relying on it
      </p>
    </figure>
  );
};

export default SheetVisual;
