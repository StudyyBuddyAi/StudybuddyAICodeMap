import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { recordLocalReview, srsTodayKey, useSrsSettings } from "@/hooks/use-srs-settings";
import {
  SrsState,
  buildStudyQueue,
  isMature,
  isReviewRating,
  legacyToSrs,
  newSrsFields,
  replayHistory,
  scheduleReview,
  type HistoryReview,
  type ReviewOutcome,
  type ReviewRating,
  type SrsFields,
  type SrsSettings,
} from "@/lib/spaced-repetition";
import type { GroundingLevel, SheetSource } from "@/types/generated-sheet";

export type Card = SrsFields & {
  id: string;
  question: string;
  answer: string;
  tag: string;
  topic: string;
  topicEmoji?: string;
  createdAt: number;
  /**
   * Per-card grounding, from the [Grounded]/[General] sourcing tag. Cards
   * written before grounding existed default to false and render the
   * "Unverified" badge in StudyMode — which is the truth about them.
   */
  grounded: boolean;
  /** Lapsed LEECH_THRESHOLD times: worth rewriting, explaining, or deleting. */
  isLeech: boolean;
};

/** A server card still carries its row id, which review_sessions references. */
type ServerCard = Card & { rowId: string; needsMigration: boolean };

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

/**
 * A stored anonymous card. Cards written before FSRS carry the ladder fields
 * (`interval`, `reviewCount`) and no `state`; they are converted on load.
 */
type StoredCard = Partial<Card> & {
  id: string;
  question: string;
  answer: string;
  topic: string;
  createdAt: number;
  dueAt: number;
  interval?: number;
  reviewCount?: number;
  lastReviewed?: number | null;
};

export function normalizeStoredCard(c: StoredCard): Card {
  const srs: SrsFields =
    typeof c.state === "number"
      ? {
          state: c.state,
          stability: c.stability ?? 0,
          difficulty: c.difficulty ?? 0,
          dueAt: c.dueAt,
          lastReviewed: c.lastReviewed ?? null,
          scheduledDays: c.scheduledDays ?? 0,
          learningSteps: c.learningSteps ?? 0,
          reps: c.reps ?? 0,
          lapses: c.lapses ?? 0,
        }
      : legacyToSrs({
          interval: c.interval ?? 0,
          dueAt: c.dueAt,
          lastReviewed: c.lastReviewed ?? null,
          reviewCount: c.reviewCount ?? 0,
        });
  return {
    ...srs,
    id: c.id,
    question: c.question,
    answer: c.answer,
    tag: c.tag ?? "",
    topic: c.topic,
    topicEmoji: c.topicEmoji,
    createdAt: c.createdAt,
    // Cards written before grounding existed have no `grounded` key. Normalize
    // here so every consumer can read a boolean instead of guarding for it.
    grounded: c.grounded ?? false,
    isLeech: c.isLeech ?? false,
  };
}

function loadCards(): Card[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((c: StoredCard) => normalizeStoredCard(c));
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

const CARD_COLUMNS =
  "id, client_id, question, answer, tag, topic, topic_emoji, interval_days, due_at, last_reviewed_at, review_count, created_at, grounded, srs_state, stability, difficulty, scheduled_days, learning_steps, lapses, is_leech";

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
  srs_state: number | null;
  stability: number | null;
  difficulty: number | null;
  scheduled_days: number | null;
  learning_steps: number | null;
  lapses: number | null;
  is_leech: boolean | null;
};

function rowToCard(row: CardRow): ServerCard {
  const dueAt = new Date(row.due_at).getTime();
  const lastReviewed = row.last_reviewed_at ? new Date(row.last_reviewed_at).getTime() : null;
  const needsMigration = row.srs_state === null;
  // Until the backfill replays its history, a ladder card is shown with an
  // approximate state so due counts and the queue still make sense.
  const srs: SrsFields = needsMigration
    ? legacyToSrs({ interval: row.interval_days, dueAt, lastReviewed, reviewCount: row.review_count })
    : {
        state: row.srs_state as SrsState,
        stability: row.stability ?? 0,
        difficulty: row.difficulty ?? 0,
        dueAt,
        lastReviewed,
        scheduledDays: row.scheduled_days ?? 0,
        learningSteps: row.learning_steps ?? 0,
        reps: row.review_count,
        lapses: row.lapses ?? 0,
      };
  return {
    ...srs,
    rowId: row.id,
    needsMigration,
    id: row.client_id,
    question: row.question,
    answer: row.answer,
    tag: row.tag ?? "",
    topic: row.topic,
    topicEmoji: row.topic_emoji ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
    grounded: row.grounded ?? false,
    isLeech: row.is_leech ?? false,
  };
}

