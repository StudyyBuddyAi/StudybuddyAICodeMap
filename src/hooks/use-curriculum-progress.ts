import { useMemo } from "react";
import { useStudyHistory } from "@/hooks/use-study-history";
import { useFlashcardDeck } from "@/hooks/use-flashcard-deck";

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

/** Lowercase, strip punctuation and collapse whitespace. */
const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * True when two topic names refer to the same thing.
 *
 * Exact match after normalising, or one fully containing the other as a whole
 * phrase — "heart failure" matches "Heart Failure" and "Chronic heart failure",
 * but "failure" alone does not match "heart failure", because a bare word
 * overlaps far too much across a medical curriculum.
 */
function sameTopic(a: string, b: string): boolean {
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // Require the shorter side to be a multi-word phrase before allowing
  // containment, so single common words cannot carry a match.
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  if (shorter.split(" ").length < 2) return false;
  return longer.includes(shorter);
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
