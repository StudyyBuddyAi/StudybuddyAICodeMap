import { describe, it, expect } from "vitest";
import { explainUserContent, parseExplainReply, type ExplainableQuestion } from "../../supabase/functions/_shared/qbank-explain.ts";

const question: ExplainableQuestion = {
  question_text: "A 58-year-old woman with recurrent calcium stones starts a new drug.\n\nWhich mechanism lowers her stone risk?",
  option_a: "NKCC2 inhibition",
  option_b: "NCC inhibition",
  option_c: "Aldosterone receptor blockade",
  option_d: "Carbonic anhydrase inhibition",
  option_e: "ENaC blockade",
  correct_option: "b",
  explanation: "**Thiazides** inhibit NCC.",
  teaching_point: "Thiazides lower urine calcium.",
  distractor_explanations: { a: "Loops raise urine calcium.", b: "never shown" },
  subject: "Renal & Urinary",
  topic: "Thiazide hypocalciuria",
};

const reply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    agrees: true,
    disagreement: "",
    bottomLine: "Thiazides cause hypocalciuria.",
    explanation: ["Para one.", "Para two."],
    options: { a: "Loops waste calcium.", b: "Correct: NCC.", c: "", d: "Alkaline urine.", e: "Minor effect." },
    table: { title: "Diuretics and calcium", columns: ["Class", "Site", "Urine Ca"], rows: [["Loop", "TAL", "↑"], ["Thiazide", "DCT", "↓"], ["Bad row"]] },
    algorithm: { title: "Stone workup", steps: [{ text: "Stone confirmed", yes: "Go on", no: "" }, { text: "Hypercalciuria?", yes: "Thiazide", no: "Check citrate" }, { text: "Treat cause" }] },
    highYield: ["Thiazides: hypocalciuria."],
    ...over,
  });

describe("explainUserContent", () => {
  it("gives the writer the question, the key and what is already shown", () => {
    const content = explainUserContent(question);
    expect(content).toContain("Which mechanism lowers her stone risk?");
    expect(content).toContain("B. NCC inhibition");
    expect(content).toContain("Keyed answer: B");
    expect(content).toContain("A: Loops raise urine calcium.");
    expect(content).not.toContain("never shown");
  });
});

describe("parseExplainReply", () => {
  it("keeps a well-formed explanation, its table and its algorithm", () => {
    const r = parseExplainReply(reply());
    expect(r?.kind).toBe("explained");
    if (r?.kind !== "explained") return;
    expect(r.explanation.bottomLine).toBe("Thiazides cause hypocalciuria.");
    expect(r.explanation.options).toEqual({ a: "Loops waste calcium.", b: "Correct: NCC.", d: "Alkaline urine.", e: "Minor effect." });
    // The row that doesn't fit the header is dropped.
    expect(r.explanation.table?.rows).toEqual([["Loop", "TAL", "↑"], ["Thiazide", "DCT", "↓"]]);
    expect(r.explanation.algorithm?.steps[1]).toEqual({ text: "Hypercalciuria?", yes: "Thiazide", no: "Check citrate" });
    expect(r.explanation.algorithm?.steps[0]).toEqual({ text: "Stone confirmed" });
  });

  it("drops a table or an algorithm too small to teach anything", () => {
    const r = parseExplainReply(
      reply({ table: { title: "x", columns: ["A", "B"], rows: [["1", "2"]] }, algorithm: { title: "x", steps: [{ text: "one" }] } })
    );
    expect(r?.kind === "explained" && r.explanation.table).toBeNull();
    expect(r?.kind === "explained" && r.explanation.algorithm).toBeNull();
  });

  it("holds an explanation back when the writer doubts the key", () => {
    expect(parseExplainReply(JSON.stringify({ agrees: false, disagreement: "B is wrong; it is A." }))).toEqual({
      kind: "disputed",
      reason: "B is wrong; it is A.",
    });
  });

  it("repairs a fenced reply and refuses an empty one", () => {
    expect(parseExplainReply("```json\n" + reply() + "\n```")?.kind).toBe("explained");
    expect(parseExplainReply(reply({ bottomLine: "", explanation: [] }))).toBeNull();
    expect(parseExplainReply("no json here")).toBeNull();
  });
});
