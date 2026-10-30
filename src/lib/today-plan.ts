import type { LibraryTopic } from "@/lib/library-topics";

/**
 * What the dashboard says to do today, most urgent first.
 *
 * The dashboard used to show the week's numbers twice (boxes, then rings) and
 * leave the student to work out what they meant. This turns the same data into
 * a short list of things to do: cards that are due now, the QBank set left
 * half-done, weak spots, then each topic's next step from the Library. Pure,
 * so the ordering is tested directly.
 */

export type PlanTarget =
  | { kind: "route"; to: string; state?: Record<string, string> }
  | { kind: "sign-in" };

export interface PlanItem {
  id: string;
  kind: "review" | "resume" | "retry" | "weak" | "next" | "start";
  title: string;
  why: string;
  cta: string;
  target: PlanTarget;
}

export interface UnfinishedSetInput {
  id: string;
  topic: string;
  answered: number;
  total: number;
}

/** A rough pace for a review: read, recall, flip, rate. */
const SECONDS_PER_CARD = 10;
const MAX_ITEMS = 5;

export function buildTodayPlan(input: {
  topics: LibraryTopic[];
  dueTotal: number;
  unfinished: UnfinishedSetInput | null;
  signedIn: boolean;
  /** QBank questions due back from the review queue (missed or marked). */
  qbankDue?: number;
}): PlanItem[] {
  const { topics, dueTotal, unfinished, signedIn } = input;
  const qbankDue = input.qbankDue ?? 0;
  const items: PlanItem[] = [];
  const used = new Set<string>();

  if (dueTotal > 0) {
    const decks = topics.filter((t) => (t.deck?.due ?? 0) > 0);
    const minutes = Math.max(1, Math.round((dueTotal * SECONDS_PER_CARD) / 60));
    items.push({
      id: "review",
      kind: "review",
      title: `Review ${dueTotal} due ${dueTotal === 1 ? "card" : "cards"}`,
      why: `${decks.length > 1 ? `From ${decks.length} decks · ` : ""}about ${minutes} min — due today is when they stick.`,
      cta: "Start review",
      target: { kind: "route", to: "/flashcards?review=due" },
    });
    decks.forEach((t) => used.add(t.key));
  }

  if (unfinished && unfinished.answered < unfinished.total) {
    items.push({
      id: `resume-${unfinished.id}`,
      kind: "resume",
      title: `Finish your ${unfinished.topic} set`,
      why: `${unfinished.answered} of ${unfinished.total} answered — pick up at question ${unfinished.answered + 1}.`,
      cta: "Resume",
      target: { kind: "route", to: `/qbank/session?session=${unfinished.id}` },
    });
  }

  // Missed questions are back once they are a day old, marked ones at once.
  // After cards and an unfinished set: it is the same kind of debt, smaller.
  if (signedIn && qbankDue > 0) {
    items.push({
      id: "qbank-retry",
      kind: "retry",
      title: `Retry ${qbankDue} QBank question${qbankDue === 1 ? "" : "s"}`,
      why: "Ones you missed or marked — a day later is when a retry tests what stuck. Free.",
      cta: "Retry",
      target: { kind: "route", to: "/qbank" },
    });
  }

  if (signedIn) {
    const weak = topics
      .filter((t) => t.weak && !used.has(t.key))
      .sort((a, b) => (a.qbank?.accuracy ?? 0) - (b.qbank?.accuracy ?? 0))
      .slice(0, 2);
    for (const t of weak) {
      used.add(t.key);
      items.push({
        id: `weak-${t.key}`,
        kind: "weak",
        title: `Practise ${t.title}`,
        why: `${t.qbank?.accuracy ?? 0}% correct so far — your weakest topic${weak.length > 1 ? "s" : ""} this week.`,
        cta: "Practise",
        target: { kind: "route", to: "/qbank", state: { topic: t.title } },
      });
    }
  }

  // Then each recent topic's next step, as the Library advises it.
  const nexts = [...topics]
    .filter((t) => !used.has(t.key))
    .sort((a, b) => b.lastActivity - a.lastActivity);
  for (const t of nexts) {
    if (items.length >= MAX_ITEMS) break;
    const k = t.next.kind;
    let target: PlanTarget | null = null;
    if (k === "make-deck") target = { kind: "route", to: "/flashcards", state: { prefill: t.title } };
    else if (k === "write-sheet") target = { kind: "route", to: "/sheets", state: { topic: t.title } };
    else if ((k === "practice" || k === "practice-weak") && signedIn)
      target = { kind: "route", to: "/qbank", state: { topic: t.title } };
    else if (k === "review") target = { kind: "route", to: `/flashcards?deck=${encodeURIComponent(t.deck?.names[0] ?? t.title)}` };
    if (!target) continue;
    used.add(t.key);
    items.push({ id: `next-${t.key}`, kind: "next", title: `${t.title}: ${t.next.label.charAt(0).toLowerCase()}${t.next.label.slice(1)}`, why: t.next.why, cta: "Go", target });
  }

  if (items.length === 0) {
    items.push({
      id: "start",
      kind: "start",
      title: topics.length === 0 ? "Start your first topic" : "You're all caught up — start a new topic",
      why: "Name any topic: a study sheet first, then a deck and questions on it.",
      cta: "New sheet",
      target: { kind: "route", to: "/sheets" },
    });
  }

  return items.slice(0, MAX_ITEMS);
}

/** The last seven study days, oldest first, for the week strip. */
export function lastSevenDays(activeDays: Set<string>, dayKey: (t: number) => string, now = Date.now()) {
  const DAY = 86_400_000;
  return Array.from({ length: 7 }, (_, i) => {
    const t = now - (6 - i) * DAY;
    return { key: dayKey(t), date: new Date(t), active: activeDays.has(dayKey(t)), today: i === 6 };
  });
}
