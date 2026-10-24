import { sameTopic, normaliseTopic } from "@/lib/topic-match";

/**
 * The Library's unit is the topic, not the tool.
 *
 * A student studies "Heart failure": a sheet to understand it, a deck to keep
 * it, QBank sets to test it. Those used to sit in separate lists, so nothing
 * said that the heart-failure deck had nine cards due while its sheet was
 * three weeks old and its QBank score was 40%. This gathers every sheet, card
 * and QBank set under the topic it belongs to, and works out what the student
 * should do next for it.
 *
 * Pure — no React, no Supabase — so the grouping and the advice are tested
 * directly.
 */

export interface LibrarySheet {
  id: string;
  topic: string;
  timestamp: number;
}

export interface LibraryCard {
  topic?: string;
  dueAt: number;
  createdAt?: number;
  /** FSRS state: 0 new, 1 learning, 2 review, 3 relearning. */
  state: number;
  mature: boolean;
  isLeech?: boolean;
}

export interface LibraryQBankSet {
  id: string;
  topic: string | null;
  system: string;
  score: number;
  total: number;
  endedAt: number;
}

export interface TopicDeck {
  /** The deck names as stored; a topic can gather more than one ("DKA", "Diabetic ketoacidosis"). */
  names: string[];
  total: number;
  due: number;
  fresh: number;
  mastered: number;
  leeches: number;
  lastAddedAt: number;
}

export interface TopicQBank {
  sets: LibraryQBankSet[];
  answered: number;
  correct: number;
  /** 0–100, or null before any question is answered. */
  accuracy: number | null;
  lastAt: number;
}

export type NextStepKind = "review" | "practice-weak" | "make-deck" | "practice" | "write-sheet" | "study";

export interface NextStep {
  kind: NextStepKind;
  label: string;
  why: string;
}

export interface LibraryTopic {
  key: string;
  title: string;
  sheets: LibrarySheet[];
  deck: TopicDeck | null;
  qbank: TopicQBank | null;
  lastActivity: number;
  /** How many of the three tools the topic has been studied with. */
  coverage: number;
  /** QBank accuracy below the bar, over enough answers to mean something. */
  weak: boolean;
  next: NextStep;
}

/** Below this, a topic's QBank result counts as a weak spot. */
export const WEAK_ACCURACY = 60;
/** …but only once this many questions have been answered on it. */
export const WEAK_MIN_ANSWERED = 3;

interface Bucket {
  key: string;
  titles: { text: string; weight: number }[];
  sheets: LibrarySheet[];
  cards: LibraryCard[];
  deckNames: Set<string>;
  sets: LibraryQBankSet[];
}

function findBucket(buckets: Bucket[], topic: string): Bucket | undefined {
  return buckets.find((b) => b.titles.some((t) => sameTopic(t.text, topic)));
}

function bucketFor(buckets: Bucket[], topic: string): Bucket {
  const existing = findBucket(buckets, topic);
  if (existing) return existing;
  const created: Bucket = { key: normaliseTopic(topic) || topic, titles: [], sheets: [], cards: [], deckNames: new Set(), sets: [] };
  buckets.push(created);
  return created;
}

export function nextStepFor(t: Pick<LibraryTopic, "sheets" | "deck" | "qbank" | "weak">, canUseQBank: boolean): NextStep {
  if (t.deck && t.deck.due > 0) {
    return {
      kind: "review",
      label: `Review ${t.deck.due} due ${t.deck.due === 1 ? "card" : "cards"}`,
      why: "Due today — reviewing now is what keeps them.",
    };
  }
  if (t.deck && t.deck.fresh > 0) {
    return {
      kind: "review",
      label: `Learn ${t.deck.fresh} new ${t.deck.fresh === 1 ? "card" : "cards"}`,
      why: "Not studied yet — the deck starts working once you see them.",
    };
  }
  if (t.weak && canUseQBank) {
    return {
      kind: "practice-weak",
      label: "Practise this weak spot",
      why: `${t.qbank?.accuracy ?? 0}% correct so far — another set closes the gap.`,
    };
  }
  if (t.sheets.length > 0 && !t.deck) {
    return { kind: "make-deck", label: "Make a deck", why: "You've read it — cards make it stick." };
  }
  if (t.deck && !t.qbank && canUseQBank) {
    return { kind: "practice", label: "Test it in the QBank", why: "Cards learned — now apply them to vignettes." };
  }
  if (t.sheets.length === 0) {
    return { kind: "write-sheet", label: "Write the study sheet", why: "No sheet yet — the full picture in one place." };
  }
  if (t.deck) {
    return { kind: "study", label: "Study the deck early", why: "Nothing due — an early pass still counts." };
  }
  return { kind: "practice", label: "Practise again", why: "Keep it sharp with a fresh set." };
}

