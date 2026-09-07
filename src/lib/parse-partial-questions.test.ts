import { describe, it, expect } from "vitest";
import { parsePartialQuestions, parseQuestionsOutput } from "./parse-partial-questions";

function question(index: number, over: Record<string, unknown> = {}) {
  return {
    index,
    system: "Cardiovascular",
    domain: "Physiology",
    subtopic: `Subtopic ${index}`,
    competency: "Foundational Science",
    difficulty: "Medium",
    reasoningOrder: "2nd",
    reasoningChain: "Chain for internal use only.",
    vignette: `Vignette ${index} describing a presentation.`,
    leadIn: "Which mechanism explains the finding?",
    options: { a: "Alpha", b: "Beta", c: "Gamma", d: "Delta", e: "Epsilon" },
    correctOption: "c",
    explanation: "**Mechanism** drives the finding.",
    distractorExplanations: { a: "No.", b: "No.", d: "No.", e: "No." },
    teachingPoint: "**Remember this.**",
    suggestedImage: { needed: "No", type: "none", searchTags: [], mustShow: "" },
    selfCheck: { rule1: true, rule7: true },
    reviewerFlag: "None.",
    ...over,
  };
}

const BATCH = JSON.stringify({
  batchPlan: { system: "Cardiovascular", answerPositions: ["c", "a", "e"] },
  questions: [question(1), question(2), question(3)],
});

describe("parsePartialQuestions", () => {
  it("returns every question once the batch closes", () => {
    const drafts = parsePartialQuestions(BATCH);
    expect(drafts).toHaveLength(3);
    expect(drafts.map((d) => d.index)).toEqual([1, 2, 3]);
    expect(drafts[0].options.c).toBe("Gamma");
    expect(drafts[0].correctOption).toBe("c");
  });

  it("never throws, whatever prefix of the stream has arrived", () => {
    for (let i = 0; i <= BATCH.length; i++) {
      expect(() => parsePartialQuestions(BATCH.slice(0, i))).not.toThrow();
    }
  });

  it("reveals questions one at a time as each object closes", () => {
    const counts = new Set<number>();
    for (let i = 0; i <= BATCH.length; i++) {
      counts.add(parsePartialQuestions(BATCH.slice(0, i)).length);
    }
    // 0, 1, 2 and 3 must each be observable — that progression is the whole
    // point of streaming the batch rather than waiting for it.
    expect([...counts].sort()).toEqual([0, 1, 2, 3]);
  });

  it("never emits a question that is still being written", () => {
    // Cut mid-way through the second question's options.
    const cut = BATCH.indexOf('"options"', BATCH.indexOf('"index":2')) + 20;
    const drafts = parsePartialQuestions(BATCH.slice(0, cut));
    expect(drafts).toHaveLength(1);
    expect(drafts[0].index).toBe(1);
  });

  it("returns nothing before the questions array opens", () => {
    expect(parsePartialQuestions('{"batchPlan": {"system": "Cardio')).toEqual([]);
    expect(parsePartialQuestions("")).toEqual([]);
  });

  it("skips a malformed element without hiding the ones after it", () => {
    const raw = `{"questions":[{"index":1,"broken":},${JSON.stringify(question(2))}]}`;
    const drafts = parsePartialQuestions(raw);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].index).toBe(2);
  });

  it("drops an element missing the fields a student would need", () => {
    const raw = JSON.stringify({
      questions: [
        // No lead-in, and only two options — not a question.
        { index: 1, vignette: "A stem.", options: { a: "x", b: "y" }, correctOption: "a" },
        question(2),
      ],
    });
    expect(parsePartialQuestions(raw).map((d) => d.index)).toEqual([2]);
  });

  it("tolerates a fenced response", () => {
    const drafts = parsePartialQuestions("```json\n" + BATCH + "\n```");
    expect(drafts).toHaveLength(3);
  });

  it("handles braces and brackets inside string values", () => {
    const raw = JSON.stringify({
      questions: [question(1, { vignette: 'He said "{[" and then }] happened.' })],
    });
    expect(parsePartialQuestions(raw)).toHaveLength(1);
  });

  it("falls back to defaults for an out-of-enum difficulty or reasoning order", () => {
    const raw = JSON.stringify({
      questions: [question(1, { difficulty: "Impossible", reasoningOrder: "4th" })],
    });
    const [draft] = parsePartialQuestions(raw);
    expect(draft.difficulty).toBe("Medium");
    expect(draft.reasoningOrder).toBe("2nd");
  });

  it("normalises a correct option given in upper case", () => {
    const raw = JSON.stringify({ questions: [question(1, { correctOption: "C" })] });
    expect(parsePartialQuestions(raw)[0].correctOption).toBe("c");
  });

  it("rejects a correct option that is not one of a–e", () => {
    const raw = JSON.stringify({ questions: [question(1, { correctOption: "f" })] });
    expect(parsePartialQuestions(raw)).toEqual([]);
  });
});

describe("parseQuestionsOutput", () => {
  it("parses a complete batch", () => {
    expect(parseQuestionsOutput(BATCH)).toHaveLength(3);
  });

  it("salvages the questions that completed before a truncation", () => {
    const cut = BATCH.indexOf('"index":3');
    const drafts = parseQuestionsOutput(BATCH.slice(0, cut));
    expect(drafts.map((d) => d.index)).toEqual([1, 2]);
  });

  it("returns nothing for a response that is not a question batch", () => {
    expect(parseQuestionsOutput("I'm sorry, I can't help with that.")).toEqual([]);
  });
});
