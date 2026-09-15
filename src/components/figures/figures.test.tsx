import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import CurveFigure from "./CurveFigure";
import CompareFigure from "./CompareFigure";
import FlowFigure from "./FlowFigure";
import { FIGURE_PROVENANCE } from "./FigureFrame";
import { FIGURE_LIMITS, figureToText, parseFigures } from "@/lib/figures";
import type {
  CompareFigure as CompareData,
  CurveFigure as CurveData,
  FlowFigure as FlowData,
} from "@/types/figure";

/** Fixtures go through the real validator, so a test can never render data the app would reject. */
function validated<T>(raw: unknown): T {
  const [figure] = parseFigures([raw]);
  if (!figure) throw new Error("fixture failed validation");
  return figure as T;
}

const curve = () =>
  validated<CurveData>({
    kind: "curve",
    title: "Oxygen dissociation",
    xLabel: "PO2 (mmHg)",
    yLabel: "SaO2 (%)",
    series: [{ name: "Normal", points: [[0, 0], [27, 50], [100, 98]] }],
    markers: [{ x: 27, label: "P50" }],
  });

const twoSeriesCurve = () =>
  validated<CurveData>({
    kind: "curve",
    title: "Right shift",
    xLabel: "PO2",
    yLabel: "SaO2",
    series: [
      { name: "Normal", points: [[0, 0], [100, 98]] },
      { name: "Acidosis", points: [[0, 0], [100, 90]] },
    ],
  });

const compare = () =>
  validated<CompareData>({
    kind: "compare",
    title: "Nephrotic vs nephritic",
    columns: ["Nephrotic", "Nephritic"],
    rows: [
      { label: "Proteinuria", cells: [">3.5 g/day", "<3.5 g/day"] },
      { label: "Haematuria", cells: ["Rare", "Prominent"] },
    ],
  });

describe("CurveFigure", () => {
  it("draws one polyline per series", () => {
    const { container } = render(<CurveFigure figure={twoSeriesCurve()} />);
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
  });

  it("renders the marker annotation", () => {
    render(<CurveFigure figure={curve()} />);
    expect(screen.getByText("P50")).toBeInTheDocument();
  });

  it("labels both axes", () => {
    render(<CurveFigure figure={curve()} />);
    expect(screen.getByText("PO2 (mmHg)")).toBeInTheDocument();
    expect(screen.getByText("SaO2 (%)")).toBeInTheDocument();
  });

  it("shows a legend only when there is more than one series", () => {
    const single = render(<CurveFigure figure={curve()} />);
    expect(single.queryByText("Normal")).not.toBeInTheDocument();

    single.unmount();
    render(<CurveFigure figure={twoSeriesCurve()} />);
    expect(screen.getByText("Acidosis")).toBeInTheDocument();
  });

  it("themes through CSS custom properties, never hardcoded colours", () => {
    const { container } = render(<CurveFigure figure={curve()} />);
    const polyline = container.querySelector("polyline")!;
    // A presentation attribute would ignore the custom property and fall back
    // to black, so the colour has to arrive via the style property.
    expect(polyline.getAttribute("stroke")).toBeNull();
    expect(polyline.style.stroke).toContain("var(--accent)");
  });
});

describe("CurveFigure — degenerate geometry must not produce NaN", () => {
  const coordsOf = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("polyline, line, text"))
      .flatMap((el) => [
        el.getAttribute("points"),
        el.getAttribute("x1"),
        el.getAttribute("y1"),
        el.getAttribute("x"),
        el.getAttribute("y"),
      ])
      .filter(Boolean)
      .join(" ");

  it("handles a flat series where every y is identical", () => {
    const flat = validated<CurveData>({
      kind: "curve",
      title: "Flat",
      xLabel: "t",
      yLabel: "v",
      series: [{ name: "Steady", points: [[0, 5], [10, 5]] }],
    });
    const { container } = render(<CurveFigure figure={flat} />);
    expect(coordsOf(container)).not.toContain("NaN");
  });

  it("handles a series where every x is identical", () => {
    const vertical = validated<CurveData>({
      kind: "curve",
      title: "Vertical",
      xLabel: "t",
      yLabel: "v",
      series: [{ name: "Spike", points: [[3, 0], [3, 10]] }],
    });
    const { container } = render(<CurveFigure figure={vertical} />);
    expect(coordsOf(container)).not.toContain("NaN");
  });

  it("handles the two-point minimum", () => {
    const minimal = validated<CurveData>({
      kind: "curve",
      title: "Minimal",
      xLabel: "t",
      yLabel: "v",
      series: [{ name: "Line", points: [[0, 0], [1, 1]] }],
    });
    const { container } = render(<CurveFigure figure={minimal} />);
    expect(coordsOf(container)).not.toContain("NaN");
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
  });

  it("handles negative values", () => {
    const negative = validated<CurveData>({
      kind: "curve",
      title: "Action potential",
      xLabel: "ms",
      yLabel: "mV",
      series: [{ name: "Phase 0", points: [[0, -90], [1, 30], [2, -90]] }],
    });
    const { container } = render(<CurveFigure figure={negative} />);
    expect(coordsOf(container)).not.toContain("NaN");
    expect(screen.getByText("-90")).toBeInTheDocument();
  });
});

