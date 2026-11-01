import { describe, it, expect } from "vitest";
import {
  CARD_SLICE_KEYS,
  MAX_DECK_QUESTIONS,
  cardSliceLine,
  parseDeckSource,
  qbankMaterial,
  sheetMaterial,
  studyMaterialBlock,
  type AnsweredQuestion,
} from "../../supabase/functions/_shared/deck-source.ts";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("parseDeckSource", () => {
  it("takes question ids, deduplicated and capped at a block", () => {
    const ids = Array.from({ length: 30 }, (_, i) => ID(i));
    const parsed = parseDeckSource({ kind: "qbank", questionIds: [ID(1), ID(1), ...ids, "not-a-uuid", 7] });
    expect(parsed?.kind).toBe("qbank");
    expect(parsed && parsed.kind === "qbank" && parsed.questionIds.length).toBe(MAX_DECK_QUESTIONS);
    expect(parsed && parsed.kind === "qbank" && parsed.questionIds[0]).toBe(ID(1));
  });

  it("refuses a source with nothing usable in it", () => {
    expect(parseDeckSource({ kind: "qbank", questionIds: ["x"] })).toBeNull();
    expect(parseDeckSource({ kind: "sheet", plan: ["made_up"], sections: { made_up: "x" }, topic: "A" })).toBeNull();
    expect(parseDeckSource({ kind: "notes", text: "anything" })).toBeNull();
    expect(parseDeckSource("sheet")).toBeNull();
  });

  it("keeps a sheet's catalogue sections and the exact bodies for the signature check", () => {
    const parsed = parseDeckSource({
      kind: "sheet",
      plan: ["keyPoints", "invented"],
      sections: { keyPoints: ["Loop diuretics relieve congestion."], invented: "dropped" },
      topic: "  Heart   failure ",
      signature: null,
    });
    expect(parsed).toMatchObject({ kind: "sheet", plan: ["keyPoints"], topic: "Heart failure" });
    expect(parsed && parsed.kind === "sheet" && parsed.sent).toEqual({ keyPoints: ["Loop diuretics relieve congestion."] });
  });
});

describe("study material", () => {
  it("writes a sheet out section by section", () => {
    const parsed = parseDeckSource({
      kind: "sheet",
      plan: ["keyPoints"],
      sections: { keyPoints: ["Loop diuretics relieve congestion."] },
      topic: "Heart failure",
    });
    if (!parsed || parsed.kind !== "sheet") throw new Error("expected a sheet");
    expect(sheetMaterial(parsed)).toContain("- Loop diuretics relieve congestion.");
  });

  it("gives the card writer what grading reveals, not the vignette", () => {
    const q: AnsweredQuestion = {
      id: ID(1),
      topic: "Thiazide-induced hypocalciuria",
      question_text: "A 54-year-old man with hypertension presents with fatigue.\n\nWhich drug is most likely responsible?",
      option_a: "Furosemide",
      option_b: "Hydrochlorothiazide",
      option_c: "Lisinopril",
      option_d: "Amlodipine",
      option_e: "Spironolactone",
      correct_option: "b",
      explanation: "**Thiazides** inhibit the **NCC cotransporter**.",
      teaching_point: "Thiazides lower urine calcium.",
      distractor_explanations: { a: "Loops raise urine calcium.", b: "should never appear" },
    };
    const text = qbankMaterial([q]);
    expect(text).toContain("Asked: Which drug is most likely responsible?");
    expect(text).toContain("Correct answer: Hydrochlorothiazide");
    expect(text).toContain("Explanation: Thiazides inhibit the NCC cotransporter.");
    expect(text).toContain("- Furosemide: Loops raise urine calcium.");
    expect(text).not.toContain("54-year-old");
    expect(text).not.toContain("should never appear");
  });
});

describe("cardSliceLine", () => {
  it("keeps one batch to its kinds of card", () => {
    expect(CARD_SLICE_KEYS).toHaveLength(3);
    expect(cardSliceLine("explain")).toContain("[Mechanism]");
  });

  it("adds nothing for an unknown value", () => {
    for (const v of [undefined, "constructor", "__proto__", 2]) expect(cardSliceLine(v)).toBe("");
  });
});

// The assembled cards prompt (medical-notes-prompts-corti.ts) imports Deno-only
// modules, so it is checked through the local runner (scripts/notes-eval);
// the block it is given is checked here.
describe("studyMaterialBlock", () => {
  it("tells the writer to keep to the material and tag it", () => {
    const block = studyMaterialBlock("qbank", "## Question 1\nCorrect answer: Hydrochlorothiazide");
    expect(block).toContain("the QBank questions the student just answered");
    expect(block).toContain("Correct answer: Hydrochlorothiazide");
    expect(block).toContain("Never copy the vignette");
    expect(block).toContain("Tag every card [Grounded].");
  });

  it("asks a sheet deck to cover every section", () => {
    expect(studyMaterialBlock("sheet", "## Key points")).toContain("every section that has content");
  });
});
