/** Types for the geometry helpers in svg-regions.js (plain Node ESM). */
export type Matrix = [number, number, number, number, number, number];

export interface AnatomyRegion {
  label: string;
  /** Anchor on the drawing, normalised 0-1 of the viewBox. */
  x: number;
  y: number;
  /** Where the label text itself sits, same normalisation. */
  labelX: number;
  labelY: number;
  /** "leader" followed a pointer line to the structure; "label" did not. */
  confidence: "leader" | "label";
}

export declare function multiply(a: Matrix, b: Matrix): Matrix;
export declare function parseTransform(value: string): Matrix;
export declare function applyMatrix(m: Matrix, x: number, y: number): [number, number];
export declare function pathPoints(d: string): [number, number][];
export declare function extractRegions(svgText: string, JSDOM: unknown): AnatomyRegion[];
