import { describe, it, expect } from "vitest";
import { repairLlmJson } from "./repair-llm-json";

/** Repairing then parsing is the only thing callers actually care about. */
const parse = (text: string) => JSON.parse(repairLlmJson(text));

describe("repairLlmJson", () => {
  it("leaves valid JSON byte-identical", () => {
    const valid = JSON.stringify({
      topicEmoji: "🩸",
      overview: "Mechanism: **x** — y\nPathophysiology: z → w",
      keyPoints: ["one", "two"],
      flashcards: [{ tag: "Next Step", question: "Q?", answer: "A." }],
    });
    expect(repairLlmJson(valid)).toBe(valid);
  });

  it("escapes an unescaped quote inside a value", () => {
    const broken = '{"question":"A patient with "coffee-ground" emesis presents"}';
    expect(parse(broken).question).toBe(
      'A patient with "coffee-ground" emesis presents'
    );
  });

  it("escapes an unescaped quote at the very start of a value", () => {
    const broken = '{"trap":""Gold standard" is not always first-line"}';
    expect(parse(broken).trap).toBe('"Gold standard" is not always first-line');
  });

  it("escapes raw newlines and tabs inside a value", () => {
    const broken = '{"clinicalApproach":"Diagnosis: echo\nManagement:\n\tFirst-line"}';
    expect(parse(broken).clinicalApproach).toBe(
      "Diagnosis: echo\nManagement:\n\tFirst-line"
    );
  });

  it("keeps a literal backslash that isn't a JSON escape", () => {
    expect(parse('{"note":"5\\10 mmHg"}').note).toBe("5\\10 mmHg");
  });

  it("keeps a valid unicode escape but rescues a malformed one", () => {
    expect(parse('{"a":"\\u0041"}').a).toBe("A");
    expect(parse('{"a":"x\\u00"}').a).toBe("x\\u00");
  });

  it("drops trailing commas before both closers", () => {
    expect(parse('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
  });

  it("leaves a comma-brace sequence inside a string alone", () => {
    expect(parse('{"a":"foo, } bar","b":1}')).toEqual({ a: "foo, } bar", b: 1 });
  });

  it("drops an escape the stream cut in half", () => {
    // The escaped character never arrived, so there is nothing to keep.
    expect(repairLlmJson('{"a":"line\\')).toBe('{"a":"line');
    expect(repairLlmJson('{"a":"alpha \\u00')).toBe('{"a":"alpha ');
  });

  it("does not mistake an escaped quote for content", () => {
    expect(parse('{"a":"already \\"escaped\\" here"}').a).toBe(
      'already "escaped" here'
    );
  });

  it("preserves emoji surrogate pairs", () => {
    expect(parse('{"topicEmoji":"🩸","topic":"Portal HTN"}').topicEmoji).toBe("🩸");
  });

  it("repairs the real-world shape: a bad quote in a late field", () => {
    const broken = `{
      "topic": "Portal Hypertension",
      "overview": "Mechanism: **Increased resistance**",
      "examTraps": ["Don't call it "prehepatic" without imaging"],
      "flashcards": [{"tag":"Next Step","question":"Next step?","answer":"TIPS."}],
      "referenceNote": "Standard references."
    }`;
    const result = parse(broken);
    expect(result.examTraps).toEqual([
      'Don\'t call it "prehepatic" without imaging',
    ]);
    expect(result.flashcards).toHaveLength(1);
    expect(result.referenceNote).toBe("Standard references.");
  });
});
