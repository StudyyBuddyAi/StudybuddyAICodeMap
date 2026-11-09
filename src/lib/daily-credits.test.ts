import { describe, it, expect } from "vitest";
import {
  historyStart,
  summarizeCredits,
  timeUntilReset,
  usagePercent,
  whatsLeftCovers,
} from "./daily-credits";
import { DAILY_CREDIT_BUDGET_MICROS as BUDGET } from "../../supabase/functions/_shared/credits.ts";

const NOW = new Date("2026-11-09T18:48:00Z");

describe("usagePercent", () => {
  it("shows nothing only when nothing was used", () => {
    expect(usagePercent(0)).toBe(0);
    expect(usagePercent(1)).toBe(1);
  });

  it("only says 100 when the day is spent", () => {
    expect(usagePercent(BUDGET - 1)).toBe(99);
    expect(usagePercent(BUDGET)).toBe(100);
    expect(usagePercent(BUDGET * 2)).toBe(100);
  });
});

describe("summarizeCredits", () => {
  it("reads today's row and what is left", () => {
    const s = summarizeCredits([{ usage_date: "2026-11-09", count: 650_000 }], NOW);
    expect(s).toMatchObject({ used: 650_000, remaining: BUDGET - 650_000, percent: 20, level: "calm" });
  });

  it("is an untouched day when there is no row", () => {
    expect(summarizeCredits([], NOW)).toMatchObject({ used: 0, remaining: BUDGET, percent: 0, level: "calm" });
  });

  it("warns from 80%, and is out at 100%", () => {
    const at = (count: number) => summarizeCredits([{ usage_date: "2026-11-09", count }], NOW).level;
    expect(at(BUDGET * 0.79)).toBe("calm");
    expect(at(BUDGET * 0.8)).toBe("low");
    expect(at(BUDGET)).toBe("out");
  });

  it("never reports a negative remainder when a day runs over", () => {
    expect(summarizeCredits([{ usage_date: "2026-11-09", count: BUDGET + 500 }], NOW).remaining).toBe(0);
  });

  it("lays out seven days, oldest first, with the gaps filled", () => {
    const { days } = summarizeCredits([{ usage_date: "2026-11-05", count: BUDGET / 2 }], NOW);
    expect(days.map((d) => d.date)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]);
    expect(days[2].percent).toBe(50);
    expect(days[6]).toMatchObject({ isToday: true, percent: 0 });
  });

  it("uses the UTC day, as the server counts it, not the local one", () => {
    const lateUtc = new Date("2026-11-09T23:30:00Z");
    const earlyUtc = new Date("2026-11-10T00:30:00Z");
    const rows = [{ usage_date: "2026-11-09", count: 650_000 }];
    expect(summarizeCredits(rows, lateUtc).used).toBe(650_000);
    expect(summarizeCredits(rows, earlyUtc).used).toBe(0);
    expect(historyStart(earlyUtc)).toBe("2026-11-04");
  });
});

describe("timeUntilReset", () => {
  it("counts to the next midnight UTC", () => {
    expect(timeUntilReset(NOW)).toBe("5h 12m");
    expect(timeUntilReset(new Date("2026-11-09T23:30:00Z"))).toBe("30m");
    expect(timeUntilReset(new Date("2026-11-09T22:00:00Z"))).toBe("2h");
  });
});

describe("whatsLeftCovers", () => {
  const count = (remaining: number, label: string) => whatsLeftCovers(remaining).find((c) => c.label.startsWith(label))?.count;

  it("covers more than the day it was sized for, each on its own", () => {
    expect(count(BUDGET, "Comprehensive")).toBe(6);
    expect(count(BUDGET, "QBank")).toBe(181);
  });

  it("never promises part of something", () => {
    expect(count(491_999, "Comprehensive")).toBe(0);
    expect(count(0, "QBank")).toBe(0);
  });
});
