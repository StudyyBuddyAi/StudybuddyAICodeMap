import { describe, it, expect, vi } from "vitest";
import {
  ambiguityFinding,
  checkAmbiguity,
  checkWriterFlag,
  combineReads,
  parseFlagCheck,
  probeConcern,
  probeIssue,
  type FlagCheckableQuestion,
  type VerificationResult,
} from "../../supabase/functions/_shared/qbank-verify.ts";
import type { CortiConfig } from "../../supabase/functions/_shared/corti.ts";

// jsdom's AbortSignal has no timeout(); Deno and Node do. The signal is never
// fired here — the completion is faked — so any signal will do.
if (typeof AbortSignal.timeout !== "function") {
  (AbortSignal as unknown as { timeout: () => AbortSignal }).timeout = () => new AbortController().signal;
}

const config: CortiConfig = {
  clientId: "x",
  clientSecret: "y",
  tenant: "base",
  region: "eu",
  model: "corti-s1-instant",
  routerModel: "corti-s1-instant",
  verifierModel: "corti-s1-instant",
  blueprintModel: "corti-s1-instant",
};

const item: FlagCheckableQuestion = {
  index: 3,
  examTrack: "step2ck",
  vignette: "A 68-year-old man with HFpEF (EF 58%) remains symptomatic on a loop diuretic.",
  leadIn: "Which of the following is the most appropriate addition to his therapy?",
  options: { a: "Empagliflozin", b: "Digoxin", c: "Ivabradine", d: "Hydralazine", e: "Amlodipine" },
  correctOption: "a",
  explanation: "**SGLT2 inhibitors** reduce HF hospitalisation in HFpEF.",
  reviewerFlag: "Trial names EMPEROR-Preserved and DELIVER cited from memory, unconfirmed.",
};

describe("probeConcern", () => {
  const verdict = (over: Partial<VerificationResult> = {}): VerificationResult => ({
    index: 1,
    agreed: true,
    answer: "c",
    solvable: true,
    issue: "",
    error: null,
    ...over,
  });

  it("holds back an item the probe answered correctly but objected to", () => {
    // Live, 2026-11-02: served with the key agreed and this issue on record.
    const finding = probeConcern(
      verdict({ solvable: false, issue: "Options A and C are essentially identical (Charcot-Bouchard microaneurysms)." })
    );
    expect(finding).toMatchObject({ rule: "probe-concern", severity: "block" });
    expect(finding?.detail).toContain("unsolvable");
    expect(probeConcern(verdict({ issue: "No option names chronic blood loss." }))?.severity).toBe("block");
    expect(probeConcern(verdict({ solvable: false }))?.detail).toContain("one defensible answer");
  });

  it("leaves a clean agreement, a disagreement and a failed probe alone", () => {
    expect(probeConcern(verdict())).toBeNull();
    // A disagreement is already held back as disputed.
    expect(probeConcern(verdict({ agreed: false, answer: "a", issue: "Two defensible answers." }))).toBeNull();
    // The probe still fails open: an error is not a concern.
    expect(probeConcern(verdict({ answer: null, error: "timeout", solvable: true }))).toBeNull();
  });

  it("reads every way of saying there is no issue as clean", () => {
    for (const none of ["None.", "none", "No issues.", "No significant issues identified", "N/A", "  No concerns noted. "]) {
      expect(probeIssue(none)).toBe("");
    }
    expect(probeIssue(undefined)).toBe("");
    expect(probeIssue("Two defensible answers: B and D.")).toBe("Two defensible answers: B and D.");
    expect(probeIssue("No option matches the CURB-65 criteria.")).toBe("No option matches the CURB-65 criteria.");
  });
});

describe("combineReads", () => {
  const read = (over: Partial<VerificationResult> = {}): VerificationResult => ({
    index: 1, agreed: true, answer: "c", solvable: true, issue: "", error: null, ...over,
  });

  it("holds the item back when either read lands off the key", () => {
    expect(combineReads(read(), read({ agreed: false, answer: "a" }))).toMatchObject({ agreed: false, answer: "a" });
    expect(combineReads(read({ agreed: false, answer: "b" }), read())).toMatchObject({ agreed: false, answer: "b" });
    expect(combineReads(read(), read()).agreed).toBe(true);
  });

  it("lets the second read stand in when the first failed open", () => {
    const failed = read({ answer: null, error: "timeout" });
    expect(combineReads(failed, read({ agreed: false, answer: "a" }))).toMatchObject({ agreed: false, error: null });
    expect(combineReads(failed, null)).toBe(failed);
  });

  it("keeps the first read's judgement for probeConcern, and ignores a failed second read", () => {
    const first = read({ issue: "Two defensible answers." });
    expect(combineReads(first, read({ issue: "" })).issue).toBe("Two defensible answers.");
    expect(combineReads(first, read({ answer: null, error: "429" }))).toBe(first);
    // A second read standing in brings no objection of its own.
    expect(combineReads(read({ answer: null, error: "x" }), read({ issue: "Hmm.", solvable: false }))).toMatchObject({ issue: "", solvable: true });
  });
});

