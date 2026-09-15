import { useId } from "react";
import type { CSSProperties } from "react";
import type { CurveFigure as CurveFigureData } from "@/types/figure";
import { figureToText } from "@/lib/figures";
import FigureFrame from "./FigureFrame";

/**
 * A curve, drawn as plain SVG from validated points.
 *
 * Colours are set through the `style` prop rather than SVG presentation
 * attributes: `stroke="var(--accent)"` as an attribute is not a valid colour
 * and silently falls back to black, whereas the CSS property resolves the
 * custom property and so follows the light/dark toggle with no JS.
 */

const VIEW_W = 640;
const VIEW_H = 360;
const PAD = { top: 20, right: 24, bottom: 52, left: 68 };
const PLOT_W = VIEW_W - PAD.left - PAD.right;
const PLOT_H = VIEW_H - PAD.top - PAD.bottom;

/** Two is the validated maximum, so two colours is the whole palette. */
const SERIES_COLORS = ["var(--accent)", "hsl(var(--section-flashcards))"];

const SVG_STYLE: CSSProperties = { width: "100%", height: "auto", display: "block" };
const AXIS_TEXT_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fill: "var(--fg-muted)",
};
const AXIS_LABEL_STYLE: CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  fontWeight: 500,
  fill: "var(--fg)",
};

function formatTick(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(Math.abs(n) < 1 ? 2 : 1);
}

const CurveFigure = ({ figure }: { figure: CurveFigureData }) => {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;

  // Marker x values join the domain so an annotation can never fall outside
  // the drawn axis.
  const xs = [
    ...figure.series.flatMap((s) => s.points.map(([x]) => x)),
    ...(figure.markers?.map((m) => m.x) ?? []),
  ];
  const ys = figure.series.flatMap((s) => s.points.map(([, y]) => y));

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  // A flat series (every y identical) has zero span; centring it keeps the line
  // on the plot instead of dividing by zero.
  const sx = (v: number) =>
    PAD.left + (spanX === 0 ? PLOT_W / 2 : ((v - minX) / spanX) * PLOT_W);
  const sy = (v: number) =>
    PAD.top + PLOT_H - (spanY === 0 ? PLOT_H / 2 : ((v - minY) / spanY) * PLOT_H);

  const axisBottom = PAD.top + PLOT_H;

  return (
    <FigureFrame title={figure.title}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        style={SVG_STYLE}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>{figure.title}</title>
        <desc id={descId}>{figureToText(figure)}</desc>

        {/* Axes */}
        <line
          x1={PAD.left}
          y1={axisBottom}
          x2={PAD.left + PLOT_W}
          y2={axisBottom}
          style={{ stroke: "var(--border-strong, var(--border))", strokeWidth: 1 }}
        />
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={axisBottom}
          style={{ stroke: "var(--border-strong, var(--border))", strokeWidth: 1 }}
        />

        {/* Extent ticks only — enough to read the scale without a tick algorithm. */}
        <text x={PAD.left} y={axisBottom + 18} textAnchor="middle" style={AXIS_TEXT_STYLE}>
          {formatTick(minX)}
        </text>
        <text
          x={PAD.left + PLOT_W}
          y={axisBottom + 18}
          textAnchor="middle"
          style={AXIS_TEXT_STYLE}
        >
          {formatTick(maxX)}
        </text>
        <text x={PAD.left - 8} y={axisBottom + 4} textAnchor="end" style={AXIS_TEXT_STYLE}>
          {formatTick(minY)}
        </text>
        <text x={PAD.left - 8} y={PAD.top + 4} textAnchor="end" style={AXIS_TEXT_STYLE}>
          {formatTick(maxY)}
        </text>

        {/* Axis names */}
        <text
          x={PAD.left + PLOT_W / 2}
          y={VIEW_H - 12}
          textAnchor="middle"
          style={AXIS_LABEL_STYLE}
        >
          {figure.xLabel}
        </text>
        <text
          transform={`translate(18 ${PAD.top + PLOT_H / 2}) rotate(-90)`}
          textAnchor="middle"
          style={AXIS_LABEL_STYLE}
        >
          {figure.yLabel}
        </text>

        {figure.markers?.map((marker) => (
          <g key={`${marker.x}-${marker.label}`}>
            <line
              x1={sx(marker.x)}
              y1={PAD.top}
              x2={sx(marker.x)}
              y2={axisBottom}
              style={{
                stroke: "var(--fg-muted)",
                strokeWidth: 1,
                strokeDasharray: "4 4",
                opacity: 0.6,
              }}
            />
            <text
              x={sx(marker.x)}
              y={PAD.top - 6}
              textAnchor="middle"
              style={AXIS_TEXT_STYLE}
            >
              {marker.label}
            </text>
          </g>
        ))}

        {figure.series.map((series, i) => (
          <polyline
            key={series.name}
            points={series.points.map(([x, y]) => `${sx(x)},${sy(y)}`).join(" ")}
            style={{
              fill: "none",
              stroke: SERIES_COLORS[i % SERIES_COLORS.length],
              strokeWidth: 2.5,
              strokeLinejoin: "round",
              strokeLinecap: "round",
            }}
          />
        ))}

        {/* Legend only earns its space when the curves need telling apart. */}
        {figure.series.length > 1 &&
          figure.series.map((series, i) => (
            <g key={`legend-${series.name}`} transform={`translate(${PAD.left + 8} ${PAD.top + 8 + i * 18})`}>
              <line
                x1={0}
                y1={0}
                x2={18}
                y2={0}
                style={{
                  stroke: SERIES_COLORS[i % SERIES_COLORS.length],
                  strokeWidth: 2.5,
                  strokeLinecap: "round",
                }}
              />
              <text x={24} y={4} style={AXIS_TEXT_STYLE}>
                {series.name}
              </text>
            </g>
          ))}
      </svg>
    </FigureFrame>
  );
};

export default CurveFigure;
