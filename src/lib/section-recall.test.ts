import { describe, it, expect } from "vitest";
import { assignRecallCards, terms } from "./section-recall";
import type { GeneratedSheet } from "@/types/generated-sheet";

const base: GeneratedSheet = {
  overview: "",
  memoryHooks: [],
  clinicalApproach: "",
  keyPoints: [],
  examTraps: [],
  flashcards: [],
  referenceNote: "",
};

const HF: GeneratedSheet = {
  ...base,
  plan: [
    { key: "overview", title: "Overview", kind: "prose" },
    { key: "clinicalApproach", title: "Clinical Approach", kind: "prose" },
    { key: "examTraps", title: "Exam Traps", kind: "list" },
  ],
  sections: {
    overview:
      "Mechanism: Reduced contractility (**HFrEF**, ejection fraction under 40%) or impaired relaxation (**HFpEF**) raises preload and causes pulmonary congestion.",
    clinicalApproach:
      "Diagnosis: **BNP** first, then **echocardiography** to measure ejection fraction.\nChronic therapy: **sacubitril-valsartan**, beta-blocker, MRA and SGLT2 inhibitor.",
    examTraps: ["Never start a beta-blocker during **acute decompensation**."],
  },
  flashcards: [
    {
      tag: "Next Step",
      question: "A patient with suspected heart failure has dyspnea. What blood test comes first?",
      answer: "BNP, then echocardiography to measure the ejection fraction.",
    },
    {
      tag: "Mechanism",
      question: "Which heart failure type has preserved ejection fraction and impaired relaxation?",
      answer: "HFpEF — impaired relaxation raises preload.",
    },
    {
      tag: "Complication",
      question: "What causes digoxin toxicity?",
      answer: "Hypokalemia and renal failure.",
    },
  ],
};

describe("terms", () => {
  it("keeps content words and drops filler", () => {
    expect(terms("The patient presents with Pulmonary congestion")).toEqual([
      "pulmonary",
      "congestion",
    ]);
  });

  it("folds simple plurals so a card and a section agree", () => {
    expect(terms("inhibitors")).toEqual(terms("inhibitor"));
  });
});

describe("assignRecallCards", () => {
  it("puts each card under the section it tests", () => {
    const assigned = assignRecallCards(HF);
    expect(assigned.get("clinicalApproach")?.tag).toBe("Next Step");
    expect(assigned.get("overview")?.tag).toBe("Mechanism");
  });

  it("gives a section no card rather than an unrelated one", () => {
    // examTraps shares nothing with the digoxin card, the only one left over.
    expect(assignRecallCards(HF).has("examTraps")).toBe(false);
  });

  it("uses each card at most once", () => {
    const cards = [...assignRecallCards(HF).values()];
    expect(new Set(cards).size).toBe(cards.length);
  });

  it("returns nothing when the sheet has no deck", () => {
    expect(assignRecallCards({ ...HF, flashcards: [] }).size).toBe(0);
  });

  it("never asks under the reference note or the deck itself", () => {
    const keys = [...assignRecallCards(HF).keys()];
    expect(keys).not.toContain("referenceNote");
    expect(keys).not.toContain("flashcards");
  });
});
