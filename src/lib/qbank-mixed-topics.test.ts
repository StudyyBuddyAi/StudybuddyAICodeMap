import { describe, it, expect } from "vitest";
import {
  buildBatchPlan,
  buildUserMessage,
  systemPromptFor,
  QBANK_SYSTEM_PROMPTS,
  QBANK_FAMILY_PROMPTS,
  SYSTEM_KEYS,
  type PlanFocus,
} from "../../supabase/functions/_shared/qbank-prompt.ts";
import { prepareBatch } from "../../supabase/functions/_shared/qbank-persist.ts";
import { SYSTEM_NAMES, isFamily, systemKeyFor } from "../../supabase/functions/_shared/qbank-systems.ts";

const seeded = (seed = 7) => {
  let x = seed;
  return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
};

const FOCUSES: PlanFocus[] = [
  { topic: "Heart failure", system: "cardiovascular" },
  { topic: "Nephrotic syndrome", system: "renal" },
  { topic: "Breaking bad news (SPIKES)", system: "social_sciences" },
];

describe("mixed-topic plans", () => {
  it("takes the topics in turn by index, so the set comes out interleaved", () => {
    const plan = buildBatchPlan("cardiovascular", 5, seeded(), 1, "balanced", "step1", FOCUSES);
    expect(plan.questions.map((q) => q.focus)).toEqual([
      "Heart failure",
      "Nephrotic syndrome",
      "Breaking bad news (SPIKES)",
      "Heart failure",
      "Nephrotic syndrome",
    ]);
    expect(plan.questions.map((q) => q.system)).toEqual([
      "cardiovascular",
      "renal",
      "social_sciences",
      "cardiovascular",
      "renal",
    ]);
  });

  it("lets a later wave pick up the rotation from its start index alone", () => {
    const wave2 = buildBatchPlan("cardiovascular", 5, seeded(3), 6, "balanced", "step1", FOCUSES);
    // Index 6 → (6-1) mod 3 = 2 → the third topic.
    expect(wave2.questions[0]).toMatchObject({ index: 6, focus: "Breaking bad news (SPIKES)" });
    expect(wave2.questions.map((q) => q.index)).toEqual([6, 7, 8, 9, 10]);
  });

  it("leaves a single-topic plan exactly as it was", () => {
    const single = buildBatchPlan("cardiovascular", 5, seeded(), 1, "balanced", "step1", [FOCUSES[0]]);
    expect(single.focuses).toBeUndefined();
    expect(single.questions.every((q) => q.focus === undefined && q.system === undefined)).toBe(true);
    const legacy = buildBatchPlan("cardiovascular", 5, seeded(), 1, "balanced", "step1");
    expect(buildUserMessage({ topic: "Heart failure", plan: single })).toBe(
      buildUserMessage({ topic: "Heart failure", plan: legacy })
    );
  });

  it("briefs every system the wave touches and names each row's topic", () => {
    const plan = buildBatchPlan("cardiovascular", 5, seeded(), 1, "balanced", "step1", FOCUSES);
    const msg = buildUserMessage({ topic: "x", plan });
    expect(msg).toContain("## System Brief — Cardiovascular");
    expect(msg).toContain("## System Brief — Renal & Urinary");
    expect(msg).toContain("## System Brief — Communication & Ethics");
    expect(msg).toContain("- Question 2: reasoning order");
    expect(msg).toContain("focus: Nephrotic syndrome (Renal & Urinary)");
    expect(msg).toContain("## Requested topics — a mixed set");
    expect(msg).toContain("1. Heart failure (Cardiovascular)");
  });

  it("briefs both tracks per system in a mixed-exam set", () => {
    const plan = buildBatchPlan("cardiovascular", 2, seeded(), 1, "balanced", "mixed", FOCUSES.slice(0, 2));
    const msg = buildUserMessage({ topic: "x", plan });
    expect(msg).toContain("## System Brief — Cardiovascular (Step 1 track)");
    expect(msg).toContain("## System Brief — Cardiovascular (Step 2 CK track)");
    expect(msg).toContain("## System Brief — Renal & Urinary (Step 2 CK track)");
  });
});

describe("Communication & Ethics and Biostatistics", () => {
  it("are routable systems with their own names and briefs", () => {
    expect(SYSTEM_KEYS).toContain("social_sciences");
    expect(SYSTEM_KEYS).toContain("biostats_epi");
    expect(isFamily("biostats_epi")).toBe(true);
    expect(isFamily("cardiovascular")).toBe(false);
    expect(systemKeyFor("Communication & Ethics")).toBe("social_sciences");
    expect(systemKeyFor("Renal & Urinary")).toBe("renal");
  });

  it("switch the set to the family prompt only when a family item is in it", () => {
    const organ = buildBatchPlan("cardiovascular", 5, seeded(), 1, "balanced", "step1");
    expect(systemPromptFor(organ)).toBe(QBANK_SYSTEM_PROMPTS.step1);

    const ethics = buildBatchPlan("social_sciences", 5, seeded(), 1, "balanced", "step1");
    expect(systemPromptFor(ethics)).toBe(QBANK_FAMILY_PROMPTS.step1);

    const mixed = buildBatchPlan("cardiovascular", 5, seeded(), 1, "balanced", "step2ck", FOCUSES);
    expect(systemPromptFor(mixed)).toBe(QBANK_FAMILY_PROMPTS.step2ck);
  });

  it("lift the Step 1 'mechanisms only' scope for their items, and only add to the baseline", () => {
    const variant = QBANK_FAMILY_PROMPTS.step1;
    expect(variant.startsWith(QBANK_SYSTEM_PROMPTS.step1.slice(0, 500))).toBe(true);
    expect(variant).toContain("the \"Test only\" and \"Never Test\" lists above are replaced");
    expect(variant.length).toBeGreaterThan(QBANK_SYSTEM_PROMPTS.step1.length);
  });

  it("file family items under their own domain and an allowed competency", () => {
    const plan = buildBatchPlan("cardiovascular", 3, seeded(), 1, "balanced", "step1", FOCUSES);
    const item = (index: number, over: Record<string, unknown> = {}) => ({
      index,
      domain: "Pathology",
      subtopic: `s${index}`,
      competency: "Foundational Science",
      difficulty: "Medium",
      reasoningOrder: "2nd",
      vignette: `Case ${index} stem.`,
      leadIn: "Which is next?",
      options: { a: "One", b: "Two", c: "Three", d: "Four", e: "Five" },
      correctOption: "a",
      explanation: "**x**",
      distractorExplanations: { b: "n", c: "n", d: "n", e: "n" },
      ...over,
    });
    const content = JSON.stringify({ questions: [item(1), item(2), item(3, { competency: "Made up" })] });
    const { questions } = prepareBatch(content, plan);

    expect(questions[0]).toMatchObject({ focus: "Heart failure", system: "cardiovascular", domain: "Pathology" });
    expect(questions[1]).toMatchObject({ focus: "Nephrotic syndrome", system: "renal" });
    expect(questions[2]).toMatchObject({
      focus: "Breaking bad news (SPIKES)",
      system: "social_sciences",
      domain: "Communication & Ethics",
      competency: "Communication and Interpersonal Skills",
    });
    expect(SYSTEM_NAMES.social_sciences).toBe("Communication & Ethics");
  });
});
