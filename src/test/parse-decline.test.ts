import { describe, it, expect } from "vitest";
import { parseDecline, DECLINE_SENTINEL } from "@/lib/parse-partial-sheet";

describe("parseDecline", () => {
  it("matches the sentinel and returns the reason", () => {
    expect(parseDecline(`${DECLINE_SENTINEL}: That's not a medical topic.`)).toBe(
      "That's not a medical topic."
    );
  });

  it("matches with leading whitespace before the sentinel", () => {
    expect(parseDecline(`   \n${DECLINE_SENTINEL}: Off-topic request.`)).toBe(
      "Off-topic request."
    );
  });

  it("matches through a markdown code fence, like a normal sheet response", () => {
    expect(parseDecline(`\`\`\`\n${DECLINE_SENTINEL}: Not medical.\n\`\`\``)).toBe(
      "Not medical."
    );
  });

  it("falls back to a default message when the model omits the reason", () => {
    expect(parseDecline(DECLINE_SENTINEL)).toBe(
      "That doesn't look like a medical topic."
    );
  });

  it("returns null for a normal JSON sheet", () => {
    const sheet = JSON.stringify({ topic: "Heart Failure", overview: "..." });
    expect(parseDecline(sheet)).toBeNull();
  });

  it("returns null for normal FLASHCARDS text output", () => {
    const cards = "FLASHCARDS\n\nQ: [Mechanism][General] What is X?\nA: Y.\n";
    expect(parseDecline(cards)).toBeNull();
  });

  it("returns null when the sentinel merely appears inside a field rather than leading the response", () => {
    const sheet = JSON.stringify({
      topic: "Heart Failure",
      overview: `A sheet that happens to mention ${DECLINE_SENTINEL} in passing.`,
    });
    expect(parseDecline(sheet)).toBeNull();
  });

  it("returns null for an empty response", () => {
    expect(parseDecline("")).toBeNull();
  });
});
