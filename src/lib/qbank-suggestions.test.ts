import { describe, it, expect } from "vitest";
import { buildLibraryTopics, type LibraryCard } from "./library-topics";
import { buildSuggestions, type CurriculumTopic } from "./qbank-suggestions";
import { apportion, buildExamBlock, EXAM_WEIGHTS } from "./qbank-exam-block";
import { CHALLENGES, challengesFor, dailyChallenge } from "./qbank-challenges";
import { SYSTEM_KEYS } from "../../supabase/functions/_shared/qbank-systems.ts";

const NOW = Date.UTC(2026, 9, 30, 12);
const DAY = 86_400_000;

const CURRICULUM: CurriculumTopic[] = [
  { title: "Heart Failure — HFrEF (GDMT)", system: "cardiovascular", sortOrder: 80 },
  { title: "Heart Failure — HFpEF & Acute Decompensation", system: "cardiovascular", sortOrder: 90 },
  { title: "Cardiomyopathies (Dilated, Hypertrophic, Restrictive)", system: "cardiovascular", sortOrder: 100 },
  { title: "Aortic Valve Disease (AS & AR)", system: "cardiovascular", sortOrder: 110 },
  { title: "Nephrotic Syndrome & Minimal Change Disease", system: "renal", sortOrder: 80 },
  { title: "Acid-Base Disorders", system: "renal", sortOrder: 20 },
  { title: "Diabetic Ketoacidosis & Hyperosmolar State", system: "endocrine", sortOrder: 30 },
];

const card = (topic: string): LibraryCard => ({ topic, dueAt: NOW + DAY, createdAt: NOW - DAY, state: 2, mature: false });

describe("buildSuggestions", () => {
  it("leads with the student's own untested topic, weak spot and a mix of a topic done well", () => {
    const topics = buildLibraryTopics(
      {
        sheets: [{ id: "s1", topic: "Nephrotic syndrome", timestamp: NOW - DAY }],
        cards: [card("Diabetic ketoacidosis")],
        sets: [
          { id: "q1", topic: "Asthma", system: "Respiratory", score: 1, total: 5, endedAt: NOW - 2 * DAY },
          { id: "q2", topic: "Heart failure HFrEF", system: "Cardiovascular", score: 4, total: 5, endedAt: NOW - DAY },
        ],
      },
      { now: NOW }
    );
    const out = buildSuggestions({ topics, target: "step1", curriculum: CURRICULUM, now: NOW });

    expect(out).toHaveLength(6);
    expect(out.slice(0, 4).map((s) => s.kind)).toEqual(["library", "library", "weak", "daily"]);
    expect(out[0]).toMatchObject({ title: "Nephrotic syndrome", systems: ["renal"], size: 5 });
    expect(out[2]).toMatchObject({ title: "Asthma", hook: "20% last time — win it back." });
  });

  it("offers a 'mix it' set with curriculum neighbours once a topic is done well on its own", () => {
    const topics = buildLibraryTopics(
      { sheets: [], cards: [], sets: [{ id: "q", topic: "Heart failure HFrEF", system: "Cardiovascular", score: 5, total: 5, endedAt: NOW - DAY }] },
      { now: NOW }
    );
    const mix = buildSuggestions({ topics, target: "step1", curriculum: CURRICULUM, now: NOW }).find((s) => s.kind === "mixit");
    expect(mix?.topics).toEqual([
      "Heart Failure — HFrEF (GDMT)",
      "Heart Failure — HFpEF & Acute Decompensation",
      "Cardiomyopathies (Dilated, Hypertrophic, Restrictive)",
    ]);
    expect(mix?.systems).toEqual(["cardiovascular", "cardiovascular", "cardiovascular"]);
  });

  it("gives a brand-new student today's challenge and a full row of catalogue cards", () => {
    const out = buildSuggestions({ topics: [], target: "step2ck", curriculum: CURRICULUM, now: NOW });
    expect(out).toHaveLength(6);
    expect(out[0].kind).toBe("daily");
    expect(out.every((s) => s.topics.length > 0 && s.topics.length === s.systems.length)).toBe(true);
    // Step 2 CK students never see Step 1-only showdowns.
    const step1Only = new Set(CHALLENGES.filter((c) => c.track === "step1").map((c) => c.title));
    expect(out.some((s) => step1Only.has(s.title))).toBe(false);
  });

  it("rotates the catalogue with 'Show others'", () => {
    const a = buildSuggestions({ topics: [], target: "mixed", curriculum: CURRICULUM, now: NOW, seed: 0 });
    const b = buildSuggestions({ topics: [], target: "mixed", curriculum: CURRICULUM, now: NOW, seed: 1 });
    expect(a[0].id).toBe(b[0].id); // today's challenge stays
    expect(a.slice(1).map((s) => s.id)).not.toEqual(b.slice(1).map((s) => s.id));
  });
});

describe("the challenge catalogue", () => {
  it("names a known system for every topic, and has cards for each exam", () => {
    for (const c of CHALLENGES) {
      for (const t of c.topics) expect(SYSTEM_KEYS).toContain(t.system);
      expect(c.size).toBeGreaterThanOrEqual(c.topics.length);
    }
    expect(challengesFor("step1").length).toBeGreaterThan(10);
    expect(challengesFor("step2ck").length).toBeGreaterThan(10);
  });

  it("serves one daily challenge per day", () => {
    expect(dailyChallenge("step1", NOW).id).toBe(dailyChallenge("step1", NOW + 3_600_000).id);
    expect(dailyChallenge("step1", NOW).id).not.toBe(dailyChallenge("step1", NOW + DAY).id);
  });
});

describe("buildExamBlock", () => {
  const seeded = (seed = 11) => {
    let x = seed;
    return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
  };

  it("apportions exactly the block size", () => {
    const counts = apportion(20, EXAM_WEIGHTS.step1, seeded());
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(20);
    const ten = apportion(10, EXAM_WEIGHTS.step2ck, seeded(3));
    expect(Object.values(ten).reduce((a, b) => a + b, 0)).toBe(10);
  });

  it("weights Step 2 CK toward ethics more than Step 1 does", () => {
    const s1 = apportion(100, EXAM_WEIGHTS.step1, seeded());
    const s2 = apportion(100, EXAM_WEIGHTS.step2ck, seeded());
    expect(s2.social_sciences).toBeGreaterThan(s1.social_sciences);
  });

  it("returns one distinct topic per question with its system, only from systems that have topics", () => {
    const block = buildExamBlock({ target: "step1", size: 10, curriculum: CURRICULUM, random: seeded() });
    expect(block.topics.length).toBeLessThanOrEqual(10);
    expect(block.topics.length).toBe(block.systems.length);
    expect(new Set(block.topics).size).toBe(block.topics.length);
    const allowed = new Set(["cardiovascular", "renal", "endocrine", "social_sciences", "biostats_epi"]);
    expect(block.systems.every((s) => allowed.has(s))).toBe(true);
  });
});
