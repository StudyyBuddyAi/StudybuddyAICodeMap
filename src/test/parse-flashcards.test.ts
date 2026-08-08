import { describe, it, expect } from "vitest";
import { parseFlashcardsFromOutput } from "@/lib/parse-flashcards";

describe("parseFlashcardsFromOutput", () => {
  it("returns an empty array when there is no FLASHCARDS section", () => {
    expect(parseFlashcardsFromOutput("Just some notes.", "Topic")).toEqual([]);
  });

  it("parses a single well-formed card", () => {
    const out = ["FLASHCARDS", "", "Q: What is the primary pacemaker of the heart?", "A: The SA node.", ""].join("\n");
    const cards = parseFlashcardsFromOutput(out, "Cardiovascular");
    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe("What is the primary pacemaker of the heart?");
    expect(cards[0].answer).toBe("The SA node.");
    expect(cards[0].topic).toBe("Cardiovascular");
  });

  it("parses multiple cards", () => {
    const out = [
      "FLASHCARDS",
      "",
      "Q: Q1?",
      "A: A1.",
      "",
      "Q: Q2?",
      "A: A2.",
    ].join("\n");
    const cards = parseFlashcardsFromOutput(out, "Topic");
    expect(cards).toHaveLength(2);
    expect(cards[1].question).toBe("Q2?");
    expect(cards[1].answer).toBe("A2.");
  });

  it("stops parsing at a REFERENCE NOTE section", () => {
    const out = [
      "FLASHCARDS",
      "",
      "Q: Q1?",
      "A: A1.",
      "",
      "REFERENCE NOTE: see UWorld",
      "Q: Q2?",
      "A: A2.",
    ].join("\n");
    const cards = parseFlashcardsFromOutput(out, "Topic");
    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe("Q1?");
  });

  it("extracts a leading [Tag] from the question", () => {
    const out = ["FLASHCARDS", "", "Q: [Physiology] What is EF?", "A: Ejection fraction.", ""].join("\n");
    const cards = parseFlashcardsFromOutput(out, "Cardio");
    expect(cards).toHaveLength(1);
    expect(cards[0].tag).toBe("Physiology");
    expect(cards[0].question).toBe("What is EF?");
  });

  it("captures a leading emoji line as the topic emoji", () => {
    const out = ["FLASHCARDS", "", "🫀", "Q: What is EF?", "A: Ejection fraction.", ""].join("\n");
    const cards = parseFlashcardsFromOutput(out, "Cardio");
    expect(cards).toHaveLength(1);
    expect(cards[0].topicEmoji).toBe("🫀");
  });

  it("skips cards where a stray line-start Q: drifts into the question", () => {
    const out = [
      "FLASHCARDS",
      "",
      "Q: What is the drug of choice?",
      "Q: for digoxin toxicity",
      "A: Fab fragments.",
      "",
      "Q: Clean?",
      "A: Yes.",
    ].join("\n");
    const cards = parseFlashcardsFromOutput(out, "Pharm");
    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe("Clean?");
  });

  it("preserves same-line inline Q:/A: text inside an answer", () => {
    const out = ["FLASHCARDS", "", "Q: What drug?", "A: Digoxin. Q: What is the antidote? A: Fab fragments.", ""].join("\n");
    const cards = parseFlashcardsFromOutput(out, "Pharm");
    expect(cards).toHaveLength(1);
    expect(cards[0].answer).toBe("Digoxin. Q: What is the antidote? A: Fab fragments.");
  });

  it("skips cards that are too long (likely two cards merged)", () => {
    const long = "x".repeat(900);
    const out = ["FLASHCARDS", "", `Q: ${long}`, "A: Too long.", ""].join("\n");
    expect(parseFlashcardsFromOutput(out, "Topic")).toEqual([]);
  });

  it("truncates the topic to 60 characters", () => {
    const topic = "A".repeat(80);
    const out = ["FLASHCARDS", "", "Q: Q?", "A: A.", ""].join("\n");
    const cards = parseFlashcardsFromOutput(out, topic);
    expect(cards[0].topic).toHaveLength(60);
  });

  it("ignores empty questions and answers", () => {
    const out = ["FLASHCARDS", "", "Q:", "A: Nothing.", "", "Q: Real?", "A:", ""].join("\n");
    expect(parseFlashcardsFromOutput(out, "Topic")).toEqual([]);
  });
});
