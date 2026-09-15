import type { Figure } from "@/types/figure";
import FlowFigure from "./FlowFigure";
import CurveFigure from "./CurveFigure";
import CompareFigure from "./CompareFigure";

/** Renders a sheet's figures in order, one frame each. */
const FiguresSection = ({ figures }: { figures: Figure[] }) => {
  if (!figures.length) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {figures.map((figure, i) => {
        // Titles repeat across sheets often enough that the index is the only
        // stable key here; figures are never reordered within a sheet.
        const key = `${figure.kind}-${i}`;
        if (figure.kind === "flow") return <FlowFigure key={key} figure={figure} />;
        if (figure.kind === "curve") return <CurveFigure key={key} figure={figure} />;
        return <CompareFigure key={key} figure={figure} />;
      })}
    </div>
  );
};

export default FiguresSection;
