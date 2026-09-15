import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { VisualChartSpec } from "@/types/generated-sheet";

/** Fixed categorical order (index.css `--viz-*`), assigned by series position — never cycled. */
const SERIES_COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)"];

const AXIS_TICK = { fill: "var(--fg-muted)", fontSize: 11, fontFamily: "var(--font-sans)" };

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  color: "var(--fg)",
};

const formatValue = (n: number) =>
  Math.abs(n) >= 1000 ? n.toLocaleString() : String(Math.round(n * 100) / 100);

function DataTable({ spec }: { spec: VisualChartSpec }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="border-b border-border py-1 pr-3 font-medium" />
            {spec.series.map((s) => (
              <th key={s.name} className="border-b border-border py-1 pr-3 font-medium">
                {s.name}
                {spec.yLabel ? ` (${spec.yLabel})` : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.xLabels.map((x, i) => (
            <tr key={x + i}>
              <td className="border-b border-border py-1 pr-3 text-foreground">{x}</td>
              {spec.series.map((s) => (
                <td key={s.name} className="border-b border-border py-1 pr-3 tabular-nums text-foreground">
                  {formatValue(s.values[i])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ChartVisual = ({ spec, title }: { spec: VisualChartSpec; title: string }) => {
  const data = spec.xLabels.map((x, i) => {
    const row: Record<string, string | number> = { x };
    spec.series.forEach((s, si) => {
      row[`s${si}`] = s.values[i];
    });
    return row;
  });
  const multi = spec.series.length > 1;
  // Direct value labels only where they can't collide: one series, few bars.
  const directLabels = !multi && spec.chartType === "bar" && spec.xLabels.length <= 8;

  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--border)" />
      <XAxis
        dataKey="x"
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={{ stroke: "var(--border-strong)" }}
        interval={0}
        height={spec.xLabels.some((l) => l.length > 10) ? 48 : 28}
        // Inset the first and last points so their tick labels aren't cut at the edge.
        padding={spec.chartType === "line" ? { left: 24, right: 24 } : undefined}
      />
      <YAxis
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={false}
        width={44}
        // Bars must start at zero or their lengths lie; a line reads change, so it fits the data.
        domain={spec.chartType === "line" ? ["auto", "auto"] : [0, "auto"]}
        tickFormatter={formatValue}
        label={
          spec.yLabel
            ? {
                value: spec.yLabel,
                angle: -90,
                position: "insideLeft",
                style: { ...AXIS_TICK, textAnchor: "middle" },
              }
            : undefined
        }
      />
      <Tooltip
        contentStyle={TOOLTIP_STYLE}
        labelStyle={{ color: "var(--fg)", fontWeight: 600 }}
        itemStyle={{ color: "var(--fg)" }}
        cursor={spec.chartType === "bar" ? { fill: "var(--border)", opacity: 0.4 } : { stroke: "var(--border-strong)" }}
        formatter={(value: number) => formatValue(value)}
      />
      {multi && (
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-sans)" }}
          // Identity is carried by the swatch; the text stays in ink.
          formatter={(value: string) => <span style={{ color: "var(--fg-muted)" }}>{value}</span>}
        />
      )}
    </>
  );

  return (
    <>
      <div role="img" aria-label={title || "Chart"} style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          {spec.chartType === "line" ? (
            <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
              {axes}
              {spec.series.map((s, si) => (
                <Line
                  key={s.name}
                  type="monotone"
                  dataKey={`s${si}`}
                  name={s.name}
                  stroke={SERIES_COLORS[si]}
                  strokeWidth={2}
                  dot={{ r: 4, strokeWidth: 2, stroke: "var(--bg-elevated)", fill: SERIES_COLORS[si] }}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--bg-elevated)" }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 18, right: 12, bottom: 0, left: 0 }} barGap={2}>
              {axes}
              {spec.series.map((s, si) => (
                <Bar
                  key={s.name}
                  dataKey={`s${si}`}
                  name={s.name}
                  fill={SERIES_COLORS[si]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={36}
                  isAnimationActive={false}
                >
                  {directLabels && (
                    <LabelList
                      dataKey={`s${si}`}
                      position="top"
                      formatter={formatValue}
                      style={{ fill: "var(--fg-muted)", fontSize: 11, fontFamily: "var(--font-sans)" }}
                    />
                  )}
                </Bar>
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-[12px] text-muted-foreground">
        <summary className="cursor-pointer select-none">Data table</summary>
        <div className="mt-2">
          <DataTable spec={spec} />
        </div>
      </details>
    </>
  );
};

export default ChartVisual;