describe("CompareFigure", () => {
  it("renders a real table with scoped headers", () => {
    render(<CompareFigure figure={compare()} />);
    expect(screen.getByRole("table", { name: "Nephrotic vs nephritic" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Nephrotic" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Proteinuria" })).toBeInTheDocument();
  });

  it("renders every cell", () => {
    render(<CompareFigure figure={compare()} />);
    expect(screen.getByText(">3.5 g/day")).toBeInTheDocument();
    expect(screen.getByText("Prominent")).toBeInTheDocument();
  });

  it("names the corner cell so the header row does not read as blank", () => {
    render(<CompareFigure figure={compare()} />);
    expect(screen.getByRole("columnheader", { name: "Attribute" })).toBeInTheDocument();
  });
});

const flow = () =>
  validated<FlowData>({
    kind: "flow",
    title: "Suspected DKA",
    nodes: [
      { id: "a", label: "Suspected DKA" },
      { id: "b", label: "Ketones positive?", shape: "diamond" },
      { id: "c", label: "Start insulin" },
      { id: "d", label: "Seek alternative" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c", label: "yes" },
      { from: "b", to: "d", label: "no" },
    ],
  });

describe("FlowFigure", () => {
  it("draws one shape per node and one line per edge", () => {
    const { container } = render(<FlowFigure figure={flow()} />);
    expect(container.querySelectorAll("rect, polygon")).toHaveLength(4);
    expect(container.querySelectorAll("line")).toHaveLength(3);
  });

  it("draws a decision point as a diamond and plain steps as rects", () => {
    const { container } = render(<FlowFigure figure={flow()} />);
    expect(container.querySelectorAll("polygon")).toHaveLength(1);
    expect(container.querySelectorAll("rect")).toHaveLength(3);
  });

  it("renders branch labels", () => {
    render(<FlowFigure figure={flow()} />);
    expect(screen.getByText("yes")).toBeInTheDocument();
    expect(screen.getByText("no")).toBeInTheDocument();
  });

  it("points every edge at an arrow marker", () => {
    const { container } = render(<FlowFigure figure={flow()} />);
    const marker = container.querySelector("marker")!;
    const line = container.querySelector("line")!;
    expect(line.getAttribute("marker-end")).toBe(`url(#${marker.getAttribute("id")})`);
  });

  it("gives each instance its own marker id so two figures cannot collide", () => {
    const { container } = render(
      <>
        <FlowFigure figure={flow()} />
        <FlowFigure figure={flow()} />
      </>
    );
    const ids = [...container.querySelectorAll("marker")].map((m) => m.getAttribute("id"));
    expect(new Set(ids).size).toBe(2);
  });

  it("layers nodes by depth, with siblings sharing a row", () => {
    const { container } = render(<FlowFigure figure={flow()} />);

    // Node groups are the ones carrying a tspan; edge labels are bare <text>.
    const top = new Map(
      [...container.querySelectorAll("g")]
        .filter((g) => g.querySelector("tspan"))
        .map((g) => {
          const label = [...g.querySelectorAll("tspan")].map((t) => t.textContent).join(" ");
          const rect = g.querySelector("rect");
          const y = rect
            ? Number(rect.getAttribute("y"))
            : Math.min(
                ...g
                  .querySelector("polygon")!
                  .getAttribute("points")!
                  .split(" ")
                  .map((pair) => Number(pair.split(",")[1]))
              );
          return [label, y] as const;
        })
    );

    expect(top.get("Suspected DKA")!).toBeLessThan(top.get("Ketones positive?")!);
    expect(top.get("Ketones positive?")!).toBeLessThan(top.get("Start insulin")!);
    // Both branches of the decision sit on the same row.
    expect(top.get("Start insulin")).toBe(top.get("Seek alternative"));
  });
});

describe("FlowFigure — labels are cut, never overflowed", () => {
  const labelsOf = (container: HTMLElement) =>
    [...container.querySelectorAll("tspan")].map((t) => t.textContent ?? "");

  it("wraps a long multi-word label onto two lines", () => {
    const wide = validated<FlowData>({
      kind: "flow",
      title: "Wrap",
      nodes: [{ id: "a", label: "Administer intravenous fluids before insulin" }],
      edges: [],
    });
    const { container } = render(<FlowFigure figure={wide} />);
    const lines = labelsOf(container);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it("clamps a single word longer than the line budget", () => {
    const long = validated<FlowData>({
      kind: "flow",
      title: "Long word",
      nodes: [{ id: "a", label: "Pneumonoultramicroscopicsilicovolcanoconiosis" }],
      edges: [],
    });
    const { container } = render(<FlowFigure figure={long} />);
    const lines = labelsOf(container);
    expect(lines.every((l) => l.length <= 24)).toBe(true);
    expect(lines.join("")).toContain("…");
  });

  it("signals truncation when a label cannot fit in two lines", () => {
    const overflowing = validated<FlowData>({
      kind: "flow",
      title: "Overflow",
      nodes: [
        {
          id: "a",
          // Under the validator's 80-char cap, over the drawn box's budget.
          label: "Give isotonic saline then potassium then insulin and recheck gas",
        },
      ],
      edges: [],
    });
    const { container } = render(<FlowFigure figure={overflowing} />);
    expect(labelsOf(container).join("")).toContain("…");
  });

  it("leaves a short label untouched", () => {
    const { container } = render(<FlowFigure figure={flow()} />);
    expect(labelsOf(container)).toContain("Start insulin");
  });
});

describe("FlowFigure — layout is a deterministic single pass", () => {
  it("never measures text, which would force a re-layout cycle", () => {
    const source = readFileSync(join(process.cwd(), "src/components/figures/FlowFigure.tsx"), "utf8");
    // Matches a call, not a mention — the file's own comment explains why these
    // are avoided, and that explanation must not trip the check.
    expect(source).not.toMatch(/\.getBBox\s*\(/);
    expect(source).not.toMatch(/\.getComputedTextLength\s*\(/);
  });

  it("produces identical geometry on re-render", () => {
    // useId is expected to differ between mounts; the layout must not.
    const withoutIds = (html: string) => html.replace(/:r[0-9a-z]+:/g, "ID");

    const first = render(<FlowFigure figure={flow()} />);
    const markup = withoutIds(first.container.innerHTML);
    first.unmount();
    const second = render(<FlowFigure figure={flow()} />);
    expect(withoutIds(second.container.innerHTML)).toBe(markup);
  });

  it("handles the node cap without producing NaN coordinates", () => {
    const size = FIGURE_LIMITS.flowNodes;
    const wide = validated<FlowData>({
      kind: "flow",
      title: "Wide",
      nodes: Array.from({ length: size }, (_, i) => ({ id: `n${i}`, label: `Step ${i}` })),
      // A root fanning out to everything else — the widest single layer possible.
      edges: Array.from({ length: size - 1 }, (_, i) => ({ from: "n0", to: `n${i + 1}` })),
    });
    const { container } = render(<FlowFigure figure={wide} />);
    expect(container.innerHTML).not.toContain("NaN");
    expect(container.querySelectorAll("rect, polygon")).toHaveLength(size);
  });

  it("handles a single isolated node", () => {
    const lone = validated<FlowData>({
      kind: "flow",
      title: "Single",
      nodes: [{ id: "a", label: "Only step" }],
      edges: [],
    });
    const { container } = render(<FlowFigure figure={lone} />);
    expect(container.innerHTML).not.toContain("NaN");
  });
});

describe("accessibility", () => {
  it("exposes the curve as an image with the full text serialisation", () => {
    render(<CurveFigure figure={curve()} />);
    const svg = screen.getByRole("img");
    // The accessible description is the same text Share produces, so a
    // screen-reader user and a Share recipient cannot receive different content.
    expect(svg.textContent).toContain(figureToText(curve()));
  });

  it("gives the curve a non-empty accessible name", () => {
    const { container } = render(<CurveFigure figure={curve()} />);
    const title = container.querySelector("svg > title");
    expect(title?.textContent).toBe("Oxygen dissociation");
    expect(container.querySelector("svg")?.getAttribute("aria-labelledby")).toContain(
      title?.getAttribute("id")
    );
  });

  it("exposes the flow as an image with the full text serialisation", () => {
    render(<FlowFigure figure={flow()} />);
    expect(screen.getByRole("img").textContent).toContain(figureToText(flow()));
  });

  it("carries the permanent provenance caption on every kind", () => {
    for (const ui of [
      <CurveFigure key="c" figure={curve()} />,
      <CompareFigure key="t" figure={compare()} />,
      <FlowFigure key="f" figure={flow()} />,
    ]) {
      const view = render(ui);
      expect(screen.getByText(FIGURE_PROVENANCE)).toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("trust boundary", () => {
  it("never uses dangerouslySetInnerHTML anywhere in the figures directory", () => {
    // Figures render model output. The app's invariant is that model text is
    // split into React nodes and never parsed as HTML; this pins it.
    const dir = join(process.cwd(), "src/components/figures");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
      .filter((f) => readFileSync(join(dir, f), "utf8").includes("dangerouslySetInnerHTML"));
    expect(offenders).toEqual([]);
  });
});
