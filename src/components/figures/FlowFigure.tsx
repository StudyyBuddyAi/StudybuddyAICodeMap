import { useId } from "react";
import type { CSSProperties } from "react";
import type { FigureEdge, FigureNode, FlowFigure as FlowFigureData } from "@/types/figure";
import { figureToText } from "@/lib/figures";
import FigureFrame from "./FigureFrame";

/**
 * A flowchart, laid out top-down in layers.
 *
 * Two deliberate constraints make this a single deterministic pass:
 *
 * 1. Text is never measured. SVG text width is unknowable before paint, and
 *    `getBBox` would force a mount → measure → re-layout cycle with a visible
 *    flash of the wrong layout. Nodes are a fixed width and labels are wrapped
 *    to a character budget instead.
 * 2. The graph is assumed to be a DAG with at least one root. `parseFigures`
 *    rejects cycles and rootless graphs, so the longest-path walk below always
 *    terminates — that check belongs to the validator, not to this component.
 */

const NODE_W = 156;
const NODE_H = 58;
const H_GAP = 20;
const V_GAP = 46;
const PAD = 12;

/** Roughly what fits on one line of NODE_W at the label font size. */
const CHARS_PER_LINE = 24;
const MAX_LINES = 2;

const SVG_STYLE: CSSProperties = { width: "100%", height: "auto", display: "block" };

const NODE_TEXT_STYLE: CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 11,
  fontWeight: 500,
  fill: "var(--fg)",
};

const EDGE_TEXT_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  fill: "var(--fg-muted)",
};

/**
 * Greedy word wrap into at most `MAX_LINES`, ellipsing the overflow.
 *
 * The validator already caps labels at 80 characters; this is the tighter
 * budget that fits the drawn box.
 */
const clamp = (line: string): string =>
  line.length > CHARS_PER_LINE ? `${line.slice(0, CHARS_PER_LINE - 1)}…` : line;

function wrapLabel(label: string): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= CHARS_PER_LINE) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === MAX_LINES) break;
  }
  if (current && lines.length < MAX_LINES) lines.push(current);

  // A single word longer than the budget still has to be cut, or it runs
  // outside the node box with nothing to signal that it did.
  const fitted = lines.slice(0, MAX_LINES).map(clamp);

  // Words that did not fit at all are signalled rather than silently dropped.
  if (lines.join(" ") !== label && fitted.length) {
    const last = fitted.length - 1;
    if (!fitted[last].endsWith("…")) fitted[last] = clamp(`${fitted[last]}…`);
  }
  return fitted;
}

interface Placed {
  node: FigureNode;
  x: number;
  y: number;
}

/** Longest path from the roots — the layer each node is drawn on. */
function depthsOf(nodes: FigureNode[], edges: FigureEdge[]): Map<string, number> {
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of nodes) {
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  }
  for (const edge of edges) {
    outgoing.get(edge.from)!.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const depth = new Map(nodes.map((n) => [n.id, 0]));

  while (queue.length) {
    const id = queue.shift()!;
    for (const next of outgoing.get(id) ?? []) {
      depth.set(next, Math.max(depth.get(next)!, depth.get(id)! + 1));
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  return depth;
}

/**
 * Place nodes in layers, ordering each layer by the average position of its
 * parents. One barycentre pass is cheap and removes most edge crossings at the
 * sizes this renderer allows.
 */
function layout(nodes: FigureNode[], edges: FigureEdge[]) {
  const depth = depthsOf(nodes, edges);
  const layers: FigureNode[][] = [];
  for (const node of nodes) {
    const d = depth.get(node.id)!;
    (layers[d] ??= []).push(node);
  }

  const indexInLayer = new Map<string, number>();
  layers[0]?.forEach((n, i) => indexInLayer.set(n.id, i));

  for (let d = 1; d < layers.length; d++) {
    const parentsOf = (id: string) =>
      edges.filter((e) => e.to === id).map((e) => indexInLayer.get(e.from) ?? 0);

    layers[d].sort((a, b) => {
      const pa = parentsOf(a.id);
      const pb = parentsOf(b.id);
      const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
      return mean(pa) - mean(pb);
    });
    layers[d].forEach((n, i) => indexInLayer.set(n.id, i));
  }

  const widest = Math.max(...layers.map((l) => l.length));
  const contentW = widest * NODE_W + (widest - 1) * H_GAP;
  const contentH = layers.length * NODE_H + (layers.length - 1) * V_GAP;

  const placed = new Map<string, Placed>();
  layers.forEach((layer, d) => {
    const rowW = layer.length * NODE_W + (layer.length - 1) * H_GAP;
    const startX = PAD + (contentW - rowW) / 2;
    layer.forEach((node, i) => {
      placed.set(node.id, {
        node,
        x: startX + i * (NODE_W + H_GAP),
        y: PAD + d * (NODE_H + V_GAP),
      });
    });
  });

  return { placed, width: contentW + PAD * 2, height: contentH + PAD * 2 };
}

const NodeShape = ({ at }: { at: Placed }) => {
  const { x, y, node } = at;
  const common: CSSProperties = {
    fill: "var(--bg)",
    stroke: node.shape === "diamond" ? "var(--accent)" : "var(--border-strong, var(--border))",
    strokeWidth: node.shape === "diamond" ? 1.75 : 1.25,
  };

  if (node.shape === "diamond") {
    const cx = x + NODE_W / 2;
    const cy = y + NODE_H / 2;
    return (
      <polygon
        points={`${cx},${y} ${x + NODE_W},${cy} ${cx},${y + NODE_H} ${x},${cy}`}
        style={common}
      />
    );
  }

  return (
    <rect
      x={x}
      y={y}
      width={NODE_W}
      height={NODE_H}
      rx={node.shape === "round" ? NODE_H / 2 : 8}
      style={common}
    />
  );
};

const FlowFigure = ({ figure }: { figure: FlowFigureData }) => {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;
  const arrowId = `${baseId}-arrow`;

  const { placed, width, height } = layout(figure.nodes, figure.edges);

  return (
    <FigureFrame title={figure.title}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={SVG_STYLE}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>{figure.title}</title>
        <desc id={descId}>{figureToText(figure)}</desc>

        <defs>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: "var(--fg-muted)" }} />
          </marker>
        </defs>

        {figure.edges.map((edge) => {
          const from = placed.get(edge.from)!;
          const to = placed.get(edge.to)!;
          const x1 = from.x + NODE_W / 2;
          const y1 = from.y + NODE_H;
          const x2 = to.x + NODE_W / 2;
          const y2 = to.y;
          return (
            <g key={`${edge.from}-${edge.to}-${edge.label ?? ""}`}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                markerEnd={`url(#${arrowId})`}
                style={{ stroke: "var(--fg-muted)", strokeWidth: 1.25 }}
              />
              {edge.label && (
                <text
                  x={(x1 + x2) / 2 + 6}
                  y={(y1 + y2) / 2}
                  dominantBaseline="middle"
                  style={EDGE_TEXT_STYLE}
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {[...placed.values()].map((at) => {
          const lines = wrapLabel(at.node.label);
          // Centre the block of lines on the node, whether it is one or two.
          const firstY = at.y + NODE_H / 2 - (lines.length - 1) * 7 + 4;
          return (
            <g key={at.node.id}>
              <NodeShape at={at} />
              <text x={at.x + NODE_W / 2} textAnchor="middle" style={NODE_TEXT_STYLE}>
                {lines.map((line, i) => (
                  <tspan key={line} x={at.x + NODE_W / 2} y={firstY + i * 14}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
    </FigureFrame>
  );
};

export default FlowFigure;
