import {
  DAILY_CREDIT_BUDGET_MICROS,
  TYPICAL_COST_MICROS,
  creditsResetAt,
} from "../../supabase/functions/_shared/credits.ts";

/**
 * What the usage bar shows, from the student's `credits` rows in
 * usage_records. Pure, so the rules are tested apart from the page.
 */

export type UsageLevel = "calm" | "low" | "out";

export interface CreditDay {
  /** The UTC day, as usage_date stores it. */
  date: string;
  percent: number;
  isToday: boolean;
}

export interface DailyCredits {
  used: number;
  remaining: number;
  percent: number;
  level: UsageLevel;
  /** The last seven days, oldest first, today last. */
  days: CreditDay[];
}

/** From here the bar warns that the day is nearly spent. */
const LOW_AT_PERCENT = 80;

export const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

const daysBack = (now: Date, n: number): string =>
  utcDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n)));

/** The first day of the seven the history shows. */
export const historyStart = (now: Date): string => daysBack(now, 6);

/**
 * Whole percent used, never rounded across a line that means something: any
 * use shows at least 1%, and 100% is only ever shown when the day is spent.
 */
export function usagePercent(used: number, budget: number = DAILY_CREDIT_BUDGET_MICROS): number {
  if (used <= 0) return 0;
  if (used >= budget) return 100;
  return Math.min(99, Math.max(1, Math.round((used / budget) * 100)));
}

export function summarizeCredits(rows: { usage_date: string; count: number }[], now: Date): DailyCredits {
  const byDay = new Map(rows.map((r) => [r.usage_date, r.count]));
  const today = utcDay(now);
  const used = byDay.get(today) ?? 0;
  const percent = usagePercent(used);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = daysBack(now, 6 - i);
    return { date, percent: usagePercent(byDay.get(date) ?? 0), isToday: date === today };
  });
  return {
    used,
    remaining: Math.max(0, DAILY_CREDIT_BUDGET_MICROS - used),
    percent,
    level: percent >= 100 ? "out" : percent >= LOW_AT_PERCENT ? "low" : "calm",
    days,
  };
}

/** "5h 12m", until the next midnight UTC. */
export function timeUntilReset(now: Date): string {
  const minutes = Math.ceil((new Date(creditsResetAt(now)).getTime() - now.getTime()) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const m = minutes % 60;
  return m ? `${Math.floor(minutes / 60)}h ${m}m` : `${minutes / 60}h`;
}

/** What is left, as things a student would make with it — each one on its own. */
export function whatsLeftCovers(remaining: number): { label: string; count: number }[] {
  return [
    { label: "Comprehensive sheets with deep dives", cost: TYPICAL_COST_MICROS.comprehensiveSheet },
    { label: "High-yield sheets", cost: TYPICAL_COST_MICROS.highYieldSheet },
    { label: "QBank questions", cost: TYPICAL_COST_MICROS.qbankQuestion },
    { label: "50-card flashcard decks", cost: TYPICAL_COST_MICROS.deck50 },
  ].map(({ label, cost }) => ({ label, count: Math.floor(remaining / cost) }));
}
