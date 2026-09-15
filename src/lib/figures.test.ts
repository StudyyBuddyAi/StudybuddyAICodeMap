import { describe, it, expect } from "vitest";
import { FIGURE_LIMITS, figureToText, parseFigures } from "./figures";
import type { Figure } from "@/types/figure";

const flow = () => ({
  kind: "flow",
  title: "Suspected DKA",
  nodes: [
    { id: "a", label: "Suspected DKA" },
    { id: "b", label: "Glucose > 250?", shape: "diamond" },
    { id: "c", label: "Start insulin infusion" },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c", label: "yes" },
  ],
});

const curve = () => ({
  kind: "curve",
  title: "Oxygen dissociation",
  xLabel: "PO2 (mmHg)",
  yLabel: "SaO2 (%)",
  series: [{ name: "Normal", points: [[0, 0], [40, 75], [100, 98]] }],
  markers: [{ x: 27, label: "P50" }],
});

const compare = () => ({
  kind: "compare",
  title: "Nephrotic vs nephritic",
  columns: ["Nephrotic", "Nephritic"],
  rows: [{ label: "Proteinuria", cells: [">3.5 g/day", "<3.5 g/day"] }],
});

describe("parseFigures — valid input", () => {
  it("accepts one figure of each kind", () => {
    const figures = parseFigures([flow(), curve(), compare()]);
    expect(figures.map((f) => f.kind)).toEqual(["flow", "curve", "compare"]);
  });

  it("preserves node shape and edge labels", () => {
    const [figure] = parseFigures([flow()]);
    expect(figure).toMatchObject({
      kind: "flow",
      nodes: [{ id: "a" }, { id: "b", shape: "diamond" }, { id: "c" }],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c", label: "yes" }],
    });
  });

  it("omits markers entirely when the model sent none", () => {
    const { markers, ...withoutMarkers } = curve();
    expect(parseFigures([withoutMarkers])[0]).not.toHaveProperty("markers");
  });

  it("drops an unrecognized shape rather than the whole figure", () => {
    const shapeOf = (raw: unknown) => {
      const [figure] = parseFigures([raw]);
      return figure?.kind === "flow" ? figure.nodes[1].shape : "no figure";
    };

    // Asserted in both directions so the negative case cannot pass vacuously.
    expect(shapeOf(flow())).toBe("diamond");

    const input = flow();
    input.nodes[1].shape = "hexagon";
    expect(shapeOf(input)).toBeUndefined();
  });
});

describe("parseFigures — non-arrays and empties", () => {
  it.each([undefined, null, {}, "figures", 3, true])("returns [] for %s", (raw) => {
    expect(parseFigures(raw)).toEqual([]);
  });

  it("returns [] for an empty array", () => {
    expect(parseFigures([])).toEqual([]);
  });

  it("ignores an unknown kind", () => {
    expect(parseFigures([{ kind: "anatomy", title: "Nephron" }])).toEqual([]);
  });
});

describe("parseFigures — a bad figure never costs its siblings", () => {
  it("drops the invalid one and keeps the valid one", () => {
    const figures = parseFigures([{ kind: "flow", title: "Broken" }, compare()]);
    expect(figures).toHaveLength(1);
    expect(figures[0].kind).toBe("compare");
  });

  it("skips non-objects in the array", () => {
    expect(parseFigures(["nope", null, compare()])).toHaveLength(1);
  });
});

describe("parseFigures — flow graph integrity", () => {
  it("drops a figure with an edge to an undeclared node", () => {
    const input = flow();
    input.edges.push({ from: "c", to: "ghost" });
    expect(parseFigures([input])).toEqual([]);
  });

  it("drops a figure with duplicate node ids", () => {
    const input = flow();
    input.nodes[2].id = "a";
    expect(parseFigures([input])).toEqual([]);
  });

  it("drops a cyclic graph", () => {
    const input = flow();
    input.edges.push({ from: "c", to: "a" });
    expect(parseFigures([input])).toEqual([]);
  });

  it("drops a self-loop", () => {
    const input = flow();
    input.edges.push({ from: "c", to: "c" });
    expect(parseFigures([input])).toEqual([]);
  });

  it("drops a rootless graph where every node has an incoming edge", () => {
    const input = flow();
    input.edges.push({ from: "c", to: "a" }, { from: "c", to: "b" });
    expect(parseFigures([input])).toEqual([]);
  });

  it("terminates on a fully connected cyclic graph rather than hanging", () => {
    // The cycle check runs before any layout, so a pathological graph must
    // return instead of walking forever. Node count sits at the cap.
    const size = FIGURE_LIMITS.flowNodes;
    const nodes = Array.from({ length: size }, (_, i) => ({ id: `n${i}`, label: `Step ${i}` }));
    const edges = Array.from({ length: size }, (_, i) => ({
      from: `n${i}`,
      to: `n${(i + 1) % size}`,
    }));
    expect(parseFigures([{ kind: "flow", title: "Cycle", nodes, edges }])).toEqual([]);
  });
});

