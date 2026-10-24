import { useMemo } from "react";
import { useStudyHistory } from "@/hooks/use-study-history";
import { useFlashcardDeck } from "@/hooks/use-flashcard-deck";
import { sameTopic } from "@/lib/topic-match";

/**
 * Which curriculum topics the student has actually touched.
 *
 * The roadmap previously showed a topic count and nothing else — the same list
 * on your first day and your hundredth. This cross-references the curriculum
 * against work the student has really done, so the page can show coverage
 * instead of inventory.
 *
 * Matching is deliberately conservative. A topic counts as covered only when a
 * saved sheet or a deck names it closely enough that a person would agree, and
 * an unsure match counts as *not* covered — overstating progress on a study
 * tool is worse than understating it.
 */

export type TopicState = "untouched" | "studied" | "drilled";

export interface TopicProgress {
  state: TopicState;
  /** Cards in a deck whose topic matches this one. */
  cards: number;
}

export function useCurriculumProgress(titles: string[]) {
  const { history } = useStudyHistory();
  const { allCards } = useFlashcardDeck();

  return useMemo(() => {
    const sheetTopics = history.map((h) => h.topic).filter(Boolean);

    const cardsByTopic = new Map<string, number>();
    for (const c of allCards) {
      const key = c.topic || "";
      if (!key) continue;
      cardsByTopic.set(key, (cardsByTopic.get(key) ?? 0) + 1);
    }

    const progress = new Map<string, TopicProgress>();

    for (const title of titles) {
      let cards = 0;
      for (const [deckTopic, count] of cardsByTopic) {
        if (sameTopic(deckTopic, title)) cards += count;
      }
      const studied = sheetTopics.some((t) => sameTopic(t, title));

      progress.set(title, {
        // A deck is stronger evidence than a sheet: you generated it *and*
        // chose to keep it.
        state: cards > 0 ? "drilled" : studied ? "studied" : "untouched",
        cards,
      });
    }

    return progress;
  }, [titles, history, allCards]);
}
