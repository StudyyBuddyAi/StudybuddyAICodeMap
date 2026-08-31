import { ReactNode, useEffect, useState } from "react";
import { Flame, FileText, Layers, Brain } from "lucide-react";
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
  suffix?: ReactNode;
}

/**
 * One figure. Deliberately quiet.
 *
 * These used to be 48px icon tiles over 28px numerals in bordered cards — three
 * of them, directly above the tool grid, so the loudest thing on the dashboard
 * was a set of numbers nobody acts on. Progress is context, not a call to
 * action: it now reads as a single line of supporting text under the panel that
 * does have one.
 */
const StatChip = ({ icon, value, label, suffix }: StatChipProps) => {
  const animated = useCountUp(value);

  return (
    <div className="flex items-center gap-2.5">
      <span className="text-muted-foreground/70" aria-hidden="true">
        {icon}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-[19px] font-semibold leading-none text-foreground">
          {value === null ? "—" : animated}
        </span>
        {suffix && <span className="ds-meta">{suffix}</span>}
        <span className="ds-meta">{label}</span>
      </span>
    </div>
  );
};

const StatsStrip = () => {
  const { streak, retentionRate, isAnonymous } = useStudyStats();
  const { sheetsThisWeek } = useSheetsStats();
  const { stats } = useFlashcardDeck();

  const streakValue = isAnonymous || streak === null ? null : streak;
  const streakLabel = !isAnonymous && streak === 1 ? "day streak" : "days streak";

  const sheetsValue = isAnonymous || sheetsThisWeek === null ? null : sheetsThisWeek;

  const dueValue = isAnonymous ? null : stats.due;

  return (
    <section
      aria-label="Your progress"
      className="flex flex-wrap items-center gap-x-7 gap-y-3 border-y border-border py-3.5"
    >
      <StatChip
        icon={<FileText className="h-4 w-4" />}
        value={sheetsValue}
        label={sheetsValue === 1 ? "sheet this week" : "sheets this week"}
      />
      <StatChip
        icon={<Layers className="h-4 w-4" />}
        value={dueValue}
        label={dueValue === 1 ? "card due" : "cards due"}
      />
      <StatChip
        icon={<Flame className="h-4 w-4" />}
        value={streakValue}
        label={streakLabel}
      />
      {/* `useStudyStats` has computed retention on every load since it was
          written, and no screen has ever shown it. It is the single most useful
          number a spaced-repetition user has: the share of due cards they got
          right. */}
      <StatChip
        icon={<Brain className="h-4 w-4" />}
        value={isAnonymous ? null : retentionRate}
        label="retention"
        suffix="%"
      />

      {isAnonymous && (
        <p className="ds-meta ms-auto">Sign in to track progress</p>
      )}
    </section>
  );
};

export default StatsStrip;
