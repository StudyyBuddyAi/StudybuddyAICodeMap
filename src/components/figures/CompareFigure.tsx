import type { CSSProperties } from "react";
import type { CompareFigure as CompareFigureData } from "@/types/figure";
import FigureFrame from "./FigureFrame";

/**
 * A comparison table. No SVG — a real `<table>` is already the accessible,
 * printable, selectable representation of this data.
 */

const SCROLL_STYLE: CSSProperties = { overflowX: "auto" };

const TABLE_STYLE: CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  color: "var(--fg)",
};

const CELL_BASE: CSSProperties = {
  border: "1px solid var(--border)",
  padding: "8px 12px",
  textAlign: "start",
  verticalAlign: "top",
  lineHeight: 1.5,
};

const COLUMN_HEAD_STYLE: CSSProperties = {
  ...CELL_BASE,
  fontWeight: 600,
  color: "var(--fg)",
  background: "var(--bg)",
};

const ROW_HEAD_STYLE: CSSProperties = {
  ...CELL_BASE,
  fontWeight: 500,
  color: "var(--fg-muted)",
  background: "var(--bg)",
  whiteSpace: "nowrap",
};

const CompareFigure = ({ figure }: { figure: CompareFigureData }) => (
  <FigureFrame title={figure.title}>
    <div style={SCROLL_STYLE}>
      <table style={TABLE_STYLE} aria-label={figure.title}>
        <thead>
          <tr>
            {/* The corner cell heads the attribute column, which has no name of
                its own; naming it keeps the header row from reading as blank. */}
            <th scope="col" style={COLUMN_HEAD_STYLE}>
              <span className="sr-only">Attribute</span>
            </th>
            {figure.columns.map((column) => (
              <th key={column} scope="col" style={COLUMN_HEAD_STYLE}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {figure.rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" style={ROW_HEAD_STYLE}>
                {row.label}
              </th>
              {row.cells.map((cell, i) => (
                <td key={figure.columns[i]} style={CELL_BASE}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </FigureFrame>
);

export default CompareFigure;
