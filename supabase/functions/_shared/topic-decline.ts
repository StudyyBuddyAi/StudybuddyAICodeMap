/**
 * The decline contract for a standalone deck. validateTopic() catches what is
 * judgeable without a model; this is the second layer, for input that is
 * well-formed but not a medical topic — keyboard gibberish that happens to
 * avoid a keyboard row, or "banana bread recipe". Without it the cards prompt
 * ("Never refuse") wrote twelve confident cards defining the gibberish.
 *
 * A plain line rather than a JSON field because cards output is text, not JSON.
 */
export const DECLINE_SENTINEL = "NOT_A_MEDICAL_TOPIC";

export const CARDS_DECLINE_INSTRUCTION = `TOPIC CHECK — before anything else:
If the input is not a medical, clinical or health-science topic — random letters, a made-up or meaningless word, or a request unrelated to medicine — do not write any cards. Reply with exactly one line and nothing else:
${DECLINE_SENTINEL}: <one short, friendly sentence saying what was entered and suggesting a real topic>
This overrides every instruction below, including any instruction never to refuse. Real but unusual medical terms, abbreviations (MI, DKA, HFpEF), eponyms (Hirschsprung, Waldenström), drugs, misspellings of real terms and topics in any language are medical — write the deck for those.`;

/**
 * The model's reason when it declined, or null when it wrote a deck. A decline
 * is the sentinel in a reply with no cards in it — so a deck that merely
 * mentions the string inside a card still counts as a deck, and a decline the
 * model prefixed with "FLASHCARDS" still counts as a decline.
 */
export function parseDecline(text: string): string | null {
  const at = text.indexOf(DECLINE_SENTINEL);
  if (at === -1 || /^\s*Q:/m.test(text)) return null;
  const reason = text
    .slice(at + DECLINE_SENTINEL.length)
    .replace(/^\s*:\s*/, "")
    .split("\n")[0]
    .trim();
  return reason || "That doesn't look like a medical topic. Try something like “heart failure” or “DKA”.";
}
