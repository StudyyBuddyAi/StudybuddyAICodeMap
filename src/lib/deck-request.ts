import { callMedicalNotes, type MedicalNotesParams } from "@/lib/callMedicalNotes";
import { parseModelUsed, type ModelUsed } from "@/lib/model-used";
import { parseFlashcardsFromOutput, type ParsedCard } from "@/lib/parse-flashcards";
import { applySourceLabels } from "@/lib/source-labels";
import { parseDecline } from "@/lib/validate-topic";
import type { SheetSource } from "@/types/generated-sheet";

export type { ParsedCard };

/** The most one request writes; the server clamps a deck to this. */
export const MAX_CARDS_PER_REQUEST = 20;

/** Retrieval behind a deck, from the server's __meta frames. Null: it ran ungrounded. */
export interface DeckGrounding {
  retrievedChunks: number;
  sources: SheetSource[];
}

/** Where the server says a deck from the student's material was written from. */
export type DeckSourceUsed = "sheet" | "qbank" | "none" | null;

export interface DeckResult {
  cards: ParsedCard[];
  /** The writer's reason when it judged the topic not medical, else null. */
  declined: string | null;
  grounding: DeckGrounding | null;
  model: ModelUsed | null;
  source: DeckSourceUsed;
}

/** The server turned the topic away before writing: say why. */
export class DeckTopicError extends Error {}
/** Today's free decks are used up. */
export class DeckQuotaError extends Error {}

/**
 * The cards finished so far in a deck still streaming. The last card is held
 * back until something follows it: its answer may still be arriving.
 */
export function finishedCards(text: string, topic: string): ParsedCard[] {
  const cards = parseFlashcardsFromOutput(text, topic);
  return cards.slice(0, Math.max(0, cards.length - 1));
}

export interface DeckRequestOptions {
  signal?: AbortSignal;
  /** Each time another card is finished, every card finished so far. */
  onCards?: (cards: ParsedCard[]) => void;
}

/**
 * One deck request, read to the end: the cards, the retrieval behind them and
 * the model that wrote them. Throws DeckTopicError / DeckQuotaError for the
 * refusals the page words itself, and a plain Error otherwise.
 */
export async function requestDeck(
  params: MedicalNotesParams & { notes: string },
  opts: DeckRequestOptions = {}
): Promise<DeckResult> {
  const response = await callMedicalNotes({ ...params, cardsOnly: true }, { signal: opts.signal });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 400 && err.code === "invalid_topic") throw new DeckTopicError(err.error || "");
    if (response.status === 429) throw new DeckQuotaError("You've reached today's free limit. It resets at midnight UTC.");
    throw new Error(err.error || `Error: ${response.status}`);
  }
  const model = parseModelUsed(response.headers);
  const sourceHeader = response.headers.get("x-deck-source");
  const source: DeckSourceUsed = sourceHeader === "sheet" || sourceHeader === "qbank" || sourceHeader === "none" ? sourceHeader : null;

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let grounding: DeckGrounding | null = null;
  let reported = 0;
  const report = () => {
    if (!opts.onCards) return;
    const done = finishedCards(text, params.notes);
    if (done.length > reported) {
      reported = done.length;
      opts.onCards(done);
    }
  };

  read: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (json === "[DONE]") break read;
      try {
        const parsed = JSON.parse(json);
        // Grounding arrives as a __meta frame ahead of the cards; the
        // book/chapter labels as a second one at the end, refining the first.
        if (parsed.__meta) {
          if (Array.isArray(parsed.__meta.sourceLabels)) {
            if (grounding) grounding = { ...grounding, sources: applySourceLabels(grounding.sources, parsed.__meta.sourceLabels) };
          } else {
            grounding = {
              retrievedChunks: typeof parsed.__meta.retrievedChunks === "number" ? parsed.__meta.retrievedChunks : 0,
              sources: Array.isArray(parsed.__meta.sources) ? parsed.__meta.sources : [],
            };
          }
          continue;
        }
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          text += content;
          if (content.includes("\n")) report();
        }
      } catch {
        // A frame split across reads: wait for the rest of it.
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }

  const declined = parseDecline(text);
  const cards = declined ? [] : parseFlashcardsFromOutput(text, params.notes);
  if (opts.onCards && cards.length > reported) opts.onCards(cards);
  return {
    cards,
    declined,
    grounding,
    model,
    source,
  };
}

export interface DeckBatch {
  count: number;
  /** The kinds of card this batch keeps to (deck-source.ts CARD_SLICES); none for a single request. */
  slice?: "recognise" | "explain" | "manage";
}

/**
 * How a deck is written: one request up to MAX_CARDS_PER_REQUEST, and above
 * that three side by side, each keeping to its own kinds of card so they
 * don't write the same deck three times. The first batches take the
 * remainder: 50 is 17 · 17 · 16.
 */
export function deckBatches(count: number): DeckBatch[] {
  const n = Math.max(1, Math.round(count));
  if (n <= MAX_CARDS_PER_REQUEST) return [{ count: n }];
  const slices = ["recognise", "explain", "manage"] as const;
  return slices.map((slice, i) => ({ slice, count: Math.min(MAX_CARDS_PER_REQUEST, Math.ceil((n - i) / slices.length)) }));
}

/**
 * A deck mixed across topics: one deck per topic, sharing the cards, the first
 * topics taking the remainder — 20 across three is 7 · 7 · 6.
 */
export function splitDeck(topics: readonly string[], size: number): { topic: string; count: number }[] {
  const n = topics.length;
  return topics.map((topic, i) => ({ topic, count: Math.ceil((Math.round(size) - i) / n) })).filter((p) => p.count > 0);
}

const words = (q: string) =>
  new Set(
    q
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );

/** Two questions that ask the same thing: most of their words in common. */
function sameQuestion(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared) >= 0.75;
}

/** Batches merged into one deck, a card that repeats an earlier one dropped. */
export function mergeDecks(decks: ParsedCard[][]): ParsedCard[] {
  const kept: { card: ParsedCard; words: Set<string> }[] = [];
  for (const card of decks.flat()) {
    const w = words(card.question);
    if (kept.some((k) => sameQuestion(k.words, w))) continue;
    kept.push({ card, words: w });
  }
  return kept.map((k) => k.card);
}

/** The batches' retrieval as one: every passage once. Null when none ran grounded. */
export function mergeGrounding(groundings: (DeckGrounding | null)[]): DeckGrounding | null {
  const ran = groundings.filter((g): g is DeckGrounding => g !== null);
  if (!ran.length) return null;
  const seen = new Set<string>();
  const sources: SheetSource[] = [];
  for (const g of ran) {
    for (const s of g.sources) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      sources.push(s);
    }
  }
  return { retrievedChunks: Math.max(...ran.map((g) => g.retrievedChunks)), sources };
}
