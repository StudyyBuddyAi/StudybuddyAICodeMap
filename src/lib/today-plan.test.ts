import { describe, expect, it } from "vitest";
import { buildLibraryTopics, type LibraryCard } from "./library-topics";
import { buildTodayPlan, lastSevenDays } from "./today-plan";

const NOW = Date.UTC(2026, 9, 24, 12);
const DAY = 86_400_000;
const card = (topic: string, over: Partial<LibraryCard> = {}): LibraryCard => ({
  topic,
  dueAt: NOW + DAY,
  createdAt: NOW - DAY,
  state: 2,
  mature: false,
  ...over,
});

describe("buildTodayPlan", () => {
  const topics = buildLibraryTopics(
    {
      sheets: [{ id: "s", topic: "Pneumonia", timestamp: NOW - DAY }],
      cards: [card("Sepsis", { dueAt: NOW - DAY }), card("Sepsis", { dueAt: NOW - DAY })],
      sets: [{ id: "q", topic: "Asthma", system: "Respiratory", score: 1, total: 5, endedAt: NOW - 2 * DAY }],
    },
    { now: NOW }
  );

  it("puts QBank retries after the unfinished set, and only for accounts", () => {
    const plan = buildTodayPlan({
      topics,
      dueTotal: 2,
      unfinished: { id: "u1", topic: "Anatomy", answered: 1, total: 10 },
      signedIn: true,
      qbankDue: 7,
    });
    expect(plan.map((p) => p.kind).slice(0, 3)).toEqual(["review", "resume", "retry"]);
    expect(plan[2]).toMatchObject({ title: "Retry 7 QBank questions", target: { kind: "route", to: "/qbank" } });

    const guest = buildTodayPlan({ topics, dueTotal: 0, unfinished: null, signedIn: false, qbankDue: 7 });
    expect(guest.map((p) => p.kind)).not.toContain("retry");
    const none = buildTodayPlan({ topics, dueTotal: 0, unfinished: null, signedIn: true, qbankDue: 0 });
    expect(none.map((p) => p.kind)).not.toContain("retry");
  });

  it("puts due cards first, then the unfinished set, weak spots and next steps", () => {
    const plan = buildTodayPlan({
      topics,
      dueTotal: 2,
      unfinished: { id: "u1", topic: "Anatomy", answered: 1, total: 10 },
      signedIn: true,
    });
    expect(plan.map((p) => p.kind)).toEqual(["review", "resume", "weak", "next"]);
    expect(plan[0].title).toBe("Review 2 due cards");
    expect(plan[1].target).toEqual({ kind: "route", to: "/qbank/session?session=u1" });
    expect(plan[2].title).toBe("Practise Asthma");
    // Pneumonia has a sheet and no deck: the next step is a deck, pre-filled.
    expect(plan[3].target).toEqual({ kind: "route", to: "/flashcards", state: { prefill: "Pneumonia" } });
  });

  it("leaves QBank steps out for a guest", () => {
    const plan = buildTodayPlan({ topics, dueTotal: 0, unfinished: null, signedIn: false });
    expect(plan.some((p) => p.target.kind === "route" && p.target.to.startsWith("/qbank"))).toBe(false);
  });

  it("offers a start when there is nothing to do", () => {
    const plan = buildTodayPlan({ topics: [], dueTotal: 0, unfinished: null, signedIn: true });
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe("start");
  });
});

describe("lastSevenDays", () => {
  it("lists seven days ending today, marking the active ones", () => {
    const key = (t: number) => new Date(t).toISOString().slice(0, 10);
    const days = lastSevenDays(new Set([key(NOW), key(NOW - 2 * DAY)]), key, NOW);
    expect(days).toHaveLength(7);
    expect(days[6]).toMatchObject({ today: true, active: true });
    expect(days[4].active).toBe(true);
    expect(days[5].active).toBe(false);
  });
});