/** The state keys flashcard_state_ok and the RPCs expect. */
function stateToJson(f: SrsFields) {
  return {
    state: f.state,
    stability: f.stability,
    difficulty: f.difficulty,
    due_at: new Date(f.dueAt).toISOString(),
    last_reviewed_at: f.lastReviewed === null ? null : new Date(f.lastReviewed).toISOString(),
    scheduled_days: f.scheduledDays,
    learning_steps: f.learningSteps,
    reps: f.reps,
    lapses: f.lapses,
  };
}

/** Every review for these card rows, oldest first, paged past PostgREST's row cap. */
async function fetchHistory(rowIds: string[]): Promise<Map<string, HistoryReview[]>> {
  const byCard = new Map<string, HistoryReview[]>();
  const PAGE = 1000;
  for (let i = 0; i < rowIds.length; i += 100) {
    const chunk = rowIds.slice(i, i + 100);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("review_sessions")
        .select("card_id, rating, reviewed_at")
        .in("card_id", chunk)
        .order("reviewed_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const r of data ?? []) {
        if (!isReviewRating(r.rating)) continue;
        const list = byCard.get(r.card_id) ?? [];
        list.push({ rating: r.rating, reviewedAt: new Date(r.reviewed_at).getTime() });
        byCard.set(r.card_id, list);
      }
      if (!data || data.length < PAGE) break;
    }
  }
  return byCard;
}

/**
 * Rebuild cards from their review history and write the result.
 * 'backfill' moves ladder cards onto FSRS; 'reschedule' re-derives migrated
 * cards after the user's weights or retention change.
 */
async function rebuildFromHistory(
  cards: ServerCard[],
  mode: "backfill" | "reschedule",
  settings: Pick<SrsSettings, "desiredRetention" | "weights">
): Promise<number> {
  if (!cards.length) return 0;
  const reviewed = cards.filter((c) => c.reps > 0);
  const history = await fetchHistory(reviewed.map((c) => c.rowId));

  const items = cards.map((c) => {
    const reviews = history.get(c.rowId) ?? [];
    let state: SrsFields;
    if (reviews.length) {
      state = replayHistory(c.id, reviews, settings, c.createdAt);
    } else if (mode === "backfill") {
      // Never reviewed, or reviews whose log rows never landed.
      state = c.reps > 0 ? { ...c } : newSrsFields(c.dueAt);
    } else {
      state = { ...c };
    }
    // A new card keeps its place; replay can't know a due date nobody earned.
    if (state.state === SrsState.New) state = { ...state, dueAt: c.dueAt };
    return { client_id: c.id, expected_reps: c.reps, state: stateToJson(state) };
  });

  let updated = 0;
  for (let i = 0; i < items.length; i += 200) {
    const { data, error } = await supabase.rpc("set_flashcard_states", {
      p_mode: mode,
      p_states: items.slice(i, i + 200) as unknown as Json,
    });
    if (error) throw error;
    updated += ((data ?? {}) as { updated?: number }).updated ?? 0;
  }
  return updated;
}

// Reviews are written one at a time, in the order they were made. A learning
// card can be rated again a minute later while its first write is still in
// flight, and review_flashcard's review_count check would otherwise refuse it.
let reviewChain: Promise<unknown> = Promise.resolve();
const backfillStarted = new Set<string>();

type ReviewResult = { ok: boolean; reason?: string };