describe("parseFigures — caps", () => {
  it("keeps only the first perSheet figures", () => {
    const many = Array.from({ length: FIGURE_LIMITS.perSheet + 2 }, compare);
    expect(parseFigures(many)).toHaveLength(FIGURE_LIMITS.perSheet);
  });

  it("drops a flow over the node cap", () => {
    const size = FIGURE_LIMITS.flowNodes + 1;
    const nodes = Array.from({ length: size }, (_, i) => ({ id: `n${i}`, label: `Step ${i}` }));
    expect(parseFigures([{ kind: "flow", title: "Too many", nodes, edges: [] }])).toEqual([]);
  });

  it("drops a curve over the point cap", () => {
    const input = curve();
    input.series[0].points = Array.from(
      { length: FIGURE_LIMITS.curvePoints + 1 },
      (_, i) => [i, i] as [number, number]
    );
    expect(parseFigures([input])).toEqual([]);
  });

  it("drops a curve over the marker cap", () => {
    const input = curve();
    input.markers = Array.from({ length: FIGURE_LIMITS.curveMarkers + 1 }, (_, i) => ({
      x: i,
      label: `M${i}`,
    }));
    expect(parseFigures([input])).toEqual([]);
  });

  it("drops a label over the character cap rather than truncating it", () => {
    const input = compare();
    input.rows[0].cells[0] = "x".repeat(FIGURE_LIMITS.label + 1);
    expect(parseFigures([input])).toEqual([]);
  });
});

describe("parseFigures — curve numbers", () => {
  it.each([NaN, Infinity, -Infinity, "40", null])("drops a series containing %s", (bad) => {
    const input = curve();
    input.series[0].points[1] = [bad, 75] as unknown as [number, number];
    expect(parseFigures([input])).toEqual([]);
  });

  it("drops a series with a single point, which is not a curve", () => {
    const input = curve();
    input.series[0].points = [[0, 0]];
    expect(parseFigures([input])).toEqual([]);
  });

  it("drops a malformed point pair", () => {
    const input = curve();
    input.series[0].points[1] = [40] as unknown as [number, number];
    expect(parseFigures([input])).toEqual([]);
  });
});

describe("parseFigures — compare alignment", () => {
  it("drops a row whose cell count does not match the columns", () => {
    const input = compare();
    input.rows[0].cells = ["only one"];
    expect(parseFigures([input])).toEqual([]);
  });

  it("drops a single-column comparison", () => {
    const input = compare();
    input.columns = ["Nephrotic"];
    input.rows[0].cells = [">3.5 g/day"];
    expect(parseFigures([input])).toEqual([]);
  });
});

describe("figureToText", () => {
  const textOf = (raw: unknown): string => figureToText(parseFigures([raw])[0] as Figure);

  it("renders a flow as resolved node labels, not ids", () => {
    const text = textOf(flow());
    expect(text).toContain("Suspected DKA (flowchart)");
    expect(text).toContain("Suspected DKA → Glucose > 250?");
    expect(text).toContain("Glucose > 250? → Start insulin infusion [yes]");
  });

  it("renders a curve as its axis ranges and markers", () => {
    const text = textOf(curve());
    expect(text).toContain("Oxygen dissociation (curve)");
    expect(text).toContain("Normal: PO2 (mmHg) 0–100, SaO2 (%) 0–98");
    expect(text).toContain("At PO2 (mmHg) 27: P50");
  });

  it("pairs each compare cell with its column heading", () => {
    const text = textOf(compare());
    expect(text).toContain("Nephrotic vs nephritic (comparison)");
    expect(text).toContain("Proteinuria: Nephrotic = >3.5 g/day; Nephritic = <3.5 g/day");
  });

  it("produces non-empty text for every kind, since it also feeds the SVG desc", () => {
    for (const raw of [flow(), curve(), compare()]) {
      expect(textOf(raw).trim().length).toBeGreaterThan(0);
    }
  });
});
