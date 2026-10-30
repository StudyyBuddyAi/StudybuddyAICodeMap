/**
 * "For you" on the QBank page: at most six one-tap sets, personal first.
 *
 * Ranking (docs/qbank/topic-selection-ux.md §3) — the curriculum tags every
 * topic high-yield, so "yield" cannot rank anything; the student's own history
 * does:
 *   1. From your Library — studied with a sheet or deck, never tested.
 *   2. Weak spot — lowest QBank accuracy on enough answers.
 *   3. Mix it — sat on its own recently and done well: now with its neighbours
 *      (blocked first, mixed later).
 *   4. Today's challenge — one card for everyone that day.
 *   5. Showdowns and scenarios for the student's exam, rotated by "Show others".
 *   6. Not touched yet — a curriculum topic in a system they practise.
 * Pure, so the ordering is tested directly.
 */
import type { LibraryTopic } from "@/lib/library-topics";
import type { ChallengeLevel } from "@/lib/qbank-types";
import { challengesFor, dailyChallenge, type Challenge } from "@/lib/qbank-challenges";
import { matchScore, normalizeTopic } from "@/lib/topic-suggest";
import { SYSTEM_NAMES, type SystemKey } from "../../supabase/functions/_shared/qbank-systems.ts";

export type ExamTarget = "step1" | "step2ck" | "mixed";

export type SuggestionKind = "library" | "weak" | "mixit" | "daily" | "showdown" | "scenario" | "untouched";

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  eyebrow: string;
  title: string;
  hook: string;
  topics: string[];
  /** Aligned with topics; null asks the generator to route that topic. */
  systems: (string | null)[];
  level: ChallengeLevel;
  size: number;
}

export interface CurriculumTopic {
  title: string;
  system: string;
  sortOrder: number;
}

const DAY = 86_400_000;
const MAX_CARDS = 6;

/** The curriculum topic a free-typed library title most plausibly is. */
function curriculumMatch(title: string, curriculum: CurriculumTopic[]): CurriculumTopic | null {
  let best: { c: CurriculumTopic; score: number } | null = null;
  for (const c of curriculum) {
    const score = Math.max(matchScore(title, c.title), matchScore(c.title, title));
    if (score >= 80 && (!best || score > best.score)) best = { c, score };
  }
  return best?.c ?? null;
}

const fromChallenge = (c: Challenge, kind: SuggestionKind, eyebrow: string): Suggestion => ({
  id: `${kind}-${c.id}`,
  kind,
  eyebrow,
  title: c.title,
  hook: c.hook,
  topics: c.topics.map((x) => x.title),
  systems: c.topics.map((x) => x.system),
  level: c.level,
  size: c.size,
});

