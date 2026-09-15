import type {
  CompareFigure,
  CompareRow,
  CurveFigure,
  CurveMarker,
  CurveSeries,
  Figure,
  FigureEdge,
  FigureNode,
  FigureNodeShape,
  FlowFigure,
} from "@/types/figure";

/**
 * Validating model-generated figures.
 *
 * A figure is studied by medical students and reads as more authoritative than
 * prose, so this fails closed everywhere: anything malformed, ambiguous, or
 * beyond a cap is dropped entirely rather than repaired into something
 * plausible-looking. Valid siblings survive — one bad figure never costs the
 * others, mirroring how asFlashcards drops half-written cards.
 *
 * Never throws. Returns [] for anything it cannot vouch for.
 */

/**
 * Caps bound three things at once: the localStorage payload for anonymous
 * users, render complexity, and how much a truncated stream can cost.
 */
export const FIGURE_LIMITS = {
  perSheet: 3,
  flowNodes: 8,
  flowEdges: 12,
  curveSeries: 2,
  curvePoints: 40,
  curveMarkers: 4,
  compareColumns: 6,
  compareRows: 8,
  /** Any label, cell, axis name or series name. */
  label: 80,
  title: 60,
  nodeId: 24,
} as const;

const NODE_SHAPES: readonly FigureNodeShape[] = ["box", "diamond", "round"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * A trimmed, non-empty string within `max`.
 *
 * Over-long text is rejected, never truncated: clipping medical content can
 * invert its meaning ("do not give aspirin" -> "do not give"), so the figure is
 * dropped instead. The prompt asks the model to stay under the cap.
 */
function asLabel(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/** Node ids that no edge points at — where a layered layout starts. */
function rootsOf(nodes: FigureNode[], edges: FigureEdge[]): FigureNode[] {
  const hasIncoming = new Set(edges.map((e) => e.to));
  return nodes.filter((n) => !hasIncoming.has(n.id));
}

/**
 * Depth-first three-colour cycle check. Also catches self-loops, since a node
 * reaching itself is found mid-visit like any other back edge.
 */
function hasCycle(nodes: FigureNode[], edges: FigureEdge[]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) adjacency.get(edge.from)?.push(edge.to);

  const VISITING = 1;
  const DONE = 2;
  const state = new Map<string, number>();

  const walk = (id: string): boolean => {
    const seen = state.get(id);
    if (seen === VISITING) return true;
    if (seen === DONE) return false;
    state.set(id, VISITING);
    for (const next of adjacency.get(id) ?? []) {
      if (walk(next)) return true;
    }
    state.set(id, DONE);
    return false;
  };

  return nodes.some((node) => walk(node.id));
}

function parseFlow(raw: Record<string, unknown>): FlowFigure | null {
  const title = asLabel(raw.title, FIGURE_LIMITS.title);
  if (!title) return null;
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null;
  if (!raw.nodes.length || raw.nodes.length > FIGURE_LIMITS.flowNodes) return null;
  if (raw.edges.length > FIGURE_LIMITS.flowEdges) return null;

  const nodes: FigureNode[] = [];
  const ids = new Set<string>();
  for (const candidate of raw.nodes) {
    if (!isRecord(candidate)) return null;
    const id = asLabel(candidate.id, FIGURE_LIMITS.nodeId);
    const label = asLabel(candidate.label, FIGURE_LIMITS.label);
    // A repeated id makes every edge touching it ambiguous.
    if (!id || !label || ids.has(id)) return null;
    ids.add(id);
    const shape = NODE_SHAPES.includes(candidate.shape as FigureNodeShape)
      ? (candidate.shape as FigureNodeShape)
      : undefined;
    nodes.push(shape ? { id, label, shape } : { id, label });
  }

  const edges: FigureEdge[] = [];
  for (const candidate of raw.edges) {
    if (!isRecord(candidate)) return null;
    const from = asLabel(candidate.from, FIGURE_LIMITS.nodeId);
    const to = asLabel(candidate.to, FIGURE_LIMITS.nodeId);
    // An edge to an undeclared node is a step the model implied but never
    // wrote — an arrow into nothing, which would read as a real instruction.
    if (!from || !to || !ids.has(from) || !ids.has(to)) return null;
    let label: string | undefined;
    if (candidate.label !== undefined) {
      const parsed = asLabel(candidate.label, FIGURE_LIMITS.label);
      if (!parsed) return null;
      label = parsed;
    }
    edges.push(label ? { from, to, label } : { from, to });
  }

  // FlowFigure lays out by longest-path-from-roots, which does not terminate on
  // a cycle and has nowhere to start without a root. Real pathways often do
  // contain feedback loops (RAAS, the complement cascade) — those are refused
  // here, so the renderer can assume a well-formed DAG.
  if (hasCycle(nodes, edges) || !rootsOf(nodes, edges).length) return null;

  return { kind: "flow", title, nodes, edges };
}

function parseCurve(raw: Record<string, unknown>): CurveFigure | null {
  const title = asLabel(raw.title, FIGURE_LIMITS.title);
  const xLabel = asLabel(raw.xLabel, FIGURE_LIMITS.label);
  const yLabel = asLabel(raw.yLabel, FIGURE_LIMITS.label);
  if (!title || !xLabel || !yLabel) return null;
  if (!Array.isArray(raw.series)) return null;
  if (!raw.series.length || raw.series.length > FIGURE_LIMITS.curveSeries) return null;

  const series: CurveSeries[] = [];
  for (const candidate of raw.series) {
    if (!isRecord(candidate)) return null;
    const name = asLabel(candidate.name, FIGURE_LIMITS.label);
    if (!name || !Array.isArray(candidate.points)) return null;
    // Two points is the minimum that describes a line; one is not a curve.
    if (candidate.points.length < 2 || candidate.points.length > FIGURE_LIMITS.curvePoints) {
      return null;
    }
    const points: [number, number][] = [];
    for (const point of candidate.points) {
      if (!Array.isArray(point) || point.length !== 2) return null;
      const [x, y] = point;
      // NaN or Infinity would collapse the axis scale for the whole figure.
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
      points.push([x, y]);
    }
    series.push({ name, points });
  }

  let markers: CurveMarker[] | undefined;
  if (raw.markers !== undefined) {
    if (!Array.isArray(raw.markers)) return null;
    // Uncapped markers would both bloat the payload and overplot the axis.
    if (raw.markers.length > FIGURE_LIMITS.curveMarkers) return null;
    const parsed: CurveMarker[] = [];
    for (const candidate of raw.markers) {
      if (!isRecord(candidate)) return null;
      const label = asLabel(candidate.label, FIGURE_LIMITS.label);
      if (!label || !isFiniteNumber(candidate.x)) return null;
      parsed.push({ x: candidate.x, label });
    }
    if (parsed.length) markers = parsed;
  }

  return markers
    ? { kind: "curve", title, xLabel, yLabel, series, markers }
    : { kind: "curve", title, xLabel, yLabel, series };
}

function parseCompare(raw: Record<string, unknown>): CompareFigure | null {
  const title = asLabel(raw.title, FIGURE_LIMITS.title);
  if (!title || !Array.isArray(raw.columns)) return null;
  // Fewer than two columns is not a comparison.
  if (raw.columns.length < 2 || raw.columns.length > FIGURE_LIMITS.compareColumns) return null;

  const columns: string[] = [];
  for (const candidate of raw.columns) {
    const column = asLabel(candidate, FIGURE_LIMITS.label);
    if (!column) return null;
    columns.push(column);
  }

  if (!Array.isArray(raw.rows)) return null;
  if (!raw.rows.length || raw.rows.length > FIGURE_LIMITS.compareRows) return null;

  const rows: CompareRow[] = [];
  for (const candidate of raw.rows) {
    if (!isRecord(candidate)) return null;
    const label = asLabel(candidate.label, FIGURE_LIMITS.label);
    if (!label || !Array.isArray(candidate.cells)) return null;
    // A short or long row would silently shift values under the wrong heading.
    if (candidate.cells.length !== columns.length) return null;
    const cells: string[] = [];
    for (const cell of candidate.cells) {
      const text = asLabel(cell, FIGURE_LIMITS.label);
      if (!text) return null;
      cells.push(text);
    }
    rows.push({ label, cells });
  }

  return { kind: "compare", title, columns, rows };
}

/**
 * Validate the model's raw `figures` value into figures safe to render.
 *
 * Invalid figures are dropped individually; anything past `perSheet` is
 * ignored. Returns [] when the field is missing or is not an array, which is
 * also the correct result for a sheet generated with figures switched off.
 */
export function parseFigures(raw: unknown): Figure[] {
  if (!Array.isArray(raw)) return [];

  const figures: Figure[] = [];
  for (const candidate of raw) {
    if (figures.length >= FIGURE_LIMITS.perSheet) break;
    if (!isRecord(candidate)) continue;

    const figure =
      candidate.kind === "flow"
        ? parseFlow(candidate)
        : candidate.kind === "curve"
        ? parseCurve(candidate)
        : candidate.kind === "compare"
        ? parseCompare(candidate)
        : null;

    if (figure) figures.push(figure);
  }
  return figures;
}

const range = (values: number[]): string => {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? `${low}` : `${low}–${high}`;
};

/**
 * Flatten a figure to plain text.
 *
 * Load-bearing twice: it is the Share/clipboard representation *and* the SVG
 * `<desc>` a screen reader announces. Keeping both on one function means the
 * text a non-sighted reader hears cannot drift from the text a Share recipient
 * gets.
 */
export function figureToText(figure: Figure): string {
  switch (figure.kind) {
    case "flow": {
      const labelOf = new Map(figure.nodes.map((node) => [node.id, node.label]));
      const steps = figure.edges.map((edge) => {
        const condition = edge.label ? ` [${edge.label}]` : "";
        return `  ${labelOf.get(edge.from)} → ${labelOf.get(edge.to)}${condition}`;
      });
      return [`${figure.title} (flowchart)`, ...steps].join("\n");
    }

    case "curve": {
      const lines = figure.series.map((series) => {
        const xs = series.points.map(([x]) => x);
        const ys = series.points.map(([, y]) => y);
        return `  ${series.name}: ${figure.xLabel} ${range(xs)}, ${figure.yLabel} ${range(ys)}`;
      });
      const markers =
        figure.markers?.map((marker) => `  At ${figure.xLabel} ${marker.x}: ${marker.label}`) ?? [];
      return [`${figure.title} (curve)`, ...lines, ...markers].join("\n");
    }

    case "compare": {
      // Paired as "column = value" rather than an aligned ASCII table: a screen
      // reader announcing a table of spaces conveys nothing.
      const lines = figure.rows.map((row) => {
        const pairs = row.cells.map((cell, i) => `${figure.columns[i]} = ${cell}`);
        return `  ${row.label}: ${pairs.join("; ")}`;
      });
      return [`${figure.title} (comparison)`, ...lines].join("\n");
    }
  }
}
