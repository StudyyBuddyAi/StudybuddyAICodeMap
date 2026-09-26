import { describe, it, expect } from "vitest";
import { hasPrimingQuestion, primingQuestion, topicName } from "./priming-questions";
import { ARCHETYPE_IDS, ARCHETYPES, SECTIONS } from "../../supabase/functions/_shared/sheet-sections.ts";
import { resolveSheetPlan, toWirePlan } from "../../supabase/functions/_shared/sheet-plan.ts";
import { parsePlan } from "./sheet-plan";

describe("topicName", () => {
  it("uses a short topic as typed", () => {
    expect(topicName("Lithium")).toBe("Lithium");
  });

  it("falls back to the topic's kind for a question or pasted notes", () => {
    expect(topicName("i keep mixing up SIADH and DI, how do i tell them apart?", "condition")).toBe(
      "this condition"
    );
    expect(topicName("asthma - reversible airway obstruction, type 2 inflam (eos, IL-4/5/13), triggers", "condition")).toBe(
      "this condition"
    );
    expect(topicName("why does hyperkalemia change the ECG?")).toBe("this topic");
  });
});

describe("primingQuestion", () => {
  it("asks about the sheet's first section that has a question", () => {
    // As the page receives it: the wire plan, through the page's own validator.
    const plan = parsePlan(toWirePlan(resolveSheetPlan({ archetype: "drug" })));
    expect(primingQuestion("Lithium", plan, "drug")).toBe(
      "How does Lithium work — what does it act on, and what follows?"
    );
  });

  it("asks about the topic as a whole before the plan is known", () => {
    expect(primingQuestion("Lithium", null)).toMatch(/^What do you already know about Lithium\?/);
  });

  it("has a question for the first content section of every archetype", () => {
    for (const id of ARCHETYPE_IDS) {
      const first = ARCHETYPES[id].spine.find((key) => hasPrimingQuestion(key));
      expect(first, id).toBeDefined();
    }
  });

  it("covers every content section, leaving out only the study aids", () => {
    const aids = new Set(["memoryHooks", "keyPoints", "examTraps"]);
    for (const key of Object.keys(SECTIONS)) {
      if (!aids.has(key)) expect(hasPrimingQuestion(key), key).toBe(true);
    }
  });
});
