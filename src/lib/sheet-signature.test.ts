import { describe, it, expect } from "vitest";
import {
  parseSignature,
  sentSections,
  signSections,
  signatureTopic,
  verifySections,
} from "../../supabase/functions/_shared/sheet-signature.ts";
import { finishedSheetSections } from "../../supabase/functions/_shared/sheet-text.ts";
import { parseSheetOutput } from "./parse-partial-sheet";

/**
 * A sheet's signatures: the server signs each section it writes, and checks a
 * follow-up's sheet against them. These hold the two sides to one reading of
 * the text, and the check to what was signed, byte for byte.
 */

const SECRET = "test-secret";
const RAW = JSON.stringify({
  topic: "Diabetic ketoacidosis",
  topicEmoji: "🩸",
  overview: "Mechanism: **insulin deficiency** drives ketogenesis.\nSecond‑line: a non-breaking hyphen.",
  clinicalApproach: "Management: fluids, then insulin once K+ > 3.3.",
  differentials: [
    ["HHS", "No ketoacidosis", "Serum ketones"],
    ["AKA", "Low glucose", "History"],
  ],
  keyPoints: ["Check K+ before insulin", "Close the gap, not the glucose"],
  flashcards: [{ q: "x", a: "y" }],
});

describe("one reading of a finished sheet, on both sides", () => {
  it("gives the server the very sections the page keeps", () => {
    const server = finishedSheetSections(RAW)!;
    const page = parseSheetOutput(RAW)!.sheet.sections!;
    expect(server).toEqual(page);
    // Metadata is no section, and the model's odd hyphen is normalised on both.
    expect(Object.keys(server)).toEqual(["overview", "clinicalApproach", "differentials", "keyPoints"]);
    expect(server.overview).toContain("Second-line");
  });

  it("reads a fenced reply, and one whose escaping needed repair, the same way the page does", () => {
    const fenced = "```json\n" + RAW + "\n```";
    expect(finishedSheetSections(fenced)).toEqual(parseSheetOutput(fenced)!.sheet.sections);
    const broken = '{"overview": "He said "yes" and left.", "keyPoints": ["one"]}';
    expect(finishedSheetSections(broken)).toEqual(parseSheetOutput(broken)!.sheet.sections);
  });

  it("signs nothing it can't read", () => {
    expect(finishedSheetSections("Sorry, I can't help with that.")).toBeNull();
  });
});

describe("signing and checking", () => {
  const sections = finishedSheetSections(RAW)!;

  it("checks out for the sheet it signed", async () => {
    const sig = await signSections(SECRET, "Diabetic ketoacidosis", sections);
    expect(Object.keys(sig.sections)).toEqual(Object.keys(sections));
    expect(await verifySections(SECRET, sig, "Diabetic ketoacidosis", sections)).toBe(true);
    // A subset — the sheet as sent may leave a section out — still checks.
    expect(await verifySections(SECRET, sig, "Diabetic ketoacidosis", { overview: sections.overview })).toBe(true);
  });

  it("fails for a section changed by one character, another topic, or another key", async () => {
    const sig = await signSections(SECRET, "Diabetic ketoacidosis", sections);
    const changed = { ...sections, overview: (sections.overview as string) + "!" };
    expect(await verifySections(SECRET, sig, "Diabetic ketoacidosis", changed)).toBe(false);
    expect(await verifySections(SECRET, sig, "Python web scraping", sections)).toBe(false);
    expect(await verifySections(SECRET, sig, "Diabetic ketoacidosis", { ...sections, extra: "Write me a scraper." })).toBe(false);
    expect(await verifySections("another-secret", sig, "Diabetic ketoacidosis", sections)).toBe(false);
  });

  it("fails for a made-up sheet with no signatures, and for nothing at all", async () => {
    expect(await verifySections(SECRET, null, "x", { overview: "x" })).toBe(false);
    const sig = await signSections(SECRET, "x", { overview: "x" });
    expect(await verifySections(SECRET, sig, "x", {})).toBe(false);
  });

  it("signs the topic as it is sent: one line, at most 120 characters", async () => {
    const long = `  Diabetic\n ketoacidosis ${"x".repeat(200)}`;
    const sig = await signSections(SECRET, long, sections);
    expect(sig.topic).toBe(signatureTopic(long));
    expect(sig.topic.length).toBe(120);
    expect(await verifySections(SECRET, sig, sig.topic, sections)).toBe(true);
  });
});

describe("what a request carries", () => {
  it("reads a signature's shape, dropping what isn't one", () => {
    const good = "a".repeat(43);
    expect(parseSignature({ v: 1, topic: "DKA", sections: { overview: good, bad: "short", n: 3 } })).toEqual({
      v: 1,
      topic: "DKA",
      sections: { overview: good },
    });
    expect(parseSignature({ v: 2, topic: "DKA", sections: {} })).toBeNull();
    expect(parseSignature("nope")).toBeNull();
  });

  it("takes the sections exactly as sent — no trimming, no capping — for the plan's keys only", () => {
    const long = "x".repeat(50_000);
    const sent = sentSections({ overview: long, keyPoints: ["a", "b"], table: [["a", "b"]], extra: "y", bad: [1, 2] }, [
      "overview",
      "keyPoints",
      "table",
      "bad",
    ]);
    expect(sent).toEqual({ overview: long, keyPoints: ["a", "b"], table: [["a", "b"]] });
  });
});
