import { describe, it, expect } from "vitest";
import { EXAM_BLOCK, FREE_DAILY_QBANK_QUESTIONS } from "../../supabase/functions/_shared/qbank-limits.ts";

describe("QBank limits", () => {
  it("offers every account the full 20-question, 30-minute USMLE block", () => {
    expect(EXAM_BLOCK).toEqual({ size: 20, minutes: 30 });
  });

  it("keeps the old daily cap for anonymous guests only", () => {
    expect(FREE_DAILY_QBANK_QUESTIONS).toBe(10);
  });
});
