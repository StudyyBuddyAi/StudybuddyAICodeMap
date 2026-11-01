import { describe, it, expect } from "vitest";
import { buildLibraryTopics, type LibraryCard } from "./library-topics";
import { buildDeckSuggestions } from "./deck-suggestions";
import type { CurriculumTopic } from "./qbank-suggestions";
import { CHALLENGES } from "./qbank-challenges";

const NOW = Date.UTC(2026, 10, 1, 12);
const DAY = 86_400_000;

const CURRICULUM: CurriculumTopic[] = [
  { title: "Heart Failure — HFrEF (GDMT)", system: "cardiovascular", sortOrder: 80 },
  { title: "Aortic Valve Disease (AS & AR)", system: "cardiovascular", sortOrder: 110 },
  { title: "Nephrotic Syndrome & Minimal Change Disease", system: "renal", sortOrder: 80 },
  { title: "Acid-Base Disorders", system: "renal", sortOrder: 20 },
];

const card = (topic: string): LibraryCard => ({ topic, dueAt: NOW + DAY, createdAt: NOW - DAY, state: 2, mature: false });

describe("buildDeckSuggestions", () => {
  it("leads with sheets that have no deck, then what the QBank caught out", () => {
    const topics = buildLibraryTopics(
      {
        sheets: [
          { id: "s1", topic: "Nephrotic syndrome", timestamp: NOW - DAY },
          { id: "s2", topic: "DKA", timestamp: NOW - 2 * DAY },
        ],
        // DKA already has a deck: no suggestion to make another.
        cards: [card("DKA")],
        sets: [{ id: "q1", topic: "Asthma", system: "Respiratory", score: 1, total: 5, endedAt: NOW - DAY }],
      },
      { now: NOW }
    );
    const out = buildDeckSuggestions({ topics, target: "step1", curriculum: CURRICULUM, now: NOW });
    expect(out.slice(0, 3).map((s) => [s.kind, s.title])).toEqual([
      ["sheet", "Nephrotic syndrome"],
      ["weak", "Asthma"],
      ["pair", out[2].title],
    ]);
    expect(out[1].hook).toContain("20% in the QBank");
    expect(out.length).toBeLessThanOrEqual(6);
  });

  it("offers only look-alike showdowns as pairs, sized for every topic", () => {
    const out = buildDeckSuggestions({ topics: [], target: "step2ck", curriculum: CURRICULUM, now: NOW });
    const ids = new Set(CHALLENGES.filter((c) => c.kind === "showdown").map((c) => c.id));
    for (const s of out.filter((s) => s.kind === "pair" || s.kind === "showdown")) {
      expect(ids.has(s.id.replace(/^(pair|showdown)-/, ""))).toBe(true);
      expect(s.size).toBeGreaterThanOrEqual(s.topics.length * 4);
    }
  });

  it("suggests an uncarded curriculum topic in a system the student studies", () => {
    const topics = buildLibraryTopics(
      { sheets: [{ id: "s1", topic: "Acid-base disorders", timestamp: NOW - DAY }], cards: [], sets: [] },
      { now: NOW }
    );
    const out = buildDeckSuggestions({ topics, target: "step1", curriculum: CURRICULUM, now: NOW });
    expect(out.find((s) => s.kind === "untouched")?.title).toBe("Nephrotic Syndrome & Minimal Change Disease");
  });

  it("rotates the showdowns on Show others", () => {
    const a = buildDeckSuggestions({ topics: [], target: "mixed", curriculum: CURRICULUM, now: NOW, seed: 0 });
    const b = buildDeckSuggestions({ topics: [], target: "mixed", curriculum: CURRICULUM, now: NOW, seed: 1 });
    expect(a.map((s) => s.id)).not.toEqual(b.map((s) => s.id));
  });
});