export function buildSuggestions(input: {
  topics: LibraryTopic[];
  target: ExamTarget;
  curriculum: CurriculumTopic[];
  now?: number;
  /** Bumped by "Show others": rotates the catalogue and the untouched pick. */
  seed?: number;
  max?: number;
}): Suggestion[] {
  const now = input.now ?? Date.now();
  const seed = input.seed ?? 0;
  const max = input.max ?? MAX_CARDS;
  const personal: Suggestion[] = [];
  const used = new Set<string>();

  // 1. Studied, never tested.
  const untested = input.topics
    .filter((t) => !t.qbank && (t.sheets.length > 0 || !!t.deck))
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .slice(0, 2);
  for (const t of untested) {
    const match = curriculumMatch(t.title, input.curriculum);
    used.add(t.key);
    personal.push({
      id: `library-${t.key}`,
      kind: "library",
      eyebrow: "From your Library",
      title: t.title,
      hook: t.sheets.length > 0 ? "You wrote a sheet on it — never tested it." : "You made a deck — now try it on vignettes.",
      topics: [t.title],
      systems: [match?.system ?? null],
      level: "balanced",
      size: 5,
    });
  }

  // 2. The weakest topic.
  const weak = input.topics
    .filter((t) => t.weak && !used.has(t.key))
    .sort((a, b) => (a.qbank?.accuracy ?? 0) - (b.qbank?.accuracy ?? 0))[0];
  if (weak) {
    used.add(weak.key);
    personal.push({
      id: `weak-${weak.key}`,
      kind: "weak",
      eyebrow: "Weak spot",
      title: weak.title,
      hook: `${weak.qbank?.accuracy ?? 0}% last time — win it back.`,
      topics: [weak.title],
      systems: [curriculumMatch(weak.title, input.curriculum)?.system ?? null],
      level: "balanced",
      size: 5,
    });
  }

  // 3. Done well on its own lately → mix it with its curriculum neighbours.
  const recentGood = input.topics
    .filter(
      (t) =>
        !used.has(t.key) &&
        t.qbank &&
        !t.weak &&
        (t.qbank.accuracy ?? 0) >= 60 &&
        now - t.qbank.lastAt <= 7 * DAY
    )
    .sort((a, b) => (b.qbank?.lastAt ?? 0) - (a.qbank?.lastAt ?? 0));
  for (const t of recentGood) {
    const match = curriculumMatch(t.title, input.curriculum);
    if (!match) continue;
    const sameSystem = input.curriculum
      .filter((c) => c.system === match.system)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const at = sameSystem.findIndex((c) => c.title === match.title);
    const neighbours = [sameSystem[at - 1], sameSystem[at + 1], sameSystem[at + 2]]
      .filter((c): c is CurriculumTopic => !!c)
      .slice(0, 2);
    if (neighbours.length === 0) continue;
    used.add(t.key);
    personal.push({
      id: `mixit-${t.key}`,
      kind: "mixit",
      eyebrow: "Mix it",
      title: `${t.title} + ${neighbours.length} neighbour${neighbours.length === 1 ? "" : "s"}`,
      hook: "You've done it on its own — now mixed with what it gets confused with.",
      topics: [match.title, ...neighbours.map((n) => n.title)],
      systems: [match.system, ...neighbours.map((n) => n.system)],
      level: "balanced",
      size: 6,
    });
    break;
  }

  // 4. Today's challenge, and 5. the rotating catalogue.
  const daily = dailyChallenge(input.target, now);
  const pool = challengesFor(input.target).filter((c) => c.id !== daily.id);
  const start = pool.length > 0 ? (seed * 3) % pool.length : 0;
  const rotated = [...pool.slice(start), ...pool.slice(0, start)];

  // 6. A curriculum topic in a system the student already practises.
  const practisedSystems = new Set(
    input.topics
      .map((t) => curriculumMatch(t.title, input.curriculum)?.system)
      .filter((s): s is string => !!s)
  );
  const studied = input.topics.map((t) => normalizeTopic(t.title));
  const untouchedPool = input.curriculum.filter(
    (c) =>
      practisedSystems.has(c.system) &&
      !studied.some((s) => matchScore(s, c.title) >= 80 || matchScore(c.title, s) >= 80)
  );
  const untouched = untouchedPool.length > 0 ? untouchedPool[seed % untouchedPool.length] : null;

  const cards: Suggestion[] = [...personal.slice(0, 3), fromChallenge(daily, "daily", "Today's challenge")];
  const tail: Suggestion[] = [];
  if (untouched) {
    tail.push({
      id: `untouched-${normalizeTopic(untouched.title)}`,
      kind: "untouched",
      eyebrow: "Not touched yet",
      title: untouched.title,
      hook: `High-yield in ${SYSTEM_NAMES[untouched.system as SystemKey] ?? untouched.system} — you haven't practised it.`,
      topics: [untouched.title],
      systems: [untouched.system],
      level: "balanced",
      size: 5,
    });
  }
  for (const c of rotated) {
    if (cards.length + tail.length >= max) break;
    cards.push(fromChallenge(c, c.kind, c.kind === "showdown" ? "Showdown" : "Scenario"));
  }
  return [...cards, ...tail].slice(0, max);
}
