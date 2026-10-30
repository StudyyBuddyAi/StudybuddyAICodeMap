import { describe, expect, it } from "vitest";
import { buildLibraryTopics, filterAndSortTopics, type LibraryCard } from "./library-topics";

const NOW = Date.UTC(2026, 9, 24, 12);
const DAY = 86_400_000;

const card = (topic: string, over: Partial<LibraryCard> = {}): LibraryCard => ({
  topic,
  dueAt: NOW + DAY,
  createdAt: NOW - 2 * DAY,
  state: 2,
  mature: false,
  ...over,
});

describe("buildLibraryTopics", () => {
  it("gathers a topic's sheet, deck and QBank sets together", () => {
    const topics = buildLibraryTopics(
      {
        sheets: [{ id: "s1", topic: "Heart failure", timestamp: NOW - 3 * DAY }],
        cards: [card("Heart Failure"), card("heart failure", { dueAt: NOW - DAY })],
        sets: [{ id: "q1", topic: "heart failure", system: "Cardiovascular", score: 2, total: 5, endedAt: NOW - DAY }],
      },
      { now: NOW }
    );
    expect(topics).toHaveLength(1);
    const [t] = topics;
    expect(t.title).toBe("Heart failure");
    expect(t.coverage).toBe(3);
    expect(t.deck).toMatchObject({ total: 2, due: 1 });
    expect(t.qbank).toMatchObject({ answered: 5, correct: 2, accuracy: 40 });
    expect(t.weak).toBe(true);
    // Due cards outrank everything else.
    expect(t.next.kind).toBe("review");
  });

  it("does not invent a topic out of review or mixed sets", () => {
    const topics = buildLibraryTopics(
      {
        sheets: [],
        cards: [],
        sets: [
          { id: "r1", topic: null, system: "Review", score: 3, total: 4, endedAt: NOW },
          { id: "m1", topic: "Asthma · DKA", mixed: true, system: "Mixed", score: 2, total: 6, endedAt: NOW },
          { id: "q1", topic: "Asthma", system: "Respiratory", score: 1, total: 5, endedAt: NOW },
        ],
      },
      { now: NOW }
    );
    expect(topics.map((t) => t.title)).toEqual(["Asthma"]);
  });

  it("matches phrases conservatively: a bare word never merges topics", () => {
    const topics = buildLibraryTopics(
      { sheets: [{ id: "s1", topic: "Heart failure", timestamp: NOW }], cards: [card("Failure")], sets: [] },
      { now: NOW }
    );
    expect(topics).toHaveLength(2);
  });

  it("advises a deck after a sheet, and the QBank after a deck", () => {
    const [onlySheet] = buildLibraryTopics({ sheets: [{ id: "s", topic: "DKA management", timestamp: NOW }], cards: [], sets: [] }, { now: NOW });
    expect(onlySheet.next.kind).toBe("make-deck");
    const [onlyDeck] = buildLibraryTopics({ sheets: [], cards: [card("Sepsis")], sets: [] }, { now: NOW });
    expect(onlyDeck.next.kind).toBe("practice");
    const [guestDeck] = buildLibraryTopics({ sheets: [], cards: [card("Sepsis")], sets: [] }, { now: NOW, canUseQBank: false });
    expect(guestDeck.next.kind).toBe("write-sheet");
  });

  it("does not call a topic weak on too few answers", () => {
    const [t] = buildLibraryTopics(
      { sheets: [], cards: [], sets: [{ id: "q", topic: "Asthma", system: "Respiratory", score: 0, total: 2, endedAt: NOW }] },
      { now: NOW }
    );
    expect(t.weak).toBe(false);
  });
});

describe("filterAndSortTopics", () => {
  const topics = buildLibraryTopics(
    {
      sheets: [{ id: "s", topic: "Pneumonia", timestamp: NOW - 5 * DAY }],
      cards: [card("Sepsis", { dueAt: NOW - DAY }), card("Sepsis", { dueAt: NOW - DAY })],
      sets: [{ id: "q", topic: "Asthma", system: "Respiratory", score: 1, total: 5, endedAt: NOW }],
    },
    { now: NOW }
  );

  it("filters to what needs attention", () => {
    const opts = { sort: "recent" as const, query: "" };
    expect(filterAndSortTopics(topics, { ...opts, filter: "due" }).map((t) => t.title)).toEqual(["Sepsis"]);
    expect(filterAndSortTopics(topics, { ...opts, filter: "weak" }).map((t) => t.title)).toEqual(["Asthma"]);
    expect(filterAndSortTopics(topics, { ...opts, filter: "gaps" })).toHaveLength(3);
  });

  it("searches and sorts", () => {
    expect(filterAndSortTopics(topics, { filter: "all", sort: "az", query: "" }).map((t) => t.title)).toEqual([
      "Asthma",
      "Pneumonia",
      "Sepsis",
    ]);
    expect(filterAndSortTopics(topics, { filter: "all", sort: "recent", query: "pneu" })).toHaveLength(1);
  });
});
