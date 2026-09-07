import { describe, it, expect } from "vitest";
import { checkQuestion, checkBatch } from "./qbank-qa";
import type { GeneratedQuestionDraft } from "./qbank-types";

/** A clean item: every mechanical check should pass on it. */
function draft(over: Partial<GeneratedQuestionDraft> = {}): GeneratedQuestionDraft {
  return {
    index: 1,
    system: "Renal & Urinary",
    domain: "Physiology",
    subtopic: "Thiazide handling of calcium",
    competency: "Foundational Science",
    difficulty: "Medium",
    reasoningOrder: "2nd",
    reasoningChain: "Internal blueprint.",
    vignette:
      "A 54-year-old presents for review of recurrent stones. Serum potassium is low and bicarbonate is raised. Urinary calcium excretion is reduced.",
    leadIn: "Which transporter is directly inhibited?",
    options: {
      a: "Sodium-potassium-chloride cotransporter",
      b: "Sodium-chloride cotransporter",
      c: "Epithelial sodium channel",
      d: "Carbonic anhydrase",
      e: "Aquaporin-2 water channel",
    },
    correctOption: "b",
    explanation:
      "**Thiazide diuretics** block the **NCC cotransporter** in the distal convoluted tubule, raising sodium delivery downstream.",
    distractorExplanations: {
      a: "Loop agents act here and cause hypercalciuria instead.",
      c: "Blocking this spares potassium rather than wasting it.",
      d: "This produces a metabolic acidosis, not an alkalosis.",
      e: "This governs water handling, not electrolyte transport.",
    },
    teachingPoint: "**Thiazides lower urinary calcium.**",
    selfCheck: { rule1: true, rule7: true },
    reviewerFlag: "None.",
    ...over,
  };
}

const rules = (d: GeneratedQuestionDraft, expected?: "a" | "b" | "c" | "d" | "e") =>
  checkQuestion(d, expected).findings.map((f) => f.rule);

