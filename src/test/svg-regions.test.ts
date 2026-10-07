import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import {
  multiply,
  parseTransform,
  applyMatrix,
  pathPoints,
  extractRegions,
  type Matrix,
} from "../../scripts/svg-regions.js";

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const at = (t: string, x: number, y: number) => applyMatrix(parseTransform(t), x, y);

describe("parseTransform", () => {
  it("reads a translate", () => {
    expect(at("translate(10 20)", 1, 2)).toEqual([11, 22]);
  });

  it("reads a scale, including the single-argument form", () => {
    expect(at("scale(2 3)", 4, 5)).toEqual([8, 15]);
    expect(at("scale(2)", 4, 5)).toEqual([8, 10]);
  });

  it("reads a matrix", () => {
    expect(at("matrix(1 0 0 1 7 9)", 0, 0)).toEqual([7, 9]);
  });

  it("rotates about the origin", () => {
    const [x, y] = at("rotate(90)", 1, 0);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(1, 6);
  });

  it("rotates about a given centre", () => {
    const [x, y] = at("rotate(180 5 5)", 5, 6);
    expect(x).toBeCloseTo(5, 6);
    expect(y).toBeCloseTo(4, 6);
  });

  it("applies several transforms left to right, as SVG does", () => {
    expect(at("translate(10 0) scale(2)", 3, 0)).toEqual([16, 0]);
  });

  it("ignores an unknown or empty transform instead of throwing", () => {
    expect(parseTransform("")).toEqual(IDENTITY);
    expect(parseTransform("skewX(20)")).toEqual(IDENTITY);
  });
});

describe("multiply", () => {
  it("leaves a matrix unchanged against the identity", () => {
    const m: Matrix = [2, 0, 0, 3, 4, 5];
    expect(multiply(m, IDENTITY)).toEqual(m);
    expect(multiply(IDENTITY, m)).toEqual(m);
  });
});

describe("pathPoints", () => {
  it("reads absolute commands", () => {
    expect(pathPoints("M 10 20 L 30 40")).toEqual([[10, 20], [30, 40]]);
  });

  it("accumulates relative commands", () => {
    expect(pathPoints("m 10 10 l 5 5 l 5 0")).toEqual([[10, 10], [15, 15], [20, 15]]);
  });

  it("handles horizontal and vertical shorthands", () => {
    expect(pathPoints("M 0 0 H 10 V 5")).toEqual([[0, 0], [10, 0], [10, 5]]);
    expect(pathPoints("M 0 0 h 10 v 5")).toEqual([[0, 0], [10, 0], [10, 5]]);
  });

  it("takes only the end point of a curve, not its control points", () => {
    expect(pathPoints("M 0 0 C 1 1 2 2 3 3")).toEqual([[0, 0], [3, 3]]);
  });

  it("treats repeated pairs after a moveto as linetos, per the spec", () => {
    expect(pathPoints("M 0 0 5 5 10 10")).toEqual([[0, 0], [5, 5], [10, 10]]);
  });

  it("returns nothing for empty or unparseable input", () => {
    expect(pathPoints("")).toEqual([]);
    expect(pathPoints("Z")).toEqual([]);
  });
});

/** Minimal SVG: labels in the left margin, leaders pointing right. */
const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">${inner}</svg>`;

const label = (text: string, x: number, y: number) => `<text x="${x}" y="${y}">${text}</text>`;
const leader = (x1: number, y1: number, x2: number, y2: number) =>
  `<path fill="none" d="M ${x1} ${y1} L ${x2} ${y2}"/>`;

describe("extractRegions", () => {
  it("follows a leader line from the label to the structure", () => {
    const [r] = extractRegions(svg(label("Aorta", 100, 500) + leader(110, 500, 600, 500)), JSDOM);
    expect(r.label).toBe("Aorta");
    expect(r.confidence).toBe("leader");
    // Anchored at the far end (0.6), not at the label (0.1).
    expect(r.x).toBeCloseTo(0.6, 2);
    expect(r.labelX).toBeCloseTo(0.1, 2);
  });

  it("falls back to the label's own position when no leader points at it", () => {
    const [r] = extractRegions(svg(label("Diaphragm", 100, 500)), JSDOM);
    expect(r.confidence).toBe("label");
    expect(r.x).toBeCloseTo(0.1, 2);
  });

  it("resolves coordinates through nested ancestor transforms", () => {
    const nested = svg(
      `<g transform="translate(100 0)"><g transform="scale(2)">${label("Heart", 50, 100)}</g></g>`
    );
    const [r] = extractRegions(nested, JSDOM);
    // 50*2 + 100 = 200 -> 0.2 across a 1000-wide viewBox.
    expect(r.x).toBeCloseTo(0.2, 3);
    expect(r.y).toBeCloseTo(0.2, 3);
  });

  it("keeps only the English text of a multilingual switch", () => {
    const out = extractRegions(
      svg(
        `<switch><text systemLanguage="eu" x="100" y="100">Gibela</text>` +
          `<text x="100" y="100">Liver</text></switch>`
      ),
      JSDOM
    );
    expect(out.map((r) => r.label)).toEqual(["Liver"]);
  });

  it("drops legend entries", () => {
    expect(extractRegions(svg(label("A. = artery", 100, 100)), JSDOM)).toEqual([]);
  });

  it("rejoins a label the illustrator split across two lines", () => {
    // "Small" has no leader; "intestine" does. One structure, two text nodes.
    const out = extractRegions(
      svg(label("Small", 100, 500) + label("intestine", 100, 520) + leader(110, 520, 700, 520)),
      JSDOM
    );
    expect(out.map((r) => r.label)).toEqual(["Small intestine"]);
    expect(out[0].x).toBeCloseTo(0.7, 2);
  });

  it("does not merge a stack of separate structures that each have a leader", () => {
    // Superior / Middle / Inferior each point at their own lobe. Merging these
    // would turn three structures into one meaningless label.
    const out = extractRegions(
      svg(
        label("Superior", 100, 500) + leader(110, 500, 700, 480) +
        label("Middle", 100, 520) + leader(110, 520, 700, 520) +
        label("Inferior", 100, 540) + leader(110, 540, 700, 560)
      ),
      JSDOM
    );
    expect(out.map((r) => r.label).sort()).toEqual(["Inferior", "Middle", "Superior"]);
  });

  it("drops a fragment that never found its other half", () => {
    expect(extractRegions(svg(label("duct", 100, 100)), JSDOM)).toEqual([]);
  });

  it("de-duplicates a label repeated across the drawing", () => {
    const out = extractRegions(svg(label("Aorta", 100, 100) + label("Aorta", 400, 400)), JSDOM);
    expect(out).toHaveLength(1);
  });

  it("returns nothing when the file has no viewBox to normalise against", () => {
    expect(extractRegions(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`, JSDOM)).toEqual([]);
  });
});
