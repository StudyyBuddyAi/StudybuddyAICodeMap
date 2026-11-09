import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { summarizeCredits } from "@/lib/daily-credits";
import { DAILY_CREDIT_BUDGET_MICROS as BUDGET } from "../../../supabase/functions/_shared/credits.ts";
import { DashboardUsageStrip, UsagePanel } from "./DailyUsage";

const NOW = new Date("2026-11-09T18:48:00Z");
const hook = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-daily-credits", () => ({ useDailyCredits: () => hook.value }));

const withUsed = (count: number) => {
  hook.value = {
    credits: summarizeCredits([{ usage_date: "2026-11-09", count }], NOW),
    resetsIn: "5h 12m",
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
};
const showStrip = () => render(<MemoryRouter><DashboardUsageStrip /></MemoryRouter>);
const showPanel = () => render(<TooltipProvider><UsagePanel enabled labelClassName="x" /></TooltipProvider>);

beforeEach(() => withUsed(650_000));

describe("the dashboard strip", () => {
  it("shows the day's use as a real progress bar, and links to the detail", () => {
    showStrip();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("20");
    expect(screen.getByText(/20% used · resets in 5h 12m/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /see usage/i }).getAttribute("href")).toContain("settings=usage");
  });

  it("says in words when it is running low or used up", () => {
    withUsed(BUDGET * 0.86);
    const { unmount } = showStrip();
    expect(screen.getByText(/Running low/)).toBeTruthy();
    unmount();
    withUsed(BUDGET);
    showStrip();
    expect(screen.getByText(/Used up for today/)).toBeTruthy();
  });

  it("disappears rather than alarming anyone when the read fails, or there is no session", () => {
    hook.value = { credits: null, resetsIn: "1h", isLoading: false, isError: true };
    expect(showStrip().container.firstChild).toBeNull();
    hook.value = { credits: null, resetsIn: "1h", isLoading: false, isError: false };
    expect(showStrip().container.firstChild).toBeNull();
  });
});

describe("the Usage tab", () => {
  it("shows the day, what is left, and the week", () => {
    showPanel();
    expect(screen.getByText("20% used")).toBeTruthy();
    expect(screen.getByText("Comprehensive sheets with deep dives")).toBeTruthy();
    expect(screen.getByRole("list", { name: /last 7 days/i })).toBeTruthy();
  });

  it("says when it comes back once nothing is left", () => {
    withUsed(BUDGET);
    showPanel();
    expect(screen.getByText("Nothing for now. It comes back in 5h 12m.")).toBeTruthy();
    expect(screen.queryByText("High-yield sheets")).toBeNull();
  });

  it("does not draw an empty chart for someone who has used nothing", () => {
    withUsed(0);
    showPanel();
    expect(screen.getByText("Nothing used yet.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: /last 7 days/i })).toBeNull();
  });

  it("offers a retry when the read fails", () => {
    hook.value = { credits: null, resetsIn: "1h", isLoading: false, isError: true, refetch: vi.fn() };
    showPanel();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });
});
