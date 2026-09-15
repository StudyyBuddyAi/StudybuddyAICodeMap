/**
 * Figures — structured diagram data the model emits alongside the sheet prose.
 *
 * Deliberately structured rather than a markup string (mermaid, raw SVG): every
 * value here is plain JSON that a React renderer draws deterministically, so
 * model output never reaches the DOM as markup and never needs sanitizing.
 * See src/lib/figures.ts for the validation that must run before any of this is
 * trusted.
 */

export type FigureNodeShape = "box" | "diamond" | "round";

export interface FigureNode {
  /** Unique within the figure — edges address nodes by this. */
  id: string;
  /** Plain text, never markup. */
  label: string;
  /** `diamond` marks a decision point. */
  shape?: FigureNodeShape;
}

export interface FigureEdge {
  from: string;
  to: string;
  /** Branch condition, e.g. "yes" / "no". */
  label?: string;
}

export interface FlowFigure {
  kind: "flow";
  title: string;
  nodes: FigureNode[];
  edges: FigureEdge[];
}

export interface CurveSeries {
  name: string;
  /** `[x, y]` pairs in plot order. */
  points: [number, number][];
}

export interface CurveMarker {
  x: number;
  label: string;
}

export interface CurveFigure {
  kind: "curve";
  title: string;
  xLabel: string;
  yLabel: string;
  series: CurveSeries[];
  markers?: CurveMarker[];
}

export interface CompareRow {
  /** The attribute being compared, e.g. "Proteinuria". */
  label: string;
  /** One cell per entry in `columns`, same order. */
  cells: string[];
}

export interface CompareFigure {
  kind: "compare";
  title: string;
  columns: string[];
  rows: CompareRow[];
}

export type Figure = FlowFigure | CurveFigure | CompareFigure;
