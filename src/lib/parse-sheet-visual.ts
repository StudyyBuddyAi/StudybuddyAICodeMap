import type {
  FlowchartEdge,
  FlowchartNode,
  FlowchartNodeShape,
  VisualChartSeries,
  VisualChartSpec,
  VisualFlowchartSpec,
  VisualPlacement,
  VisualSpec,
} from "@/types/generated-sheet";

/**
 * Validating the model's `visual` plan.
 *
 * Fails closed: anything that doesn't describe a renderable visual is dropped
 * whole (returns undefined) rather than handed to the renderer half-formed.
 * `"kind": "none"` also returns undefined — no visual is the expected answer
 * for many topics, and there's nothing to keep.
 */

export const VISUAL_LIMITS = {
  nodesMin: 2,
  nodesMax: 14,
  edgesMax: 24,
  labelMax: 60,
  edgeLabelMax: 24,
  titleMax: 80,
  xLabelsMin: 2,
  xLabelsMax: 12,
  seriesMax: 4,
  imagePromptMax: 1200,
  imageSubjectMax: 80,
} as const;

const PLACEMENTS: readonly VisualPlacement[] = [
  "overview",
  "clinicalApproach",
  "keyPoints",
  "examTraps",
  "memoryHooks",
];

/** Where each kind belongs when the model names no usable section. */
const DEFAULT_PLACEMENT: Record<VisualSpec["kind"], VisualPlacement> = {
  flowchart: "clinicalApproach",
  chart: "keyPoints",
  image: "overview",
};

const SHAPES: readonly FlowchartNodeShape[] = ["start", "step", "decision", "end"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Trimmed, bold markers stripped (the renderer shows plain text), capped. */
function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const text = v.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function parseFlowchart(v: unknown): VisualFlowchartSpec | null {
  if (!isRecord(v) || !Array.isArray(v.nodes) || !Array.isArray(v.edges)) return null;

  const nodes: FlowchartNode[] = [];
  const seen = new Set<string>();
  for (const raw of v.nodes) {
    if (!isRecord(raw)) continue;
    const id = typeof raw.id === "string" || typeof raw.id === "number" ? String(raw.id).trim() : "";
    const label = cleanText(raw.label, VISUAL_LIMITS.labelMax);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    const shape = SHAPES.includes(raw.shape as FlowchartNodeShape)
      ? (raw.shape as FlowchartNodeShape)
      : "step";
    nodes.push({ id, label, shape });
    if (nodes.length === VISUAL_LIMITS.nodesMax) break;
  }
  if (nodes.length < VISUAL_LIMITS.nodesMin) return null;

  const edges: FlowchartEdge[] = [];
  for (const raw of v.edges) {
    if (!isRecord(raw)) continue;
    const from = String(raw.from ?? "").trim();
    const to = String(raw.to ?? "").trim();
    // An edge to a node that was dropped (or never existed) would make mermaid
    // invent an unlabeled box, so it goes too.
    if (!seen.has(from) || !seen.has(to) || from === to) continue;
    const label = cleanText(raw.label, VISUAL_LIMITS.edgeLabelMax);
    edges.push(label ? { from, to, label } : { from, to });
    if (edges.length === VISUAL_LIMITS.edgesMax) break;
  }
  if (edges.length === 0) return null;

  return { direction: v.direction === "LR" ? "LR" : "TD", nodes, edges };
}

function parseChart(v: unknown): VisualChartSpec | null {
  if (!isRecord(v) || !Array.isArray(v.xLabels) || !Array.isArray(v.series)) return null;

  const xLabels = v.xLabels
    .map((l) => (typeof l === "number" ? String(l) : cleanText(l, VISUAL_LIMITS.labelMax)))
    .slice(0, VISUAL_LIMITS.xLabelsMax);
  if (xLabels.length < VISUAL_LIMITS.xLabelsMin || xLabels.some((l) => !l)) return null;

  const series: VisualChartSeries[] = [];
  for (const raw of v.series) {
    if (!isRecord(raw) || !Array.isArray(raw.values)) continue;
    const name = cleanText(raw.name, VISUAL_LIMITS.labelMax);
    const values = raw.values.slice(0, xLabels.length);
    // A series with a gap or a non-number can't be plotted honestly — padding
    // it with zeros would draw data the model never gave.
    if (
      !name ||
      values.length !== xLabels.length ||
      !values.every((n): n is number => typeof n === "number" && Number.isFinite(n))
    ) {
      continue;
    }
    series.push({ name, values });
    if (series.length === VISUAL_LIMITS.seriesMax) break;
  }
  if (series.length === 0) return null;

  const yLabel = cleanText(v.yLabel, VISUAL_LIMITS.labelMax);
  return {
    chartType: v.chartType === "line" ? "line" : "bar",
    xLabels,
    series,
    ...(yLabel ? { yLabel } : {}),
  };
}

export function parseSheetVisual(v: unknown): VisualSpec | undefined {
  if (!isRecord(v)) return undefined;
  const kind = v.kind;
  if (kind !== "flowchart" && kind !== "chart" && kind !== "image") return undefined;

  const title = cleanText(v.title, VISUAL_LIMITS.titleMax);
  const placement = PLACEMENTS.includes(v.placement as VisualPlacement)
    ? (v.placement as VisualPlacement)
    : DEFAULT_PLACEMENT[kind];

  if (kind === "flowchart") {
    const flowchart = parseFlowchart(v.flowchart);
    return flowchart ? { kind, title, placement, flowchart } : undefined;
  }

  if (kind === "chart") {
    const chart = parseChart(v.chart);
    return chart ? { kind, title, placement, chart } : undefined;
  }

  const imagePrompt = typeof v.imagePrompt === "string" ? v.imagePrompt.trim() : "";
  if (!imagePrompt || imagePrompt.length > VISUAL_LIMITS.imagePromptMax) return undefined;
  const imageAlt = cleanText(v.imageAlt, 200) || title;
  const imageSubject = cleanText(v.imageSubject, VISUAL_LIMITS.imageSubjectMax) || title;
  if (!imageAlt || !imageSubject) return undefined;
  return { kind, title: title || imageAlt, placement, imagePrompt, imageAlt, imageSubject };
}
