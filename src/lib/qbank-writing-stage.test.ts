import { describe, it, expect } from "vitest";
import { firstItemStage, stageIndex, WRITING_STAGES } from "./qbank-writing-stage";

describe("firstItemStage", () => {
  const head = '{"batchPlan":{"system":"renal"},"questions":[{"index":1,"system":"Renal","reasoningChain":"';

  it("follows the first question's fields as they stream", () => {
    expect(firstItemStage('{"batchPlan":{"sys', 0)).toBe("planning");
    expect(firstItemStage(head, 0)).toBe("reasoning");
    expect(firstItemStage(`${head}x","vignette":"A 54-year-old`, 0)).toBe("case");
    expect(firstItemStage(`${head}x","vignette":"v","leadIn":"Which`, 0)).toBe("question");
    expect(firstItemStage(`${head}x","vignette":"v","leadIn":"q","options":{"a":"`, 0)).toBe("question");
    expect(firstItemStage(`${head}x","vignette":"v","leadIn":"q","options":{},"correctOption":"b","explanation":"**`, 0)).toBe("explanation");
    expect(firstItemStage(head, 1)).toBe("checking");
  });

  it("is not fooled by a key name inside the plan", () => {
    expect(firstItemStage('{"batchPlan":{"note":"explanation"},"questions":[{"index":1,', 0)).toBe("reasoning");
  });

  it("orders the stages for the progress bar", () => {
    expect(WRITING_STAGES.map((s) => s.id)).toEqual(["routing", "planning", "reasoning", "case", "question", "explanation", "checking"]);
    expect(stageIndex("case")).toBe(3);
  });
});
