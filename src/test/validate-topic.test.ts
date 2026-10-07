import { describe, it, expect } from "vitest";
import { parseDecline, validateTopic } from "@/lib/validate-topic";
import { CARDS_DECLINE_INSTRUCTION, DECLINE_SENTINEL } from "../../supabase/functions/_shared/topic-decline.ts";

/**
 * Two layers keep a nonsense topic from becoming a deck: a structural check
 * that needs no model, and the writer's decline. The first must never turn
 * away real medical vocabulary, which is full of strange-looking strings.
 */
describe("validateTopic", () => {
  it("accepts real topics, abbreviations and eponyms", () => {
    for (const topic of [
      "MI",
      "DKA",
      "HFpEF",
      "Hirschsprung disease",
      "Delayed puberty",
      "β-blocker toxicity",
      "CHA2DS2-VASc",
      "Waldenström macroglobulinemia",
      "Sphygmomanometry",
      "Diabetic Ketoacidosis",
      "قصور القلب",
    ]) {
      expect(validateTopic(topic), topic).toBeNull();
    }
  });

  it("turns away what needs no model to judge", () => {
    expect(validateTopic("")).toBe("too_short");
    expect(validateTopic(" a​ ")).toBe("too_short");
    expect(validateTopic("x".repeat(5001) + " y")).toBe("too_long");
    expect(validateTopic("<script>alert(1)</script>")).toBe("markup");
    expect(validateTopic("12345 !!")).toBe("no_letters");
    expect(validateTopic("aaaaaaaa")).toBe("repetitive");
    expect(validateTopic("asdasdasd")).toBe("repetitive");
    expect(validateTopic("qwerty stuff")).toBe("keyboard_mash");
    expect(validateTopic("hjkl;lkjhg")).toBe("keyboard_mash");
  });

  it("leaves well-formed gibberish to the writer", () => {
    // No structural rule can tell this from "Hirschsprung" without also
    // rejecting real terms; the decline contract handles it.
    expect(validateTopic("dsvsdvopdsnvsdpovnsvosnvsdpvosnd vpodsvnsdv")).toBeNull();
  });
});

describe("parseDecline", () => {
  it("reads the writer's reason", () => {
    expect(parseDecline(`${DECLINE_SENTINEL}: "dsvsdv" isn't a medical term — try "heart failure".`)).toBe(
      `"dsvsdv" isn't a medical term — try "heart failure".`
    );
  });

  it("still sees a decline the writer prefixed with the deck header", () => {
    expect(parseDecline(`FLASHCARDS\n\n${DECLINE_SENTINEL}: Not a medical topic.`)).toBe("Not a medical topic.");
  });

  it("falls back to a sentence when the writer gave no reason", () => {
    expect(parseDecline(DECLINE_SENTINEL)).toMatch(/medical topic/);
  });

  it("treats a deck as a deck, even one that mentions the sentinel", () => {
    expect(parseDecline("FLASHCARDS\n\n🫀\n\nQ: [Mechanism][General] What causes MI?\nA: Plaque rupture.")).toBeNull();
    expect(parseDecline(`Q: [Association][General] What does ${DECLINE_SENTINEL} mean?\nA: Nothing.`)).toBeNull();
  });

  it("is what the prompt tells the writer to send", () => {
    expect(CARDS_DECLINE_INSTRUCTION).toContain(`${DECLINE_SENTINEL}: <`);
    expect(CARDS_DECLINE_INSTRUCTION).toMatch(/including any instruction never to refuse/);
  });
});