describe("checkQuestion", () => {
  it("passes a clean item", () => {
    const result = checkQuestion(draft());
    expect(result.findings).toEqual([]);
    expect(result.blocked).toBe(false);
  });

  it("blocks a correct answer that stands out by length", () => {
    const d = draft({
      options: {
        a: "Loop transporter",
        b: "The sodium-chloride cotransporter of the early distal convoluted tubule, which also governs calcium reabsorption indirectly",
        c: "Sodium channel",
        d: "Carbonic anhydrase",
        e: "Water channel",
      },
    });
    expect(rules(d)).toContain("key-longest");
    expect(checkQuestion(d).blocked).toBe(true);
  });

  // Real option lengths from generated batches, for keys that happened to be
  // the longest option. Comparing against the mean at a 25% margin blocked all
  // three; none is a length a student could read anything into.
  it.each([
    ["a 2-char gap", 48, 46],
    ["a 14-char gap", 95, 81],
    ["a 4-char gap", 76, 72],
  ])("does not block a key that clears the field by only %s", (_label, keyLen, longestLen) => {
    const d = draft({
      options: {
        a: "x".repeat(longestLen),
        b: "x".repeat(keyLen),
        c: "x".repeat(Math.round(longestLen * 0.6)),
        d: "x".repeat(Math.round(longestLen * 0.5)),
        e: "x".repeat(Math.round(longestLen * 0.6)),
      },
    });
    expect(rules(d)).not.toContain("key-longest");
  });

  it("allows a merely-longest key that is not an outlier", () => {
    const d = draft({
      options: {
        a: "Sodium-potassium-chloride cotransporter",
        b: "Sodium-chloride cotransporter of the DCT",
        c: "Epithelial sodium channel of the duct",
        d: "Carbonic anhydrase in the proximal tubule",
        e: "Aquaporin-2 water channel of the duct",
      },
    });
    expect(rules(d)).not.toContain("key-longest");
  });

  it("blocks banned qualifier language in an option", () => {
    const d = draft({ options: { ...draft().options, c: "Always the sodium channel" } });
    expect(rules(d)).toContain("banned-option-language");
  });

  it("blocks an all-of-the-above option", () => {
    const d = draft({ options: { ...draft().options, e: "All of the above" } });
    expect(rules(d)).toContain("all-or-none-option");
  });

  it("blocks two options that say the same thing", () => {
    const d = draft({ options: { ...draft().options, e: "Sodium-chloride cotransporter" } });
    expect(rules(d)).toContain("duplicate-option");
  });

  it("blocks an open lead-in", () => {
    const d = draft({ leadIn: "Which of the following is true about thiazides?" });
    expect(rules(d)).toContain("open-lead-in");
  });

  it("warns when the vignette asks the question itself", () => {
    const d = draft({
      vignette: "A 54-year-old presents with stones. Which transporter is inhibited?",
    });
    expect(rules(d)).toContain("question-in-vignette");
  });

  it("does not flag cueing on a word from the question's own subject", () => {
    const d = draft({
      subtopic: "Thiazide handling of calcium",
      vignette: "A patient taking a thiazide develops recurrent stones and low potassium.",
      options: { ...draft().options, b: "Thiazide-sensitive transporter" },
    });
    expect(rules(d)).not.toContain("stem-key-cueing");
  });

  it("does not flag cueing on common physiology vocabulary", () => {
    const d = draft({
      vignette: "Blood pressure is elevated and diastolic pressure is low on examination.",
      options: { ...draft().options, b: "Diastolic runoff into the ventricle" },
    });
    expect(rules(d)).not.toContain("stem-key-cueing");
  });

  it("warns when the lead-in is not a question", () => {
    const d = draft({ leadIn: "Identify the inhibited transporter." });
    expect(rules(d)).toContain("lead-in-not-question");
    expect(checkQuestion(d).blocked).toBe(false);
  });

  it("blocks reasoning scaffolding leaking into the explanation", () => {
    const d = draft({ explanation: "Step 1: low potassium. Step 2: therefore a thiazide." });
    expect(rules(d)).toContain("explanation-meta-language");
    expect(checkQuestion(d).blocked).toBe(true);
  });

  it("warns on a word shared by stem and key but no distractor", () => {
    const d = draft({
      vignette: "A patient on spironolactone presents with hyperkalemia after several weeks.",
      // Kept short so the length check cannot fire and confuse the assertion.
      options: { ...draft().options, b: "Spironolactone target" },
    });
    const found = rules(d);
    expect(found).toContain("stem-key-cueing");
    expect(checkQuestion(d).blocked).toBe(false);
  });

  it("does not call it cueing when the word also appears in a distractor", () => {
    const d = draft({
      vignette: "A patient on a thiazide presents with recurrent calcium stones and low potassium.",
      options: {
        ...draft().options,
        b: "Thiazide-sensitive cotransporter",
        a: "Thiazide-insensitive loop cotransporter",
      },
    });
    expect(rules(d)).not.toContain("stem-key-cueing");
  });

  it("warns on a missing distractor explanation", () => {
    const d = draft({ distractorExplanations: { a: "No.", c: "No.", d: "No." } });
    expect(rules(d)).toContain("missing-distractor-explanation");
  });

  it("warns when the key is given a why-it-is-wrong entry", () => {
    const d = draft({
      distractorExplanations: { ...draft().distractorExplanations, b: "Wrong because…" },
    });
    expect(rules(d)).toContain("distractor-explains-key");
  });

  it("warns on over-bolding and on no bolding", () => {
    expect(rules(draft({ explanation: "Plain prose with no emphasis at all." })))
      .toContain("no-bolding");
    expect(rules(draft({ explanation: "**a** **b** **c** **d** **e** **f**" })))
      .toContain("over-bolding");
  });

  it("warns when a distractor explanation is bolded", () => {
    const d = draft({
      distractorExplanations: { ...draft().distractorExplanations, a: "**Loop agents** act here." },
    });
    expect(rules(d)).toContain("bolded-distractor");
  });

  it("surfaces a self-check the model reported as failing", () => {
    const d = draft({ selfCheck: { rule1: true, rule10: false } });
    const finding = checkQuestion(d).findings.find((f) => f.rule === "self-check-failed");
    expect(finding?.detail).toContain("rule10");
  });

  it("warns when the answer lands on a different letter than the plan assigned", () => {
    expect(rules(draft(), "d")).toContain("answer-position-drift");
    expect(rules(draft(), "b")).not.toContain("answer-position-drift");
    // The item is still usable — only its position in the batch spread suffers.
    expect(checkQuestion(draft(), "d").blocked).toBe(false);
  });
});

describe("checkBatch", () => {
  it("flags two questions testing the same content", () => {
    const a = draft({ index: 1 });
    const b = draft({ index: 2 });
    const results = checkBatch([a, b]);
    expect(results[0].findings.map((f) => f.rule)).toContain("duplicate-question");
    expect(results[1].findings.map((f) => f.rule)).toContain("duplicate-question");
  });

  it("leaves genuinely different questions alone", () => {
    const a = draft({ index: 1 });
    const b = draft({
      index: 2,
      subtopic: "Loop diuretic ototoxicity",
      vignette:
        "A 71-year-old develops tinnitus and reduced hearing shortly after rapid intravenous therapy for pulmonary congestion.",
      leadIn: "Which structure accounts for the auditory effect?",
    });
    const results = checkBatch([a, b]);
    expect(results[0].findings.map((f) => f.rule)).not.toContain("duplicate-question");
  });

  it("applies the batch plan's answer letters positionally", () => {
    const results = checkBatch([draft({ index: 1 }), draft({ index: 2 })], ["b", "e"]);
    expect(results[0].findings.map((f) => f.rule)).not.toContain("answer-position-drift");
    expect(results[1].findings.map((f) => f.rule)).toContain("answer-position-drift");
  });
});