export function buildLibraryTopics(
  input: { sheets: LibrarySheet[]; cards: LibraryCard[]; sets: LibraryQBankSet[] },
  opts: { now?: number; canUseQBank?: boolean } = {}
): LibraryTopic[] {
  const now = opts.now ?? Date.now();
  const canUseQBank = opts.canUseQBank ?? true;
  const buckets: Bucket[] = [];

  // Sheets first: the student named these topics themselves, so their titles
  // are the best ones to show.
  for (const s of input.sheets) {
    const topic = s.topic?.trim() || "Untitled";
    const b = bucketFor(buckets, topic);
    b.sheets.push(s);
    b.titles.push({ text: topic, weight: 3 });
  }
  for (const c of input.cards) {
    const topic = c.topic?.trim() || "Untitled";
    const b = bucketFor(buckets, topic);
    b.cards.push(c);
    b.deckNames.add(c.topic || "Untitled");
    if (!b.titles.some((t) => t.text === topic)) b.titles.push({ text: topic, weight: 2 });
  }
  for (const set of input.sets) {
    const topic = set.topic?.trim() || set.system;
    if (!topic) continue;
    const b = bucketFor(buckets, topic);
    b.sets.push(set);
    if (!b.titles.some((t) => t.text === topic)) b.titles.push({ text: topic, weight: 1 });
  }

  return buckets.map((b) => {
    const sheets = [...b.sheets].sort((x, y) => y.timestamp - x.timestamp);

    let deck: TopicDeck | null = null;
    if (b.cards.length > 0) {
      deck = { names: [...b.deckNames], total: 0, due: 0, fresh: 0, mastered: 0, leeches: 0, lastAddedAt: 0 };
      for (const c of b.cards) {
        deck.total += 1;
        if (c.state === 0) deck.fresh += 1;
        else if (c.dueAt <= now) deck.due += 1;
        if (c.mature) deck.mastered += 1;
        if (c.isLeech) deck.leeches += 1;
        deck.lastAddedAt = Math.max(deck.lastAddedAt, c.createdAt ?? 0);
      }
    }

    let qbank: TopicQBank | null = null;
    if (b.sets.length > 0) {
      const sets = [...b.sets].sort((x, y) => y.endedAt - x.endedAt);
      const answered = sets.reduce((n, s) => n + s.total, 0);
      const correct = sets.reduce((n, s) => n + s.score, 0);
      qbank = {
        sets,
        answered,
        correct,
        accuracy: answered > 0 ? Math.round((correct / answered) * 100) : null,
        lastAt: sets[0].endedAt,
      };
    }

    const weak = !!qbank && qbank.accuracy !== null && qbank.answered >= WEAK_MIN_ANSWERED && qbank.accuracy < WEAK_ACCURACY;
    const lastActivity = Math.max(sheets[0]?.timestamp ?? 0, deck?.lastAddedAt ?? 0, qbank?.lastAt ?? 0);
    const title = [...b.titles].sort((x, y) => y.weight - x.weight || x.text.length - y.text.length)[0]?.text ?? b.key;
    const partial = { sheets, deck, qbank, weak };

    return {
      key: b.key,
      title,
      ...partial,
      lastActivity,
      coverage: (sheets.length > 0 ? 1 : 0) + (deck ? 1 : 0) + (qbank ? 1 : 0),
      next: nextStepFor(partial, canUseQBank),
    };
  });
}

export type LibraryFilter = "all" | "due" | "weak" | "gaps";
export type LibrarySort = "recent" | "due" | "weakest" | "az";

export function filterAndSortTopics(
  topics: LibraryTopic[],
  { filter, sort, query }: { filter: LibraryFilter; sort: LibrarySort; query: string }
): LibraryTopic[] {
  const q = normaliseTopic(query);
  const list = topics.filter((t) => {
    if (q && !normaliseTopic(t.title).includes(q) && !t.deck?.names.some((n) => normaliseTopic(n).includes(q))) {
      return false;
    }
    if (filter === "due") return (t.deck?.due ?? 0) > 0;
    if (filter === "weak") return t.weak;
    if (filter === "gaps") return t.coverage < 3;
    return true;
  });
  const accuracy = (t: LibraryTopic) => t.qbank?.accuracy ?? 101;
  return list.sort((a, b) => {
    if (sort === "due") return (b.deck?.due ?? 0) - (a.deck?.due ?? 0) || b.lastActivity - a.lastActivity;
    if (sort === "weakest") return accuracy(a) - accuracy(b) || b.lastActivity - a.lastActivity;
    if (sort === "az") return a.title.localeCompare(b.title);
    return b.lastActivity - a.lastActivity;
  });
}
