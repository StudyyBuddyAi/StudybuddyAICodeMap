import {
  FAMILY_KEYS,
  SYSTEM_KEYS,
  SYSTEM_NAMES,
  systemKeyFor,
  type SystemKey,
} from "../../supabase/functions/_shared/qbank-systems.ts";
import type { CurriculumTopic } from "@/lib/qbank-suggestions";

/**
 * A student's QBank progress, from their answers alone.
 *
 * Every set is written on demand, so there is no fixed bank to show a
 * percentage of. What there is to cover is the curriculum: 13 organ systems
 * and their topics (curriculum_topics), plus the two families. Progress is
 * measured against that — how many questions in each system, how many of its
 * topics practised, and how well.
 *
 * Accuracy counts each question once, at its first answer. A retry from the
 * review queue is a second attempt at a question already counted, and letting
 * it in would let a student raise their score by re-sitting what they missed.
 */

export interface ProgressAttempt {
  questionId: string;
  isCorrect: boolean;
  createdAt: string;
  sessionId: string | null;
  /** questions.subject: a system's display name. */
  subject: string | null;
}

export interface ProgressSession {
  id: string;
  /** What the student asked for — one topic, or each topic of a mixed set. */
  topics: string[];
}

export interface SystemProgress {
  key: SystemKey;
  name: string;
  answered: number;
  correct: number;
  /** The system's curriculum topics; zero for a family, which has none. */
  topicsTotal: number;
  topicsPractised: number;
}

export interface TopicProgress {
  title: string;
  answered: number;
  correct: number;
  lastAt: number;
  system: SystemKey | null;
  /** One of the curriculum's own topics, as opposed to something typed. */
  inCurriculum: boolean;
}

export interface QBankProgress {
  answered: number;
  correct: number;
  /** Every answer, retries included. */
  attempts: number;
  /** Questions answered in the last seven days. */
  lastWeek: number;
  systems: SystemProgress[];
  curriculumTotal: number;
  curriculumPractised: number;
  /** Most recent first. */
  topics: TopicProgress[];
}

/** A topic's accuracy is shown, and ranked, once it has this many questions. */
export const MIN_TOPIC_ANSWERS = 3;

const DAY_MS = 86_400_000;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export const accuracy = (p: { answered: number; correct: number }): number | null =>
  p.answered > 0 ? Math.round((p.correct / p.answered) * 100) : null;

export function buildQBankProgress(input: {
  attempts: ProgressAttempt[];
  sessions: ProgressSession[];
  curriculum: CurriculumTopic[];
  now?: number;
}): QBankProgress {
  const now = input.now ?? Date.now();
  const curriculumByTitle = new Map(input.curriculum.map((c) => [norm(c.title), c]));
  const sessions = new Map(input.sessions.map((s) => [s.id, s.topics.map((t) => t.trim()).filter(Boolean)]));

  // The first answer to each question.
  const firsts = new Map<string, ProgressAttempt>();
  for (const a of input.attempts) {
    const prev = firsts.get(a.questionId);
    if (!prev || a.createdAt < prev.createdAt) firsts.set(a.questionId, a);
  }

  const systems = new Map<SystemKey, SystemProgress>(
    SYSTEM_KEYS.map((key) => [
      key,
      { key, name: SYSTEM_NAMES[key], answered: 0, correct: 0, topicsTotal: 0, topicsPractised: 0 },
    ])
  );
  for (const c of input.curriculum) {
    const s = systems.get(c.system as SystemKey);
    if (s) s.topicsTotal += 1;
  }

  const topics = new Map<string, TopicProgress>();
  const topicFor = (title: string): TopicProgress => {
    const key = norm(title);
    let t = topics.get(key);
    if (!t) {
      const c = curriculumByTitle.get(key);
      t = {
        title: c?.title ?? title,
        answered: 0,
        correct: 0,
        lastAt: 0,
        system: (c?.system as SystemKey | undefined) ?? systemKeyFor(title),
        inCurriculum: !!c,
      };
      topics.set(key, t);
    }
    return t;
  };

  let correct = 0;
  let lastWeek = 0;
  for (const a of firsts.values()) {
    const at = new Date(a.createdAt).getTime();
    if (a.isCorrect) correct += 1;
    if (now - at < 7 * DAY_MS) lastWeek += 1;

    const system = systemKeyFor(a.subject);
    const s = system ? systems.get(system) : undefined;
    if (s) {
      s.answered += 1;
      if (a.isCorrect) s.correct += 1;
    }

    // Which of the set's topics the question was for. One topic: that one. A
    // mix: the one topic of the system the question landed in, when exactly
    // one of them is — otherwise it counts for its system but no topic.
    const asked = a.sessionId ? sessions.get(a.sessionId) ?? [] : [];
    let target: TopicProgress | null = null;
    if (asked.length === 1) target = topicFor(asked[0]);
    else if (asked.length > 1 && system) {
      const matches = asked.map(topicFor).filter((t) => t.system === system);
      if (matches.length === 1) target = matches[0];
    }
    if (target) {
      target.answered += 1;
      if (a.isCorrect) target.correct += 1;
      target.lastAt = Math.max(target.lastAt, at);
    }
  }

  // A curriculum topic is practised once any set asked for it, mixed or not.
  const practised = new Set<string>();
  for (const asked of sessions.values()) {
    for (const t of asked) if (curriculumByTitle.has(norm(t))) practised.add(norm(t));
  }
  for (const key of practised) {
    const s = systems.get(curriculumByTitle.get(key)!.system as SystemKey);
    if (s) s.topicsPractised += 1;
  }

  const organs = SYSTEM_KEYS.filter((k) => !FAMILY_KEYS.includes(k as (typeof FAMILY_KEYS)[number]));
  return {
    answered: firsts.size,
    correct,
    attempts: input.attempts.length,
    lastWeek,
    // Organ systems in curriculum order, then the families.
    systems: [...organs, ...FAMILY_KEYS].map((k) => systems.get(k)!),
    curriculumTotal: input.curriculum.length,
    curriculumPractised: practised.size,
    topics: [...topics.values()].filter((t) => t.answered > 0).sort((a, b) => b.lastAt - a.lastAt),
  };
}

/** Topics worth another set: enough answers to judge, weakest first. */
export function weakestTopics(progress: QBankProgress, limit = 5): TopicProgress[] {
  return progress.topics
    .filter((t) => t.answered >= MIN_TOPIC_ANSWERS)
    .sort((a, b) => a.correct / a.answered - b.correct / b.answered || b.answered - a.answered)
    .slice(0, limit);
}
