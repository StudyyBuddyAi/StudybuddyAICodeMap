import { ReactNode, useEffect, useState } from "react";
import { Flame, FileText, Layers } from "lucide-react";
import { useStudyStats } from "@/hooks/use-study-stats";
import { useSheetsStats } from "@/hooks/use-sheets-stats";
import { useFlashcardDeck } from "@/hooks/use-flashcard-deck";

/** Count from 0 to target over `duration` ms with an ease-out curve. */
function useCountUp(target: number | null, duration = 600): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (target === null || Number.isNaN(target)) {
      setValue(0);
      return;
    }
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setValue(target);
      return;
    }
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(eased * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

interface StatChipProps {
  icon: ReactNode;
  value: number | null;
  label: string;
  accent?: boolean;
  suffix?: ReactNode;
  /** Tailwind bg + text classes for the icon tile; must carry both themes. */
  iconClassName: string;
}

const StatChip = ({
  icon,
  value,
  label,
  accent,
  suffix,
  iconClassName,
}: StatChipProps) => {
  const animated = useCountUp(value);

  return (
    <div className="items-center flex flex-col bg-card border border-border rounded-lg p-4">
      <div
        className={`stats-strip-icon ${iconClassName}`}
      >
        {icon}
      </div>

      <div className="stats-strip-value-row">
        <span
          className="stats-strip-value"
          style={{
            color: accent ? "var(--accent)" : "var(--fg)",
          }}
        >
          {value === null ? "—" : animated}
        </span>
        {suffix && <span className="stats-strip-suffix">{suffix}</span>}
      </div>

      <span className="stats-strip-label">{label}</span>
    </div>
  );
};

const StatsStrip = () => {
  const { streak, isAnonymous } = useStudyStats();
  const { sheetsThisWeek } = useSheetsStats();
  const { stats } = useFlashcardDeck();

  const streakValue = isAnonymous || streak === null ? null : streak;
  const streakLabel = !isAnonymous && streak === 1 ? "day streak" : "days streak";

  const sheetsValue = isAnonymous || sheetsThisWeek === null ? null : sheetsThisWeek;
  const sheetsLabel = "Sheets this week";

  const dueValue = isAnonymous ? null : stats.due;
  const dueLabel = "Cards due today";

  return (
    <div className="animate-fade-in stats-strip-section">
      
      {/* Plain heading — this used to carry a chevron that read as expandable
          but had nothing behind it. */}
      <div className="stats-strip-header">
        <span>Your progress</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatChip
          icon={<FileText className="h-7 w-7" />}
          value={sheetsValue}
          label={sheetsLabel}
          iconClassName="bg-primary/15 text-primary"
        />
        <StatChip
          icon={<Layers className="h-7 w-7" />}
          value={dueValue}
          label={dueLabel}
          iconClassName="bg-success-soft text-success"
        />
        <StatChip
          icon={<Flame className="h-7 w-7" />}
          value={streakValue}
          label={streakLabel}
          accent
          iconClassName="bg-danger-soft text-danger"
          suffix={
            streakValue !== null && streakValue > 0 ? (
              <span aria-hidden="true">days</span>
            ) : undefined
          }
        />
      </div>

      {isAnonymous && (
        <p className="stats-strip-anonymous-note">
          Sign in to track your progress
        </p>
      )}
    </div>
  );
};

export default StatsStrip;
