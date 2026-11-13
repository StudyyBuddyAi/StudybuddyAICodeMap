import { describe, it, expect, vi, beforeEach } from "vitest";

const callMedicalNotes = vi.fn();
vi.mock("@/lib/callMedicalNotes", () => ({ callMedicalNotes: (...a: unknown[]) => callMedicalNotes(...a) }));

import {
  DeckQuotaError,
  DeckTopicError,
  deckBatches,
  finishedCards,
  mergeDecks,
  mergeGrounding,
  requestDeck,
  splitDeck,
} from "./deck-request";
import { CARD_SLICE_KEYS } from "../../supabase/functions/_shared/deck-source.ts";

const card = (question: string, answer = "A.") => ({ question, answer, tag: "Mechanism", topic: "HF", grounded: false });

/** A streamed reply, split mid-frame the way a network delivers it. */
function streamed(frames: unknown[], headers: Record<string, string> = {}): Response {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n";
  const mid = Math.floor(body.length / 2);
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(body.slice(0, mid)));
      c.enqueue(new TextEncoder().encode(body.slice(mid)));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers });
}

const delta = (content: string) => ({ choices: [{ delta: { content } }] });

describe("deckBatches", () => {
  it("writes up to twenty in one request", () => {
    expect(deckBatches(12)).toEqual([{ count: 12 }]);
    expect(deckBatches(20)).toEqual([{ count: 20 }]);
  });

  it("splits a larger deck three ways, one slice each", () => {
    expect(deckBatches(50)).toEqual([
      { slice: "recognise", count: 17 },
      { slice: "explain", count: 17 },
      { slice: "manage", count: 16 },
    ]);
    expect(deckBatches(30).map((b) => b.count)).toEqual([10, 10, 10]);
    // Every slice the client sends is one the server knows.
    for (const b of deckBatches(50)) expect(CARD_SLICE_KEYS).toContain(b.slice);
  });
});

describe("splitDeck", () => {
  it("shares a mixed deck's cards, the first topics taking the remainder", () => {
    expect(splitDeck(["A", "B", "C"], 20)).toEqual([
      { topic: "A", count: 7 },
      { topic: "B", count: 7 },
      { topic: "C", count: 6 },
    ]);
    expect(splitDeck(["A"], 12)).toEqual([{ topic: "A", count: 12 }]);
  });
});

describe("finishedCards", () => {
  it("holds back the last card while its answer may still be arriving", () => {
    const text = "FLASHCARDS\n\nQ: [Mechanism][General] One?\nA: First.\n\nQ: [Diagnosis][General] Two?\nA: Sec";
    expect(finishedCards(text, "T").map((c) => c.question)).toEqual(["One?"]);
  });
});

describe("mergeDecks", () => {
  it("drops a card that asks what an earlier one asked", () => {
    const merged = mergeDecks([
      [card("What drug class reduces mortality in HFrEF?"), card("Why do loop diuretics cause hypokalemia?")],
      [card("What drug class reduces mortality in HFrEF patients?"), card("What is the first-line imaging for heart failure?")],
    ]);
    expect(merged.map((c) => c.question)).toEqual([
      "What drug class reduces mortality in HFrEF?",
      "Why do loop diuretics cause hypokalemia?",
      "What is the first-line imaging for heart failure?",
    ]);
  });
});

describe("mergeGrounding", () => {
  it("keeps every passage once", () => {
    const s = (id: string) => ({ id }) as never;
    expect(mergeGrounding([null, { retrievedChunks: 2, sources: [s("a"), s("b")] }, { retrievedChunks: 3, sources: [s("b"), s("c")] }])).toEqual({
      retrievedChunks: 3,
      sources: [s("a"), s("b"), s("c")],
    });
    expect(mergeGrounding([null, null])).toBeNull();
  });
});

describe("requestDeck", () => {
  beforeEach(() => callMedicalNotes.mockReset());

  it("reads the cards, the grounding and where the deck came from", async () => {
    callMedicalNotes.mockResolvedValue(
      streamed(
        [
          { __meta: { retrievedChunks: 1, sources: [{ id: "s1" }] } },
          delta("FLASHCARDS\n\n🫀\n\nQ: [Mechanism][Grounded] Why do thiazides lower urine calcium?\n"),
          delta("A: They raise distal calcium reabsorption.\n"),
        ],
        { "x-deck-source": "qbank" }
      )
    );
    const landed: number[] = [];
    const deck = await requestDeck(
      { notes: "Diuretics", deckSource: { kind: "qbank", questionIds: [] } },
      { onCards: (cards) => landed.push(cards.length) }
    );
    // The one card is reported once the stream ends.
    expect(landed).toEqual([1]);
    expect(callMedicalNotes.mock.calls[0][0]).toMatchObject({ cardsOnly: true, notes: "Diuretics" });
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0]).toMatchObject({ question: "Why do thiazides lower urine calcium?", grounded: true });
    expect(deck.grounding?.sources).toHaveLength(1);
    expect(deck.source).toBe("qbank");
  });

  it("names the refusals the page words itself", async () => {
    callMedicalNotes.mockResolvedValueOnce(new Response(JSON.stringify({ code: "invalid_topic", error: "Not a topic" }), { status: 400 }));
    await expect(requestDeck({ notes: "asdf" })).rejects.toBeInstanceOf(DeckTopicError);
    callMedicalNotes.mockResolvedValueOnce(new Response(JSON.stringify({ code: "credits_exhausted" }), { status: 429 }));
    await expect(requestDeck({ notes: "HF" })).rejects.toBeInstanceOf(DeckQuotaError);
    // A passing rate limit is not the day's usage limit.
    callMedicalNotes.mockResolvedValueOnce(new Response("{}", { status: 429 }));
    await expect(requestDeck({ notes: "HF" })).rejects.not.toBeInstanceOf(DeckQuotaError);
  });
});
