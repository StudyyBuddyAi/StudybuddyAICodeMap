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

  // ── Format drift seen in real model output (provider comparison, Sept 2026) ──
  describe("format drift", () => {
    it("reads a deck that has no FLASHCARDS header and no Q: prefixes (Claude Haiku 4.5)", () => {
      const out = [
        "🩸",
        "",
        "[Mechanism][Grounded] In iron deficiency anemia, what happens to serum iron and TIBC as iron stores become depleted?",
        "A: Serum iron falls while TIBC gradually increases.",
        "",
        "[Diagnosis][Grounded] A 65-year-old male presents with microcytic hypochromic anemia. What distinguishes iron deficiency from thalassemia?",
        "A: Iron deficiency shows low serum iron and a high RDW.",
      ].join("\n");
      const cards = parseFlashcardsFromOutput(out, "Iron deficiency anemia");
      expect(cards).toHaveLength(2);
      expect(cards[0].topicEmoji).toBe("🩸");
      expect(cards[0].tag).toBe("Mechanism");
      expect(cards[0].grounded).toBe(true);
      expect(cards[1].question).toMatch(/^A 65-year-old male/);
    });

    it("reads a headerless deck that keeps its Q: prefixes (Corti S1 mini)", () => {
      const out = "💊\n\nQ: [Mechanism][Grounded] Why does the PR interval lengthen?\nA: The AV node is sensitive to beta blockade.\n";
      const cards = parseFlashcardsFromOutput(out, "Beta blockers");
      expect(cards).toHaveLength(1);
      expect(cards[0].topicEmoji).toBe("💊");
    });

    it("still returns nothing for headerless prose without answer lines", () => {
      expect(parseFlashcardsFromOutput("[Note] Iron deficiency is common.\nSee the sheet.", "Topic")).toEqual([]);
    });

    it("accepts Answer: as an answer line", () => {
      const out = "FLASHCARDS\n\nQ: [Association][Grounded] Why not carvedilol alone in pheochromocytoma?\nAnswer: Unopposed alpha-1 agonism.\n";
      const cards = parseFlashcardsFromOutput(out, "Pharm");
      expect(cards).toHaveLength(1);
      expect(cards[0].answer).toBe("Unopposed alpha-1 agonism.");
    });

    it("drops a per-card TAGS line without losing the cards after it (GPT-OSS 20B)", () => {
      const out = [
        "FLASHCARDS",
        "",
        "Q: [Mechanism][Grounded] How do beta blockers slow the SA node?",
        "A: They lower cAMP and Ca2+ influx.",
        "",
        "TAGS: [Mechanism]",
        "",
        "Q: [Complication][Grounded] Who risks bronchospasm?",
        "A: Patients with asthma or COPD.",
        "",
        "TAGS: [Complication]",
      ].join("\n");
      const cards = parseFlashcardsFromOutput(out, "Pharm");
      expect(cards).toHaveLength(2);
      expect(cards[0].answer).toBe("They lower cAMP and Ca2+ influx.");
      expect(cards[1].answer).toBe("Patients with asthma or COPD.");
    });

    it("keeps an echoed prompt legend out of the last answer", () => {
      const out = [
        "FLASHCARDS",
        "",
        "🩺",
        "",
        "Q: [Next Step][Grounded] Which populations get combination antimicrobial therapy?",
        "A: Only neutropenic sepsis and sepsis caused by Pseudomonas.",
        "",
        "TAGS (pick one per card): [Diagnosis] [Mechanism] [Next Step] [Complication] [Association]",
        "",
        "SOURCING TAG (mandatory, second bracket on every Q: line):",
        "- [Grounded] — if this card's content comes directly from the Context above",
        "",
        "HARD RULES:",
        "- Exactly 10 cards. No more, no less.",
      ].join("\n");
      const cards = parseFlashcardsFromOutput(out, "Sepsis");
      expect(cards).toHaveLength(1);
      expect(cards[0].answer).toBe("Only neutropenic sepsis and sepsis caused by Pseudomonas.");
    });
  });

  // ── Sourcing tag ([Grounded] / [General]) ────────────────────────────────
  // Where the parser meets the prompt. If the prompt's two-bracket format ever
  // drifts, these are the tests that catch it.
  describe("sourcing tag", () => {
    const card = (q: string) =>
      parseFlashcardsFromOutput(`FLASHCARDS

Q: ${q}
A: Ans.
`, "Topic")[0];

    it("splits a clinical tag and a [Grounded] sourcing tag", () => {
      const c = card("[Mechanism][Grounded] Why?");
      expect(c.tag).toBe("Mechanism");
      expect(c.grounded).toBe(true);
      expect(c.question).toBe("Why?");
    });

    it("reads [General] as ungrounded", () => {
      const c = card("[Next Step][General] What next?");
      expect(c.tag).toBe("Next Step");
      expect(c.grounded).toBe(false);
      expect(c.question).toBe("What next?");
    });

    it("accepts the sourcing tag first", () => {
      const c = card("[Grounded][Diagnosis] Which?");
      expect(c.tag).toBe("Diagnosis");
      expect(c.grounded).toBe(true);
      expect(c.question).toBe("Which?");
    });

    it("tolerates whitespace between the brackets", () => {
      const c = card("[Complication] [Grounded] How?");
      expect(c.tag).toBe("Complication");
      expect(c.grounded).toBe(true);
      expect(c.question).toBe("How?");
    });

    it("matches the sourcing tag case-insensitively", () => {
      expect(card("[Mechanism][GROUNDED] Why?").grounded).toBe(true);
      expect(card("[Mechanism][general] Why?").grounded).toBe(false);
    });

    it("defaults to ungrounded when only a clinical tag is present (legacy output)", () => {
      const c = card("[Mechanism] Why?");
      expect(c.tag).toBe("Mechanism");
      expect(c.grounded).toBe(false);
    });

    it("defaults to ungrounded when there is no tag at all", () => {
      const c = card("Why?");
      expect(c.tag).toBe("");
      expect(c.grounded).toBe(false);
      expect(c.question).toBe("Why?");
    });

    it("keeps only the first clinical tag when the model emits extras", () => {
      const c = card("[Mechanism][Diagnosis][Grounded] Why?");
      expect(c.tag).toBe("Mechanism");
      expect(c.grounded).toBe(true);
    });

    it("does not strip a bracket that appears after the question starts", () => {
      const c = card("[Mechanism][Grounded] What does [sic] mean?");
      expect(c.question).toBe("What does [sic] mean?");
    });
  });
});
