/**
 * What a standalone deck leans towards, keyed by the value the flashcards page
 * sends. A Map rather than an object literal: the key comes from the request
 * body and is looked up into the system prompt, so "constructor" and friends
 * must miss. Unknown or absent keys add nothing — a "general" deck.
 */
export const CARD_FOCUS = new Map<string, string>([
  ["mechanism", "Emphasis: weight the deck towards mechanism and pathophysiology — why it happens, not only what happens."],
  ["management", "Emphasis: weight the deck towards diagnosis, management and the next best step."],
  ["pharm", "Emphasis: weight the deck towards pharmacology — drugs of choice, their mechanisms, adverse effects and contraindications."],
]);

export function cardFocusLine(value: unknown): string {
  const line = typeof value === "string" ? CARD_FOCUS.get(value) : undefined;
  return line ? `\n${line}` : "";
}
