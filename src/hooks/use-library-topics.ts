import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useFlashcardDeck } from "@/hooks/use-flashcard-deck";
import { useStudyHistory } from "@/hooks/use-study-history";
import { isMature } from "@/lib/spaced-repetition";
import { buildLibraryTopics, type LibraryQBankSet } from "@/lib/library-topics";

/** The typed topic lives in the session's generation JSON, not a column. */
const SET_COLUMNS: string = "id, score, total, system, ended_at, topic:generation->>topic";

interface SetRow {
  id: string;
  score: number | null;
  total: number | null;
  system: string | null;
  ended_at: string | null;
  topic: string | null;
}

/**
 * Every topic the student has studied, with its sheet, deck and QBank sets
 * gathered together (see library-topics.ts). QBank sets need an account;
 * guests get sheets and decks from this device.
 */
export function useLibraryTopics() {
  const { user, isAnonymous } = useAuth();
  const signedIn = !!user && !isAnonymous;
  const { history, deleteItem } = useStudyHistory();
  const deck = useFlashcardDeck();

  const setsQuery = useQuery({
    queryKey: ["library-qbank-sets", user?.id ?? null],
    enabled: signedIn,
    queryFn: async (): Promise<LibraryQBankSet[]> => {
      const { data, error } = await supabase
        .from("qbank_sessions")
        .select(SET_COLUMNS)
        .eq("user_id", user!.id)
        .eq("status", "completed")
        .order("ended_at", { ascending: false, nullsFirst: false })
        .limit(300);
      if (error) throw error;
      return ((data ?? []) as unknown as SetRow[])
        .filter((r) => (r.total ?? 0) > 0)
        .map((r) => ({
          id: r.id,
          topic: r.topic,
          system: r.system ?? "QBank",
          score: r.score ?? 0,
          total: r.total ?? 0,
          endedAt: r.ended_at ? new Date(r.ended_at).getTime() : 0,
        }));
    },
  });

  const topics = useMemo(
    () =>
      buildLibraryTopics(
        {
          sheets: history.map((h) => ({ id: h.id, topic: h.topic, timestamp: h.timestamp })),
          cards: deck.allCards.map((c) => ({
            topic: c.topic,
            dueAt: c.dueAt,
            createdAt: c.createdAt,
            state: c.state,
            mature: isMature(c),
            isLeech: c.isLeech,
          })),
          sets: setsQuery.data ?? [],
        },
        { canUseQBank: signedIn }
      ),
    [history, deck.allCards, setsQuery.data, signedIn]
  );

  return { topics, history, deleteSheet: deleteItem, deck, signedIn, setsLoading: signedIn && setsQuery.isLoading };
}
