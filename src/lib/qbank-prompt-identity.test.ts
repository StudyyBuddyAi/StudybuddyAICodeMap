import { describe, it, expect } from "vitest";
import step1Baseline from "./__fixtures__/qbank-system-prompt.step1.txt?raw";
import {
  QBANK_SYSTEM_PROMPTS,
  EXAM_MODES,
} from "../../supabase/functions/_shared/qbank-prompt.ts";

/**
 * The Step 1 regression guard.
 *
 * The exam-mode work split one system prompt into per-mode prompts composed
 * from shared fragments. Step 1 is 100% of the traffic that existed before that
 * change, and every quality number quoted in qbank-prompt.ts's comments — the
 * 65-70% difficulty target, the measured block rates, the reasoning-order mix —
 * was measured against the exact bytes in the fixture this compares to.
 *
 * So the composition is required to reproduce those bytes exactly. If it does,
 * any later movement in the metrics is attributable to the new modes rather
 * than to prompt churn, and a Step 1 regression cannot be introduced silently.
 *
 * The fixture was extracted from the pre-refactor module and verified to
 * round-trip. It is the baseline, not an output: regenerating it from the new
 * code would make this test circular and prove nothing.
 */
describe("QBANK_SYSTEM_PROMPTS", () => {
  it("reproduces the pre-refactor Step 1 prompt byte for byte", () => {
    expect(QBANK_SYSTEM_PROMPTS.step1).toBe(step1Baseline);
  });

  it("builds a distinct prompt for every exam mode", () => {
    for (const mode of EXAM_MODES) {
      expect(QBANK_SYSTEM_PROMPTS[mode], `${mode} prompt is missing`).toBeTruthy();
    }
    const rendered = EXAM_MODES.map((m) => QBANK_SYSTEM_PROMPTS[m]);
    expect(new Set(rendered).size).toBe(EXAM_MODES.length);
  });

  /**
   * The reason per-mode prompts were chosen over one prompt carrying both
   * scopes: a Step 1 request must never see the Step 2 permissions, or the
   * drift the prompt exists to prevent is being invited in on every request.
   */
  it("keeps Step 2 CK permissions out of the Step 1 prompt", () => {
    const step1 = QBANK_SYSTEM_PROMPTS.step1;
    expect(step1).toMatch(/Foundational science only/i);
    expect(step1).not.toMatch(/next best step in management/i);
  });

  /** The converse: Step 2 CK must not inherit the foundational-science-only rule. */
  it("does not impose the foundational-science-only rule on Step 2 CK", () => {
    expect(QBANK_SYSTEM_PROMPTS.step2ck).not.toMatch(/Foundational science only/i);
  });
});
