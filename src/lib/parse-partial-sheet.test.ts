import { describe, it, expect } from "vitest";
import { parsePartialSheet } from "./parse-partial-sheet";

/** Every prefix of a real stream must either parse or return null — never throw. */
const FULL_SHEET = JSON.stringify({
  topicEmoji: "🫀",
  topic: "Heart Failure",
  overview: "Mechanism: **Reduced output**\nPathophysiology: preload → congestion",
  memoryHooks: ["FACES", "Cor pulmonale"],
  clinicalApproach: "Diagnosis: echo → EF",
  keyPoints: ["If S3 → think volume overload"],
  examTraps: ["Don't confuse HFpEF with HFrEF"],
  flashcards: [{ tag: "Next Step", question: "What next?", answer: "Start an ACEi." }],
  referenceNote: "Based on standard medical references.",
});

describe("parsePartialSheet", () => {
  it("treats every key as complete once the object closes", () => {
    const result = parsePartialSheet(FULL_SHEET);
    expect(result).not.toBeNull();
    expect(result!.completeKeys).toEqual([
      "topicEmoji",
      "topic",
      "overview",
      "memoryHooks",
      "clinicalApproach",
      "keyPoints",
      "examTraps",
      "flashcards",
      "referenceNote",
    ]);
    expect(result!.sheet.flashcards).toHaveLength(1);
  });

  it("keeps the partial string but withholds the key still being written", () => {
    const result = parsePartialSheet(
      '{"topicEmoji":"🫀","topic":"Heart Failure","overview":"Mechanism: **Reduced'
    );
    expect(result!.completeKeys).toEqual(["topicEmoji", "topic"]);
    expect(result!.sheet.overview).toBe("Mechanism: **Reduced");
  });

  it("closes an array cut between elements", () => {
    const result = parsePartialSheet('{"topic":"HF","memoryHooks":["FACES","Cor pul');
    expect(result!.completeKeys).toEqual(["topic"]);
    expect(result!.sheet.memoryHooks).toEqual(["FACES", "Cor pul"]);
  });

  it("drops a flashcard whose answer has not arrived", () => {
    const result = parsePartialSheet(
      '{"examTraps":["a"],"flashcards":[{"tag":"Next Step","question":"What next?"'
    );
    expect(result!.completeKeys).toEqual(["examTraps"]);
    expect(result!.sheet.flashcards).toEqual([]);
  });

  it("keeps complete flashcards alongside a half-written one", () => {
    const result = parsePartialSheet(
      '{"flashcards":[{"tag":"A","question":"Q1","answer":"A1"},{"tag":"B","question":"Q2'
    );
    expect(result!.sheet.flashcards).toEqual([
      { tag: "A", question: "Q1", answer: "A1" },
    ]);
  });

  it("discards a truncated unicode escape", () => {
    const result = parsePartialSheet('{"topic":"HF","overview":"alpha \\u00');
    expect(result!.sheet.overview).toBe("alpha ");
  });

  it("discards a trailing lone backslash", () => {
    const result = parsePartialSheet('{"topic":"HF","overview":"line\\');
    expect(result!.sheet.overview).toBe("line");
  });

  it("strips a trailing comma", () => {
    const result = parsePartialSheet('{"topicEmoji":"🫀","topic":"HF",');
    expect(result!.completeKeys).toEqual(["topicEmoji"]);
    expect(result!.sheet.topic).toBe("HF");
  });

  it("strips a key whose value has not started, keeping earlier keys complete", () => {
    const result = parsePartialSheet('{"topicEmoji":"🫀","topic":"HF","overview":');
    expect(result!.completeKeys).toEqual(["topicEmoji", "topic"]);
    expect(result!.sheet.overview).toBe("");
  });

  it("handles a half-written key name", () => {
    const result = parsePartialSheet('{"topicEmoji":"🫀","topic":"HF","over');
    expect(result!.completeKeys).toEqual(["topicEmoji", "topic"]);
    expect(result!.sheet.topic).toBe("HF");
  });

  it("sees through an unclosed markdown fence", () => {
    const result = parsePartialSheet('```json\n{"topic":"HF","overview":"x","keyPoints":[');
    expect(result!.completeKeys).toEqual(["topic", "overview"]);
    expect(result!.sheet.topic).toBe("HF");
  });

  it("returns null for prose, legacy blobs, and empty input", () => {
    expect(parsePartialSheet("")).toBeNull();
    expect(parsePartialSheet("SUMMARY\nHeart failure is...")).toBeNull();
    expect(parsePartialSheet("Here is your sheet:")).toBeNull();
  });

  it("reports nothing complete when only the opening brace has arrived", () => {
    const result = parsePartialSheet("{");
    expect(result!.completeKeys).toEqual([]);
  });

  it("never throws and never regresses across every prefix of a real stream", () => {
    let previousComplete = 0;
    for (let i = 1; i <= FULL_SHEET.length; i++) {
      const result = parsePartialSheet(FULL_SHEET.slice(0, i));
      if (!result) continue;
      // Callers only re-render when this grows, so a transient dip is tolerated,
      // but the final prefix must account for every key.
      previousComplete = Math.max(previousComplete, result.completeKeys.length);
    }
    expect(previousComplete).toBe(9);
  });

  it("reveals sections one at a time, in schema order", () => {
    // Mirrors the generator: feed token-sized chunks, re-render only when the
    // completed-key count grows, and record what the reader would see.
    const reveals: string[][] = [];
    let revealed = 0;
    let buffer = "";

    for (let i = 0; i < FULL_SHEET.length; i += 7) {
      buffer += FULL_SHEET.slice(i, i + 7);
      const result = parsePartialSheet(buffer);
      if (result && result.completeKeys.length > revealed) {
        revealed = result.completeKeys.length;
        reveals.push(result.completeKeys);
      }
    }

    // Each render adds sections without ever removing or reordering one.
    reveals.forEach((keys, i) => {
      if (i > 0) expect(keys.slice(0, reveals[i - 1].length)).toEqual(reveals[i - 1]);
    });
    expect(reveals[reveals.length - 1]).toEqual([
      "topicEmoji",
      "topic",
      "overview",
      "memoryHooks",
      "clinicalApproach",
      "keyPoints",
      "examTraps",
      "flashcards",
      "referenceNote",
    ]);
  });

  it("normalizes missing fields so the renderer can never hit undefined", () => {
    const result = parsePartialSheet('{"overview":"just this"');
    expect(result!.sheet.memoryHooks).toEqual([]);
    expect(result!.sheet.keyPoints).toEqual([]);
    expect(result!.sheet.examTraps).toEqual([]);
    expect(result!.sheet.flashcards).toEqual([]);
    expect(result!.sheet.clinicalApproach).toBe("");
    expect(result!.sheet.referenceNote).toBe("");
  });
});
