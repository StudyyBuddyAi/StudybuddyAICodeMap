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

const rules = (d: GeneratedQuestionDraft) => checkQuestion(d).findings.map((f) => f.rule);

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

  it("blocks an item that argues against its own key", () => {
    const d = draft({
      distractorExplanations: { ...draft().distractorExplanations, b: "Wrong because…" },
    });
    expect(rules(d)).toContain("distractor-explains-key");
    expect(checkQuestion(d).blocked).toBe(true);
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

  it("does not read ordinary prose as reasoning scaffolding", () => {
    // Both of these blocked a good item under the old substring match.
    expect(rules(draft({ explanation: "**ALAS2** catalyses the first step of heme synthesis." })))
      .not.toContain("explanation-meta-language");
    expect(rules(draft({ explanation: "A classic **USMLE Step 1** association." })))
      .not.toContain("explanation-meta-language");
  });

  it("flags options that are not all the category the lead-in asked for", () => {
    const d = draft({
      leadIn: "Which cord of the brachial plexus carries the disrupted fibres?",
      options: {
        a: "Medial cord",
        b: "Lateral cord",
        c: "Inferior trunk",
        d: "Middle trunk",
        e: "Posterior cord",
      },
      distractorExplanations: { a: "No.", c: "No.", d: "No.", e: "No." },
    });
    expect(rules(d)).toContain("mixed-option-categories");
    // A warn: the word test is too crude to withhold a question on.
    expect(checkQuestion(d).blocked).toBe(false);
  });

  it("does not flag a set whose options name instances rather than the category", () => {
    // Measured false positive: every option here is a cell type, but only two
    // of them spell the word out. An earlier version blocked this question.
    const d = draft({
      leadIn: "Which cells are the primary site of action for this peptide?",
      options: {
        a: "Macrophages of the reticuloendothelial system",
        b: "Parietal cells of the gastric mucosa",
        c: "Erythroid precursors in the bone marrow",
        d: "Hepatocytes of the liver parenchyma",
        e: "Vascular endothelial cells of the hepatic sinusoids",
      },
      correctOption: "a",
      distractorExplanations: { b: "No.", c: "No.", d: "No.", e: "No." },
    });
    expect(rules(d)).not.toContain("mixed-option-categories");
  });

  it("leaves a homogeneous set alone even when it names the category", () => {
    const d = draft({
      leadIn: "Which cord of the brachial plexus carries the disrupted fibres?",
      options: {
        a: "Medial cord",
        b: "Lateral cord",
        c: "Posterior cord",
        d: "Medial cord contribution to the ulnar nerve",
        e: "Lateral cord contribution to the median nerve",
      },
      distractorExplanations: { a: "No.", c: "No.", d: "No.", e: "No." },
    });
    expect(rules(d)).not.toContain("mixed-option-categories");
  });

  it("does not fire when the category word is simply not the options' vocabulary", () => {
    // "Which enzyme…" against five enzyme names: none contain the word.
    expect(rules(draft({ leadIn: "Which enzyme is directly inhibited?" })))
      .not.toContain("mixed-option-categories");
    // A generic head noun names no category at all.
    expect(rules(draft({ leadIn: "Which mechanism best explains the finding?" })))
      .not.toContain("mixed-option-categories");
  });

  it("surfaces a concern the writer raised about its own item", () => {
    const flagged = draft({ reviewerFlag: "Buzzword from memory, unconfirmed." });
    const finding = checkQuestion(flagged).findings.find((f) => f.rule === "writer-flagged");
    expect(finding?.detail).toContain("unconfirmed");
    // A flag is a reviewer's problem, not a reason to withhold the item.
    expect(checkQuestion(flagged).blocked).toBe(false);
    expect(rules(draft({ reviewerFlag: "None." }))).not.toContain("writer-flagged");
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
      options: {
        a: "Organ of Corti hair cells",
        b: "Stria vascularis",
        c: "Spiral ganglion",
        d: "Tympanic membrane",
        e: "Auditory cortex",
      },
      correctOption: "b",
      distractorExplanations: { a: "No.", c: "No.", d: "No.", e: "No." },
    });
    const found = checkBatch([a, b])[0].findings.map((f) => f.rule);
    expect(found).not.toContain("duplicate-question");
    expect(found).not.toContain("repeated-lead-in");
    expect(found).not.toContain("shared-option-pool");
  });

  it("flags two questions that ask the same thing about different content", () => {
    // The vocabulary check cannot see this: the stems and subtopics genuinely
    // differ, and only the task is repeated.
    const a = draft({
      index: 1,
      subtopic: "Erb palsy",
      leadIn: "Which cord of the brachial plexus is injured in this infant?",
      vignette: "A newborn has the arm adducted and internally rotated after a difficult delivery.",
    });
    const b = draft({
      index: 2,
      subtopic: "Klumpke palsy",
      leadIn: "Which cord of the brachial plexus is injured in this climber?",
      vignette: "An adult has clawing of the fourth and fifth digits after a fall arrested overhead.",
    });
    const results = checkBatch([a, b]);
    expect(results[0].findings.map((f) => f.rule)).toContain("repeated-lead-in");
    expect(results[1].findings.map((f) => f.rule)).toContain("repeated-lead-in");
  });

  it("does not call a shared interrogative opener a repeated question", () => {
    // Measured false positive: four items in one batch matched on "which of the
    // following best", which is simply how a lead-in opens.
    const a = draft({
      index: 1,
      subtopic: "Multiple sclerosis",
      leadIn: "Which of the following best explains the periventricular lesions?",
    });
    const b = draft({
      index: 2,
      subtopic: "Guillain-Barré syndrome",
      leadIn: "Which of the following best accounts for the ascending weakness?",
      options: {
        a: "Schwann cell injury",
        b: "Oligodendrocyte loss",
        c: "Axonal transection",
        d: "Anterior horn cell death",
        e: "Neuromuscular junction blockade",
      },
      correctOption: "a",
      distractorExplanations: { b: "No.", c: "No.", d: "No.", e: "No." },
    });
    expect(checkBatch([a, b])[0].findings.map((f) => f.rule)).not.toContain("repeated-lead-in");
  });

  it("flags two questions drawing their options from one pool", () => {
    const a = draft({ index: 1, leadIn: "Which structure is injured here?" });
    const b = draft({
      index: 2,
      subtopic: "Loop diuretic ototoxicity",
      vignette: "A 71-year-old develops tinnitus after rapid intravenous therapy for congestion.",
      leadIn: "Which target accounts for the auditory effect?",
    });
    // Same five options in both, which lets each be answered against the other.
    expect(checkBatch([a, b])[0].findings.map((f) => f.rule)).toContain("shared-option-pool");
  });
});