export function useFlashcardDeck() {
  const { user, isAnonymous } = useAuth();
  const userId = user?.id ?? null;
  const useServer = !!userId && !isAnonymous;
  const queryClient = useQueryClient();
  const { settings, today } = useSrsSettings();
  const cardsKey = useMemo(() => ["flashcards", userId] as const, [userId]);

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
    queryKey: cardsKey,
    enabled: useServer,
    queryFn: async (): Promise<ServerCard[]> => {
      const { data, error } = await supabase
        .from("cards")
        .select(CARD_COLUMNS)
        .eq("user_id", userId!);
      if (error) throw error;
      return (data ?? []).map((row) => rowToCard(row as CardRow));
    },
  });

  const allCards: Card[] = useServer ? cardsQuery.data ?? [] : localCards;

  // One-time move of ladder-scheduled cards onto FSRS, replaying their history.
  useEffect(() => {
    if (!useServer || !userId || !cardsQuery.data) return;
    const pending = cardsQuery.data.filter((c) => c.needsMigration);
    if (!pending.length || backfillStarted.has(userId)) return;
    backfillStarted.add(userId);
    rebuildFromHistory(pending, "backfill", settings)
      .then(() => queryClient.invalidateQueries({ queryKey: cardsKey }))
      .catch((e) => {
        console.error("flashcard backfill failed", e);
        // Allow another attempt on the next mount.
        backfillStarted.delete(userId);
      });
  }, [useServer, userId, cardsQuery.data, settings, queryClient, cardsKey]);

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
              srs_state: SrsState.New,
              grounded: c.grounded ?? false,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        // ignoreDuplicates: regenerating a card never resets its schedule.
        const { error: cardError } = await supabase
          .from("cards")
          .upsert(cardRows, {
            onConflict: "user_id,client_id",
            ignoreDuplicates: true,
          });
        if (cardError) throw cardError;

        await queryClient.invalidateQueries({ queryKey: cardsKey });
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
          ...newSrsFields(now),
          id,
          question: c.question,
          answer: c.answer,
          tag: c.tag,
          topic: c.topic,
          topicEmoji: c.topicEmoji,
          createdAt: now,
          grounded: c.grounded ?? false,
          isLeech: false,
        });
        added++;
      }
      if (additions.length) persistLocal([...current, ...additions]);
      return added;
    },
    [useServer, userId, queryClient, persistLocal, cardsKey]
  );

  /** The freshest server copy of a card: cache first, then the database. */
  const getServerCard = useCallback(
    async (id: string, fromDb = false): Promise<ServerCard | null> => {
      if (!fromDb) {
        const cached = queryClient.getQueryData<ServerCard[]>(cardsKey)?.find((c) => c.id === id);
        if (cached) return cached;
      }
      const { data, error } = await supabase
        .from("cards")
        .select(CARD_COLUMNS)
        .eq("user_id", userId!)
        .eq("client_id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? rowToCard(data as CardRow) : null;
    },
    [queryClient, cardsKey, userId]
  );

  /**
   * Rate a card. Resolves with the scheduling outcome (the session uses the
   * new state to decide whether the card comes back), or null when the card
   * no longer exists. Rejects if the review could not be saved.
   */
  const reviewCard = useCallback(
    (id: string, rating: ReviewRating, opts: { durationMs?: number } = {}): Promise<ReviewOutcome | null> => {
      const run = async (): Promise<ReviewOutcome | null> => {
        const now = Date.now();

        if (!useServer) {
          const current = loadCards();
          const card = current.find((c) => c.id === id);
          if (!card) return null;
          const outcome = scheduleReview(card.id, card, rating, now, settings);
          persistLocal(
            current.map((c) =>
              c.id === id ? { ...c, ...outcome.next, isLeech: c.isLeech || outcome.becameLeech } : c
            )
          );
          recordLocalReview(card.state, now);
          return outcome;
        }

        const applyOptimistic = (c: ServerCard, outcome: ReviewOutcome) =>
          queryClient.setQueryData<ServerCard[]>(cardsKey, (old) =>
            old?.map((x) =>
              x.id === c.id
                ? { ...x, ...outcome.next, needsMigration: false, isLeech: x.isLeech || outcome.becameLeech }
                : x
            )
          );

        const attempt = async (card: ServerCard) => {
          const outcome = scheduleReview(card.id, card, rating, now, settings);
          applyOptimistic(card, outcome);
          const { data, error } = await supabase.rpc("review_flashcard", {
            p_client_id: card.id,
            p_rating: rating,
            p_expected_reps: card.reps,
            p_next: { ...stateToJson(outcome.next), is_leech: outcome.becameLeech } as unknown as Json,
            p_log: {
              state_before: outcome.log.stateBefore,
              stability_before: outcome.log.stabilityBefore,
              difficulty_before: outcome.log.difficultyBefore,
              elapsed_days: outcome.log.elapsedDays,
              reviewed_at: new Date(outcome.log.reviewedAt).toISOString(),
              duration_ms: opts.durationMs ?? null,
            } as unknown as Json,
          });
          if (error) throw error;
          return { outcome, result: (data ?? { ok: false }) as unknown as ReviewResult };
        };

        let card = await getServerCard(id);
        if (!card) return null;

        const previous = queryClient.getQueryData<ServerCard[]>(cardsKey);

        try {
          let { outcome, result } = await attempt(card);
          if (!result.ok && result.reason === "stale") {
            // Another tab or device reviewed this card since we loaded it (or
            // the backfill rewrote it). The user did rate what they saw, so
            // apply the rating to the fresh state.
            card = await getServerCard(id, true);
            if (!card) return null;
            ({ outcome, result } = await attempt(card));
          }
          if (!result.ok) {
            if (result.reason === "not_found") return null;
            throw new Error(`review_flashcard refused: ${result.reason ?? "unknown"}`);
          }
          return outcome;
        } catch (e) {
          if (previous) queryClient.setQueryData(cardsKey, previous);
          throw e;
        } finally {
          void queryClient.invalidateQueries({ queryKey: cardsKey });
          void queryClient.invalidateQueries({ queryKey: srsTodayKey(userId) });
          void queryClient.invalidateQueries({ queryKey: ["study-stats", userId] });
        }
      };

      const next = reviewChain.then(run, run);
      reviewChain = next.catch(() => undefined);
      return next;
    },
    [useServer, userId, settings, persistLocal, getServerCard, queryClient, cardsKey]
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
        await queryClient.invalidateQueries({ queryKey: cardsKey });
        return;
      }
      persistLocal(loadCards().filter((c) => c.id !== id));
    },
    [useServer, userId, queryClient, persistLocal, cardsKey]
  );

  /**
   * Re-derive every card's schedule from its history under the current
   * settings — Anki's "reschedule cards on change", run after optimizing.
   */
  const rescheduleAll = useCallback(
    async (override?: Pick<SrsSettings, "desiredRetention" | "weights">): Promise<number> => {
      if (!useServer) return 0;
      const fresh = await queryClient.fetchQuery({
        queryKey: cardsKey,
        queryFn: async (): Promise<ServerCard[]> => {
          const { data, error } = await supabase.from("cards").select(CARD_COLUMNS).eq("user_id", userId!);
          if (error) throw error;
          return (data ?? []).map((row) => rowToCard(row as CardRow));
        },
        staleTime: 0,
      });
      const migrated = fresh.filter((c) => !c.needsMigration && c.reps > 0);
      const updated = await rebuildFromHistory(migrated, "reschedule", override ?? settings);
      await queryClient.invalidateQueries({ queryKey: cardsKey });
      return updated;
    },
    [useServer, userId, queryClient, cardsKey, settings]
  );

  const now = Date.now();
  const queue = buildStudyQueue(allCards, now, settings, today);
  const stats = {
    total: allCards.length,
    /** Cards to study today, after daily limits. */
    due: queue.cards.length,
    counts: queue.counts,
    mastered: allCards.filter(isMature).length,
    leeches: allCards.filter((c) => c.isLeech).length,
  };

  return {
    allCards,
    dueCards: queue.cards,
    saveCards,
    reviewCard,
    deleteCard,
    rescheduleAll,
    stats,
    settings,
    today,
  };
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
