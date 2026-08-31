import { useId, useState } from "react";
import type { SessionPoint } from "@/hooks/use-qbank-insights";

/**
 * Accuracy across recent QBank blocks.
 *
 * One series, so there is no legend — the tile's label says what is plotted.
 * Only the endpoint is labelled; a number on every point is unreadable and goes
 * unread. The axis is a single recessive baseline at 0 rather than a grid,
 * because the question this answers is "which way am I going", not "what was
 * block four exactly" — and the tooltip carries the exact figures.
 *
 * Marks follow the house specs: 2px line with round caps, r=4 endpoint dot with
 * a 2px surface ring so it stays legible where it sits on the line.
 */

const W = 168;
const H = 44;
const PAD_X = 3;
const PAD_Y = 6;

interface Props {
  points: SessionPoint[];
  /** Rendered as the tile's value; kept out of the plot. */
  overall: number | null;
}

const AccuracyTrend = ({ points, overall }: Props) => {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <p className="ds-meta mt-2">
        {points.length === 0
          ? "No finished blocks yet."
          : "One block so far — a trend needs two."}
      </p>
    );
  }

  // Fixed 0–100 domain. Auto-scaling an accuracy chart to its own min/max makes
  // a 71→74 wobble look like a breakthrough.
  const x = (i: number) =>
    PAD_X + (i / (points.length - 1)) * (W - PAD_X * 2);
  const y = (v: number) => PAD_Y + (1 - v / 100) * (H - PAD_Y * 2);

  const line = points.map((p, i) => `${x(i)},${y(p.accuracy)}`).join(" ");
  const area = `${PAD_X},${H - PAD_Y} ${line} ${W - PAD_X},${H - PAD_Y}`;

  const last = points[points.length - 1];
  const active = hover === null ? null : points[hover];

  return (
    <div className="relative mt-2">
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Accuracy across the last ${points.length} question blocks, ending at ${last.accuracy} percent.`}
        style={{ display: "block", height: H, overflow: "visible" }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.16" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Baseline only — a full grid would out-weigh ten data points. */}
        <line
          x1={PAD_X}
          y1={H - PAD_Y}
          x2={W - PAD_X}
          y2={H - PAD_Y}
          stroke="hsl(var(--sb-border))"
          strokeWidth="1"
        />

        <polygon points={area} fill={`url(#${gradientId})`} />

        <polyline
          points={line}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Endpoint. The surface ring keeps it readable on top of the line. */}
        <circle
          cx={x(points.length - 1)}
          cy={y(last.accuracy)}
          r="4"
          fill="hsl(var(--primary))"
          stroke="hsl(var(--card))"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />

        {active && (
          <circle
            cx={x(hover!)}
            cy={y(active.accuracy)}
            r="4"
            fill="hsl(var(--primary))"
            stroke="hsl(var(--card))"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/*
          A nearest-point layer rather than one hit rect per dot.

          Per-point rects would be (168 / n) viewBox units wide — on a narrow
          card that scales down to roughly 15 rendered px, below the ~24px
          minimum, and it leaves dead gaps between them. One overlay that maps
          the pointer to the closest index means the whole plot is live and the
          target size cannot fall below the mark spec.
        */}
        <rect
          x={0}
          y={0}
          width={W}
          height={H}
          fill="transparent"
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            if (!box.width) return;
            const ratio = (e.clientX - box.left) / box.width;
            const i = Math.round(ratio * (points.length - 1));
            setHover(Math.min(points.length - 1, Math.max(0, i)));
          }}
          onMouseLeave={() => setHover(null)}
        />
      </svg>

      {active && (
        <div
          role="status"
          className="pointer-events-none absolute -top-1 start-0 z-10 rounded-[var(--r-sm)] border border-border bg-popover px-2 py-1 shadow-[var(--shadow-float)]"
          style={{
            insetInlineStart: `${(hover! / (points.length - 1)) * 100}%`,
            transform: "translate(-50%, -100%)",
          }}
        >
          <span className="block text-[13px] font-semibold text-foreground">
            {active.accuracy}%
          </span>
          <span className="ds-meta block whitespace-nowrap">
            {active.system} · {active.total} q
          </span>
        </div>
      )}

      {/* Nothing is gated behind hover. */}
      <table className="sr-only">
        <caption>Accuracy by question block, oldest first</caption>
        <thead>
          <tr>
            <th scope="col">Block</th>
            <th scope="col">System</th>
            <th scope="col">Questions</th>
            <th scope="col">Accuracy</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.id}>
              <th scope="row">{i + 1}</th>
              <td>{p.system}</td>
              <td>{p.total}</td>
              <td>{p.accuracy}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      {overall !== null && (
        <p className="sr-only">Overall accuracy {overall} percent.</p>
      )}
    </div>
  );
};

export default AccuracyTrend;
