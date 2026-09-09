import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { getNextReview } from "@/lib/spaced-repetition";
import type { GroundingLevel, SheetSource } from "@/types/generated-sheet";

export type Card = {
  id: string;
  question: string;
  answer: string;
  tag: string;
  topic: string;
  topicEmoji?: string;
  createdAt: number;
  interval: number;
  dueAt: number;
  lastReviewed: number | null;
  reviewCount: number;
  /**
   * Per-card grounding, from the [Grounded]/[General] sourcing tag. Cards
   * written before grounding existed default to false and render the
   * "Unverified" badge in StudyMode — which is the truth about them.
   */
  grounded: boolean;
};

/**
 * Deck-level retrieval result, persisted on `decks.grounding_metadata`. One
 * generation runs one retrieval, so every card it produced shares this.
 *
 * `sources` is the same `SheetSource` a sheet stores, deliberately: a deck and
 * a sheet are two renderings of one retrieval, and both are read back by
 * SheetSources. That includes the locator and validated book/chapter/section
 * fields, which ride through this JSON column untouched. They are all optional
 * on SheetSource, so a deck saved before they existed still parses — it simply
 * renders from the mechanical repair in src/lib/source-display.ts.
 */
export type GroundingMeta = {
  retrievedChunks: number;
  groundingLevel: GroundingLevel;
  sources: SheetSource[];
};

const STORAGE_KEY = "studybuddy_decks_v1";
const DECK_CHANGE_EVENT = "studybuddy:deck-changed";

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  return (hash >>> 0).toString(36);
}

export function makeCardId(question: string, answer: string): string {
  return djb2(question.trim().toLowerCase() + "|" + answer.trim().toLowerCase());
}

function loadCards(): Card[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Cards written before grounding existed have no `grounded` key. Normalize
    // here so every consumer can read a boolean instead of guarding for it.
    return parsed.map((c: Card) => ({ ...c, grounded: c.grounded ?? false }));
  } catch {
    return [];
  }
}

