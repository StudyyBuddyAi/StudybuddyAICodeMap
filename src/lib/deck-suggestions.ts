/**
 * "For you" on the Flashcards page: at most six one-tap decks, personal first.
 *
 * The QBank's suggestions (qbank-suggestions.ts), turned round for cards. A
 * set tests what a student studied; a deck keeps it. So the ranking is:
 *   1. From your sheets — written up, never carded: keep what you read.
 *   2. Weak in QBank — the topics the questions caught them out on: cards
 *      are how a missed fact stops being missed (early-access feedback:
 *      "flashcards are for remembering and reviewing the QBank").
 *   3. Today's pair, and the showdowns for the student's exam — look-alikes
 *      on one deck, the cards a student most needs to tell them apart.
 *   4. Not carded yet — a curriculum topic in a system they already study.
 * Pure, so the ordering is tested directly.
 */
import type { LibraryTopic } from "@/lib/library-topics";
import type { CurriculumTopic, ExamTarget } from "@/lib/qbank-suggestions";
import { challengesFor, type Challenge } from "@/lib/qbank-challenges";
import { matchScore, normalizeTopic } from "@/lib/topic-suggest";
import { SYSTEM_NAMES, type SystemKey } from "../../supabase/functions/_shared/qbank-systems.ts";

export type DeckSuggestionKind = "sheet" | "weak" | "pair" | "showdown" | "untouched";

export interface DeckSuggestion {
  id: string;
  kind: DeckSuggestionKind;
  eyebrow: string;
  title: string;
  hook: string;
  topics: string[];
  /** Cards across the whole deck. */
  size: number;
}

const MAX = 6;
const SIZE = 12;

const studiedLike = (title: string, studied: string[]) =>
  studied.some((s) => matchScore(s, title) >= 80 || matchScore(title, s) >= 80);

const fromChallenge = (c: Challenge, kind: DeckSuggestionKind, eyebrow: string): DeckSuggestion => ({
  id: `${kind}-${c.id}`,
  kind,
  eyebrow,
  title: c.title,
  hook: c.hook,
  topics: c.topics.map((x) => x.title),
  // Two cards a topic at least, so a three-way showdown is not a handful.
  size: Math.max(SIZE, c.topics.length * 4),
});

export function buildDeckSuggestions(input: {
  topics: LibraryTopic[];
  target: ExamTarget;
  curriculum: CurriculumTopic[];
  now?: number;
  /** Bumped by "Show others": rotates the showdowns and the untouched pick. */
  seed?: number;
  max?: number;
}): DeckSuggestion[] {
  const now = input.now ?? Date.now();
  const seed = input.seed ?? 0;
  const max = input.max ?? MAX;
  const personal: DeckSuggestion[] = [];

  // 1. A sheet with no deck behind it.
  for (const t of input.topics
    .filter((t) => t.sheets.length > 0 && !t.deck)
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .slice(0, 2)) {
    personal.push({
      id: `sheet-${t.key}`,
      kind: "sheet",
      eyebrow: "From your sheets",
      title: t.title,
      hook: "You wrote the sheet — now keep it. Cards bring it back before it fades.",
      topics: [t.title],
      size: SIZE,
    });
  }

  // 2. Where the QBank caught them out, worst first.
  for (const t of input.topics
    .filter((t) => t.weak)
    .sort((a, b) => (a.qbank?.accuracy ?? 0) - (b.qbank?.accuracy ?? 0))
    .slice(0, 2)) {
    personal.push({
      id: `weak-${t.key}`,
      kind: "weak",
      eyebrow: "Missed in QBank",
      title: t.title,
      hook: `${t.qbank?.accuracy ?? 0}% in the QBank — cards on what tripped you up.`,
      topics: [t.title],
      size: SIZE,
    });
  }

  // 3. Look-alikes, one deck each: today's pair — the same for everyone on an
  // exam that day — then the exam's other showdowns.
  const allShowdowns = challengesFor(input.target).filter((c) => c.kind === "showdown");
  const daily = allShowdowns[Math.floor(now / 86_400_000) % allShowdowns.length];
  const showdowns = allShowdowns.filter((c) => c.id !== daily.id);
  const start = showdowns.length ? (seed * 2) % showdowns.length : 0;
  const rotated = [...showdowns.slice(start), ...showdowns.slice(0, start)];

  // 4. A curriculum topic, in a system they study, with no deck or sheet yet.
  const studied = input.topics.map((t) => normalizeTopic(t.title));
  const systems = new Set(
    input.curriculum.filter((c) => studiedLike(c.title, studied)).map((c) => c.system)
  );
  const pool = input.curriculum.filter((c) => systems.has(c.system) && !studiedLike(c.title, studied));
  const untouched = pool.length ? pool[seed % pool.length] : null;

  const out: DeckSuggestion[] = [...personal.slice(0, 3), fromChallenge(daily, "pair", "Today's pair")];
  const tail: DeckSuggestion[] = untouched
    ? [
        {
          id: `untouched-${normalizeTopic(untouched.title)}`,
          kind: "untouched",
          eyebrow: "Not carded yet",
          title: untouched.title,
          hook: `High-yield in ${SYSTEM_NAMES[untouched.system as SystemKey] ?? untouched.system} — no deck on it yet.`,
          topics: [untouched.title],
          size: SIZE,
        },
      ]
    : [];
  for (const c of rotated) {
    if (out.length + tail.length >= max) break;
    out.push(fromChallenge(c, "showdown", "Tell them apart"));
  }
  return [...out, ...tail].slice(0, max);
}
