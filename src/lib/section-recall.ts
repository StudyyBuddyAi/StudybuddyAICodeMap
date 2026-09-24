import type { Flashcard, GeneratedSheet } from "@/types/generated-sheet";
import { bodyLines, resolvePlan, sectionBody } from "@/lib/sheet-plan";

/**
 * Which flashcard to ask at the foot of which section.
 *
 * Answering a question beats rereading, so each section can end on one recall
 * check. The deck is written beside the sheet with no record of which section
 * a card came from, so the link is recovered from the text: a card belongs to
 * the section whose terms it shares most, with the section's bolded keywords
 * counting for more — they are what the model marked as the point.
 *
 * Deliberately conservative. A section gets at most one card and a card is
 * used at most once, and a section whose best card clears no threshold gets
 * none: no question is better than one about something the section never said.
 */

/** Filler that would otherwise make every card overlap every section. */
const STOPWORDS = new Set(
  (
    "about above after again against also although among another because been " +
    "before being below between both cannot could does doing during each either " +
    "every first from further have having here into itself just least less made " +
    "make many more most much must never next only other over same should since " +
    "some such than that their them then there these they this those though " +
    "through under until upon very what when where whether which while whom " +
    "whose will with within without would your patient patients common commonly " +
    "usually often typically associated seen present presents presentation " +
    "most likely following best step management treatment diagnosis cause causes"
  ).split(/\s+/)
);

/** Lowercased content words of four letters or more, with light plural folding. */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [])
    .filter((w) => !STOPWORDS.has(w))
    .map((w) => (w.length > 5 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

function boldTerms(text: string): string[] {
  return (text.match(/\*\*([^*]+)\*\*/g) ?? []).flatMap((m) => terms(m.slice(2, -2)));
}

/** A bolded keyword is worth this many ordinary shared terms. */
const BOLD_WEIGHT = 3;
/** Below this a card is judged not to be about the section at all. */
const MIN_SCORE = 5;

function sectionWeights(text: string): Map<string, number> {
  const weights = new Map<string, number>();
  for (const t of terms(text)) weights.set(t, 1);
  for (const t of boldTerms(text)) weights.set(t, BOLD_WEIGHT);
  return weights;
}

function score(weights: Map<string, number>, card: Flashcard): number {
  // Distinct terms only, so a card repeating one word can't win on it.
  const cardTerms = new Set(terms(`${card.question} ${card.answer}`));
  let total = 0;
  for (const t of cardTerms) total += weights.get(t) ?? 0;
  return total;
}

/** Section key → the card to ask beneath it. */
export function assignRecallCards(sheet: GeneratedSheet): Map<string, Flashcard> {
  const cards = (sheet.flashcards ?? []).filter((c) => c.question.trim() && c.answer.trim());
  const assigned = new Map<string, Flashcard>();
  if (!cards.length) return assigned;

  const candidates: { key: string; card: number; score: number }[] = [];
  for (const spec of resolvePlan(sheet)) {
    const body = sectionBody(sheet, spec.key);
    const text = bodyLines(body).join("\n");
    if (!text.trim()) continue;
    const weights = sectionWeights(text);
    cards.forEach((card, i) => {
      const s = score(weights, card);
      if (s >= MIN_SCORE) candidates.push({ key: spec.key, card: i, score: s });
    });
  }

  // Best pairs first. Ties keep plan and deck order, which the sort preserves.
  candidates.sort((a, b) => b.score - a.score);
  const usedCards = new Set<number>();
  for (const c of candidates) {
    if (assigned.has(c.key) || usedCards.has(c.card)) continue;
    assigned.set(c.key, cards[c.card]);
    usedCards.add(c.card);
  }
  return assigned;
}