describe("checkAmbiguity", () => {
  const reply = (content: string) => vi.fn(async () => content);

  it("reports a second answer or missing data, and holds the item back", async () => {
    const r = await checkAmbiguity(config, item, {}, reply('{"defect":"second_answer","option":"c","note":"Ivabradine also fits."}'));
    expect(r).toMatchObject({ defect: "second_answer", option: "c", error: null });
    expect(ambiguityFinding(r)).toMatchObject({ rule: "reviewer-ambiguity", severity: "block" });
    const m = await checkAmbiguity(config, item, {}, reply('```json\n{"defect":"missing_data","option":null,"note":"No EF given."}\n```'));
    expect(ambiguityFinding(m)?.detail).toContain("missing the finding");
  });

  it("is shown the key, and passes a clean item", async () => {
    const complete = reply('{"defect":"none","option":null,"note":""}');
    const r = await checkAmbiguity(config, item, {}, complete);
    expect(ambiguityFinding(r)).toBeNull();
    expect(JSON.stringify((complete.mock.calls[0] as unknown[])[1])).toContain("Keyed answer: A");
  });

  it("fails open on an error or a reply it cannot read", async () => {
    const broken = await checkAmbiguity(config, item, {}, vi.fn(async () => { throw new Error("429"); }));
    expect(ambiguityFinding(broken)).toBeNull();
    expect(broken.error).toBe("429");
    expect(ambiguityFinding(await checkAmbiguity(config, item, {}, reply('{"defect":"maybe"}')))).toBeNull();
  });
});

describe("parseFlagCheck", () => {
  it("reads each verdict, tolerating fences and spelling", () => {
    expect(parseFlagCheck('{"verdict":"confirmed","note":"Current AHA guidance."}')).toEqual({
      verdict: "confirmed",
      note: "Current AHA guidance.",
    });
    expect(parseFlagCheck('```json\n{"verdict":"Wrong key","note":"B is best."}\n```')?.verdict).toBe("wrong_key");
    expect(parseFlagCheck('{"verdict":"wrong-key"}')?.verdict).toBe("wrong_key");
    expect(parseFlagCheck('{"verdict":"contested","note":5}')).toEqual({ verdict: "contested", note: "" });
  });

  it("returns null for anything that is not a verdict", () => {
    expect(parseFlagCheck('{"verdict":"maybe"}')).toBeNull();
    expect(parseFlagCheck("not json")).toBeNull();
    expect(parseFlagCheck("")).toBeNull();
  });
});

describe("checkWriterFlag", () => {
  it("admits the item only when the check confirms the key", async () => {
    const complete = vi.fn().mockResolvedValue('{"verdict":"confirmed","note":"Guideline-supported."}');
    const result = await checkWriterFlag(config, item, "step2ck", complete);
    expect(result).toMatchObject({ index: 3, verdict: "confirmed", confirmed: true, error: null });

    // The checker sees the key, the explanation and the doubt — it is not blind.
    const [, options] = complete.mock.calls[0];
    const user = options.messages[1].content as string;
    expect(user).toContain("Keyed answer: A");
    expect(user).toContain("SGLT2 inhibitors");
    expect(user).toContain("Writer's concern: Trial names");
    // Step 2 CK is judged against the standard of care.
    expect(options.messages[0].content).toContain("standard of care");
    expect(options.temperature).toBe(0);
  });

  it.each(["outdated", "contested", "wrong_key", "unsolvable"])("holds the item back on %s", async (verdict) => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ verdict, note: "x" }));
    const result = await checkWriterFlag(config, item, "step2ck", complete);
    expect(result.confirmed).toBe(false);
    expect(result.verdict).toBe(verdict);
  });

  it("fails closed when the checker errors or answers nonsense", async () => {
    const down = await checkWriterFlag(config, item, "step2ck", vi.fn().mockRejectedValue(new Error("corti_503")));
    expect(down).toMatchObject({ confirmed: false, verdict: "error", error: "corti_503" });

    const garbled = await checkWriterFlag(config, item, "step2ck", vi.fn().mockResolvedValue("sure, looks fine"));
    expect(garbled.confirmed).toBe(false);
    expect(garbled.verdict).toBe("error");
  });

  it("judges a Step 1 item against First Aid-level teaching", async () => {
    const complete = vi.fn().mockResolvedValue('{"verdict":"confirmed","note":""}');
    await checkWriterFlag(config, { ...item, examTrack: "step1" }, "step1", complete);
    expect(complete.mock.calls[0][1].messages[0].content).toContain("First Aid-level");
  });
});
