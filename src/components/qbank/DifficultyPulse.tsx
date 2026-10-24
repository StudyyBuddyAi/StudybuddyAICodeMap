import { FlaskConical } from "lucide-react";

const LEVELS: Record<string, { bars: number; level: "easy" | "medium" | "hard" }> = {
  Easy: { bars: 1, level: "easy" },
  Medium: { bars: 2, level: "medium" },
  Hard: { bars: 3, level: "hard" },
};

const HEIGHTS = [8, 16, 24];
const LIT = [8, 18, 28];

/**
 * The difficulty columns: a flask and three rising bars, lit one, two or three
 * high. They rise once when the explanation opens.
 */
const DifficultyPulse = ({ difficulty }: { difficulty: string }) => {
  const cfg = LEVELS[difficulty] ?? LEVELS.Medium;
  const label = LEVELS[difficulty] ? difficulty : "Medium";
  return (
    <span className="qb-pulse" data-level={cfg.level} role="img" aria-label={`Difficulty: ${label}`}>
      <FlaskConical className="qb-pulse-flask" aria-hidden />
      <span className="qb-pulse-bars" aria-hidden>
        {[0, 1, 2].map((i) => {
          const on = i < cfg.bars;
          return <span key={i} data-on={on || undefined} style={{ height: on ? LIT[i] : HEIGHTS[i] }} />;
        })}
      </span>
      <span className="qb-pulse-label" aria-hidden>
        {label}
      </span>
    </span>
  );
};

export default DifficultyPulse;