function saveToStorage(cards: Card[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch {
    // ignore
  }
}

type NewCardInput = Pick<Card, "question" | "answer" | "tag" | "topic" | "topicEmoji" | "grounded">;

type CardRow = {
  id: string;
  client_id: string;
  question: string;
  answer: string;
  tag: string | null;
  topic: string;
  topic_emoji: string | null;
  interval_days: number;
  due_at: string;
  last_reviewed_at: string | null;
  review_count: number;
  created_at: string;
  grounded: boolean | null;
};

function rowToCard(row: CardRow): Card {
  return {
    id: row.client_id,
    question: row.question,
    answer: row.answer,
    tag: row.tag ?? "",
    topic: row.topic,
    topicEmoji: row.topic_emoji ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
    interval: row.interval_days,
    dueAt: new Date(row.due_at).getTime(),
    lastReviewed: row.last_reviewed_at
      ? new Date(row.last_reviewed_at).getTime()
      : null,
    reviewCount: row.review_count,
    grounded: row.grounded ?? false,
  };
}

export function useFlashcardDeck() {
  const { user, isAnonymous } = useAuth();
  const userId = user?.id ?? null;
  const useServer = !!userId && !isAnonymous;
  const queryClient = useQueryClient();

  // localStorage state for anonymous users
  const [localCards, setLocalCards] = useState<Card[]>(() => loadCards());

  useEffect(() => {
    if (useServer) return;
    const refresh = () => setLocalCards(loadCards());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) refresh();
    };
    const onDeckChange = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener(DECK_CHANGE_EVENT, onDeckChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(DECK_CHANGE_EVENT, onDeckChange);
    };
  }, [useServer]);

  // Server cards via React Query
  const cardsQuery = useQuery({
    queryKey: ["flashcards", userId],
    enabled: useServer,
    queryFn: async (): Promise<Card[]> => {
      const { data, error } = await supabase
        .from("cards")
        .select(
          "id, client_id, question, answer, tag, topic, topic_emoji, interval_days, due_at, last_reviewed_at, review_count, created_at, grounded"
        )
        .eq("user_id", userId!);
      if (error) throw error;
      return (data ?? []).map((row) => rowToCard(row as CardRow));
    },
  });

  const allCards = useServer ? cardsQuery.data ?? [] : localCards;

  const persistLocal = useCallback((next: Card[]) => {
    setLocalCards(next);
    saveToStorage(next);
    try {
      window.dispatchEvent(new CustomEvent(DECK_CHANGE_EVENT));
    } catch {
      // ignore
    }
  }, []);

  const saveCards = useCallback(
    async (incoming: NewCardInput[], groundingMeta?: GroundingMeta): Promise<number> => {
      if (!incoming.length) return 0;

      if (useServer) {
        const now = new Date().toISOString();
        // Group by topic so we upsert decks once per topic
        const topics = new Map<string, { topic: string; emoji?: string }>();
        for (const c of incoming) {
          if (!topics.has(c.topic)) {
            topics.set(c.topic, { topic: c.topic, emoji: c.topicEmoji });
          }
        }

        // Upsert decks
        const deckRows = Array.from(topics.values()).map((t) => ({
          user_id: userId!,
          topic: t.topic,
          topic_emoji: t.emoji ?? null,
          // Only written when this generation actually produced retrieval
          // metadata. Omitting the key leaves an existing deck's grounding
          // untouched rather than nulling it out on a regeneration that
          // arrived without __meta.
          //
          // `grounding_metadata` is a jsonb column typed as `Json`, and an
          // interface with optional fields is not structurally assignable to
          // it. GroundingMeta is plain JSON-safe data, so this is the ordinary
          // serialization boundary, not a claim about an unrelated shape.
          ...(groundingMeta
            ? { grounding_metadata: groundingMeta as unknown as Json }
            : {}),
        }));
        const { error: deckError } = await supabase
          .from("decks")
          .upsert(deckRows, { onConflict: "user_id,topic", ignoreDuplicates: false });
        if (deckError) throw deckError;

        // Fetch deck ids for the affected topics
        const { data: decks, error: fetchError } = await supabase
          .from("decks")
          .select("id, topic")
          .eq("user_id", userId!)
          .in("topic", Array.from(topics.keys()));
        if (fetchError) throw fetchError;
        const deckIdByTopic = new Map<string, string>();
        for (const d of decks ?? []) deckIdByTopic.set(d.topic, d.id);

        const cardRows = incoming
          .map((c) => {
            const deckId = deckIdByTopic.get(c.topic);
            if (!deckId) return null;
            return {
              user_id: userId!,
              deck_id: deckId,
              client_id: makeCardId(c.question, c.answer),
              question: c.question,
              answer: c.answer,
              tag: c.tag,
              topic: c.topic,
              topic_emoji: c.topicEmoji ?? null,
              interval_days: 0,
              due_at: now,
              review_count: 0,
              grounded: c.grounded ?? false,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        const { error: cardError } = await supabase
          .from("cards")
          .upsert(cardRows, {
            onConflict: "user_id,client_id",
            ignoreDuplicates: true,
          });
        if (cardError) throw cardError;

        await queryClient.invalidateQueries({ queryKey: ["flashcards", userId] });
        // The deck's grounding badge reads from a separate query — refresh it
        // too, or a regeneration leaves the old verdict on screen.
        await queryClient.invalidateQueries({ queryKey: ["deck-grounding", userId] });
        return cardRows.length;
      }

      // localStorage path
      const current = loadCards();
      const existingIds = new Set(current.map((c) => c.id));
      const now = Date.now();
      let added = 0;
      const additions: Card[] = [];
      for (const c of incoming) {
        const id = makeCardId(c.question, c.answer);
        if (existingIds.has(id)) continue;
        existingIds.add(id);
        additions.push({
          id,
          question: c.question,
          answer: c.answer,
          tag: c.tag,
          topic: c.topic,
          topicEmoji: c.topicEmoji,
          createdAt: now,
          interval: 0,
          dueAt: now,
          lastReviewed: null,
          reviewCount: 0,
          grounded: c.grounded ?? false,
        });
        added++;
      }
      if (additions.length) persistLocal([...current, ...additions]);
      return added;
    },
    [useServer, userId, queryClient, persistLocal]
  );

  const reviewCard = useCallback(
    async (id: string, rating: "again" | "good" | "easy") => {
      const computeNext = (card: Card) => {
        const now = Date.now();
        const next = getNextReview(card.interval, rating, now);
        return { interval: next.interval, dueAt: next.dueAt, lastReviewed: next.lastReviewed };
      };

      if (useServer) {
        const card = allCards.find((c) => c.id === id);
        if (!card) return;
        const next = computeNext(card);
        const { data: updated, error } = await supabase
          .from("cards")
          .update({
            interval_days: next.interval,
            due_at: new Date(next.dueAt).toISOString(),
            last_reviewed_at: new Date(next.lastReviewed).toISOString(),
            review_count: card.reviewCount + 1,
          })
          .eq("user_id", userId!)
          .eq("client_id", id)
          .select("id")
          .maybeSingle();
        if (error) throw error;

        if (updated?.id) {
          try {
            const { error: reviewError } = await supabase
              .from("review_sessions")
              .insert({
                user_id: userId!,
                card_id: updated.id,
                rating,
                reviewed_at: new Date(next.lastReviewed).toISOString(),
              });
            if (reviewError) console.error("review_sessions insert failed", reviewError);
            else {
              await queryClient.invalidateQueries({
                queryKey: ["study-stats", userId],
              });
            }
          } catch (e) {
            console.error("review_sessions insert failed", e);
          }
        }

        await queryClient.invalidateQueries({ queryKey: ["flashcards", userId] });
        return;
      }

      const current = loadCards();
      const updated = current.map((c) => {
        if (c.id !== id) return c;
        const next = computeNext(c);
        return {
          ...c,
          interval: next.interval,
          dueAt: next.dueAt,
          lastReviewed: next.lastReviewed,
          reviewCount: c.reviewCount + 1,
        };
      });
      persistLocal(updated);
    },
    [useServer, userId, queryClient, persistLocal, allCards]
  );

  const deleteCard = useCallback(
    async (id: string) => {
      if (useServer) {
        const { error } = await supabase
          .from("cards")
          .delete()
          .eq("user_id", userId!)
          .eq("client_id", id);
        if (error) throw error;
        await queryClient.invalidateQueries({ queryKey: ["flashcards", userId] });
        return;
      }
      persistLocal(loadCards().filter((c) => c.id !== id));
    },
    [useServer, userId, queryClient, persistLocal]
  );

  const now = Date.now();
  const dueCards = allCards.filter((c) => c.dueAt <= now);
  const stats = {
    total: allCards.length,
    due: dueCards.length,
    mastered: allCards.filter((c) => c.interval >= 21).length,
  };

  return { allCards, dueCards, saveCards, reviewCard, deleteCard, stats };
}

/**
 * Deck-level grounding metadata for one topic, as written by `saveCards`.
 *
 * Server-only: anonymous users keep their decks in localStorage and have no
 * `decks` row, so this resolves to null for them. Callers should fall back to
 * aggregating each card's own `grounded` flag, which is available either way.
 */
export function useDeckGrounding(topic: string | null) {
  const { user, isAnonymous } = useAuth();
  const userId = user?.id ?? null;
  const useServer = !!userId && !isAnonymous;

  return useQuery({
    queryKey: ["deck-grounding", userId, topic],
    enabled: useServer && !!topic,
    queryFn: async (): Promise<GroundingMeta | null> => {
      if (!topic) return null;
      const { data, error } = await supabase
        .from("decks")
        .select("grounding_metadata")
        .eq("user_id", userId!)
        .eq("topic", topic)
        .maybeSingle();
      // Fail soft: a missing deck or a transient error is not worth surfacing
      // as an error state for a badge. Null renders the legacy/unknown case.
      if (error || !data) return null;
      // The mirror of the write above: back out of `Json` into the shape this
      // hook wrote. Every field display code reads is optional on SheetSource,
      // so a deck row written before the locator/label fields existed still
      // renders — just from the mechanical repair rather than the model labels.
      return (data.grounding_metadata as unknown as GroundingMeta | null) ?? null;
    },
  });
}
