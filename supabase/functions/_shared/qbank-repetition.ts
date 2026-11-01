import type { ExamTrack } from "./qbank-prompt.ts";

/**
 * Cross-session repetition: what a student has already been asked about a
 * topic, and what their next set should ask instead.
 *
 * Every set used to be written blind. The only duplication guard was the list
 * of subtopics an earlier wave of the SAME set had covered, so a student who
 * typed "warfarin" again tomorrow got the same five facts again: measured in
 * docs/qbank/repetition-study-2026-11.md, 67% of the questions in sessions
 * two to four re-tested a concept from an earlier session, and a third of the
 * live repeats were concepts the student had already answered correctly.
 *
 * This module is the policy, and only the policy — no I/O, so every rule here
 * is a unit test away from being checked. qbank-memory.ts loads the inputs and
 * qbank-prompt.ts renders the outputs.
 *
 * ── The model ───────────────────────────────────────────────────────────────
 *
 * A THREAD is one thing the student can be asked about: a blueprint concept
 * (every item written on it, in any set), or — for an item no blueprint
 * covers — that item plus the items written later to revisit it. A thread's
 * state comes from what the student did with its items, and its state decides
 * what the next set may do with it:
 *
 *   recent       met lately, answered right or not yet answered → do not re-test
 *   cooling      answered wrongly, less than missSpacingDays ago → do not re-test
 *                yet; re-sitting the item itself is the review queue's job
 *   due-revisit  answered wrongly at least missSpacingDays ago → at most one
 *                row in five revisits it, as a NEW item from a new angle
 *   due-retest   met long enough ago that a fresh item is spacing, not
 *                repetition → fair game again
 *
 * Items the QA gate or the second read held back never reached the student,
 * so they are not "met"; a blueprint concept whose items keep being held is
 * retried once and then left alone.
 */

export const REPETITION_VERSION = "r1";

export const REPETITION_POLICY = {
  /** A concept answered correctly is not re-tested for this long. */
  correctRestDays: 21,
  /** One given but not answered (the set was abandoned, say) rests this long. */
  pendingRestDays: 7,
  /**
   * A missed concept waits this long before a new item revisits it. Shorter
   * than this and the student is answering from the explanation they just
   * read, which tests short-term memory rather than learning — the same reason
   * the review queue waits twenty hours.
   */
  missSpacingDays: 2,
  /** Held-back attempts a blueprint concept gets before it is skipped. */
  heldRetries: 1,
  /** Do-not-re-test lines sent to the writer for one topic. */
  ledgerLinesPerTopic: 30,
  /** …and in all, however many topics the wave touches. */
  ledgerLinesTotal: 40,
  /** Floor per topic when a wave touches several. */
  ledgerLinesMinPerTopic: 6,
} as const;

const DAY_MS = 86_400_000;

/**
 * The key a topic is stored and matched under. Kept deliberately close to what
 * Postgres can compute for rows written before keys existed —
 * lower(regexp_replace(btrim(x), '\s+', ' ', 'g')) in qbank_topic_history — so
 * a legacy row and a new one typed the same way meet.
 */
export function topicKey(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** One of the student's earlier items, as qbank_topic_history returns it. */
export interface HistoryItem {
  id: string;
  createdAt: string;
  generationId: string | null;
  /** generation_meta.topicKey — the canonical key, on rows written since keys existed. */
  storedKey: string | null;
  /** The key of what the student typed: the row's focus, else its requested topic. */
  rawKey: string;
  examTrack: ExamTrack | null;
  /** The blueprint concept the item was written on, when one was assigned. */
  concept: { blueprint: string; id: string } | null;
  /** The item this one was written to revisit, when it was. */
  revisitOf: string | null;
  subtopic: string;
  teachingPoint: string;
  leadIn: string;
  /** Reached the student: not gate-blocked, not disputed by the second read. */
  playable: boolean;
  lastAttemptAt: string | null;
  /** The latest attempt's verdict; null for no attempt or an omitted answer. */
  lastCorrect: boolean | null;
}

export type ThreadStatus = "recent" | "cooling" | "due-revisit" | "due-retest";

export interface Thread {
  key: string;
  examTrack: ExamTrack | null;
  concept: { blueprint: string; id: string } | null;
  /** The thread's first item — what a revisit points back to. */
  rootId: string;
  /** Its most recent item that reached the student; null when none did. */
  latest: HistoryItem | null;
  /** When the student last met it: their last answer, or the newest item if that came after. */
  seenAt: number;
  outcome: "correct" | "missed" | "pending" | "unseen";
  status: ThreadStatus | null;
  /** Items written for it that never reached the student. */
  held: number;
  playable: number;
  /** Every generation it appeared in, so a set never re-tests its own items. */
  generations: Set<string>;
}

export interface BlueprintConcept {
  id: string;
  text: string;
  tier: "core" | "standard" | "extended";
}

export interface Blueprint {
  id: string;
  concepts: BlueprintConcept[];
  broader: string | null;
}

/** What one plan row's item must turn on. */
export interface RowAssignment {
  mode: "new" | "revisit" | "retest";
  /** The concept or fact, as the writer is shown it. */
  text: string;
  conceptId: string | null;
  blueprintId: string | null;
  /** The thread's root item, for a revisit or a re-test of one. */
  revisitOf: string | null;
  /** The earlier question, quoted so the new one goes at it differently. */
  earlierLeadIn: string | null;
}

/** Everything known about one requested topic. */
export interface TopicMemory {
  /** The canonical key new rows are stored under. */
  key: string;
  canonical: string;
  threads: Thread[];
  /** Ready blueprints for this topic, per exam track. */
  blueprints: Partial<Record<ExamTrack, Blueprint>>;
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Groups a topic's items into threads and decides what each one is due for.
 *
 * Grouped by blueprint concept where an item has one, so every item written on
 * "protein C depletion causes skin necrosis" is one thing however many sets it
 * appeared in. Otherwise by the item it revisits (or itself), which is what
 * stops a missed item that has since been revisited — and answered — from
 * being offered for revisiting forever.
 */
export function buildThreads(items: HistoryItem[], now: number = Date.now()): Thread[] {
  const groups = new Map<string, HistoryItem[]>();
  for (const item of items) {
    const key = item.concept
      ? `concept:${item.concept.blueprint}:${item.concept.id}`
      : `item:${item.revisitOf ?? item.id}`;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  const threads: Thread[] = [];
  for (const [key, list] of groups) {
    const byAge = [...list].sort((a, b) => time(a.createdAt) - time(b.createdAt));
    const seen = byAge.filter((i) => i.playable);
    const root = list.find((i) => !i.revisitOf) ?? byAge[0];
    const thread: Thread = {
      key,
      examTrack: (seen[seen.length - 1] ?? byAge[byAge.length - 1]).examTrack,
      concept: list.find((i) => i.concept)?.concept ?? null,
      rootId: key.startsWith("item:") ? key.slice(5) : root.id,
      latest: seen[seen.length - 1] ?? null,
      seenAt: 0,
      outcome: "unseen",
      status: null,
      held: list.length - seen.length,
      playable: seen.length,
      generations: new Set(list.map((i) => i.generationId).filter((g): g is string => !!g)),
    };

    if (seen.length > 0) {
      const answered = seen
        .filter((i) => i.lastAttemptAt)
        .sort((a, b) => time(a.lastAttemptAt) - time(b.lastAttemptAt));
      const lastAnswer = answered[answered.length - 1] ?? null;
      const newest = seen[seen.length - 1];
      // A newer item given after the last answer — a revisit not yet reached,
      // say — is what the student met last, and it has no verdict yet.
      const pendingNewer = !lastAnswer || time(newest.createdAt) > time(lastAnswer.lastAttemptAt);

      if (pendingNewer || lastAnswer.lastCorrect === null) {
        thread.outcome = "pending";
        thread.seenAt = Math.max(time(newest.createdAt), time(lastAnswer?.lastAttemptAt));
      } else {
        thread.outcome = lastAnswer.lastCorrect ? "correct" : "missed";
        thread.seenAt = time(lastAnswer.lastAttemptAt);
      }

      const ageDays = (now - thread.seenAt) / DAY_MS;
      const P = REPETITION_POLICY;
      if (thread.outcome === "missed") {
        thread.status = ageDays < P.missSpacingDays ? "cooling" : "due-revisit";
      } else {
        const rest = thread.outcome === "correct" ? P.correctRestDays : P.pendingRestDays;
        thread.status = ageDays < rest ? "recent" : "due-retest";
      }
    }
    threads.push(thread);
  }
  return threads;
}

const stripMarkdown = (s: string) => s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The fact an item turned on, as one line: its subtopic and its teaching point. */
export function factOf(item: HistoryItem): { subtopic: string; fact: string } {
  return {
    subtopic: stripMarkdown(item.subtopic) || "Untitled",
    fact: clip(stripMarkdown(item.teachingPoint), 240),
  };
}

/** A topic's do-not-re-test list, as the writer will see it. */
export interface LedgerSection {
  topic: string;
  entries: { subtopic: string; fact: string }[];
}

/**
 * What the writer must not test again, per topic, most recent first.
 *
 * Only threads the student met lately — recent, or missed too recently to
 * revisit. Threads that are due are left off on purpose: a revisit row asks for
 * them explicitly, and a re-test is what spacing is for.
 *
 * Blueprint concepts are listed too, by what their items actually taught rather
 * than by the concept they were assigned. Measured on the shipped code, the
 * writer does not always keep to its assignment: handed a thin concept
 * ("warfarin toxicity presents with bleeding"), it fell back to a famous fact
 * the student had already met (factor VII falls first), and without this list
 * nothing told it that fact was taken.
 */
export function buildLedger(memories: TopicMemory[]): LedgerSection[] {
  const P = REPETITION_POLICY;
  const perTopic =
    memories.length <= 1
      ? P.ledgerLinesPerTopic
      : Math.max(P.ledgerLinesMinPerTopic, Math.floor(P.ledgerLinesTotal / memories.length));

  return memories
    .map((m) => {
      const entries = m.threads
        .filter((t) => t.latest && (t.status === "recent" || t.status === "cooling"))
        .sort((a, b) => b.seenAt - a.seenAt)
        .slice(0, perTopic)
        .map((t) => factOf(t.latest!));
      return { topic: m.canonical, entries };
    })
    .filter((s) => s.entries.length > 0);
}

/** One plan row, as far as assignment cares. */
export interface AssignableRow {
  index: number;
  examTrack: ExamTrack;
  /** The canonical key of the row's topic. */
  topicKey: string;
}

/** A blueprint's standing after this wave: how much of the topic the student has met. */
export interface Coverage {
  topic: string;
  examTrack: ExamTrack;
  total: number;
  /** Concepts the student has met, counting this wave's new ones. */
  covered: number;
  /** No concept left that the student has not met. */
  exhausted: boolean;
  broader: string | null;
}

const TIER_ORDER: Record<BlueprintConcept["tier"], number> = { core: 0, standard: 1, extended: 2 };

function shuffle<T>(values: T[], random: () => number): T[] {
  const pool = [...values];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

/** Revisit rows a wave of `count` may hold: one in five, rounded so a wave of three still gets one. */
export const revisitSlots = (count: number) => Math.floor((count + 2) / 5);

/**
 * Decides what each row of a wave turns on.
 *
 * In this order:
 *   1. Revisits — a missed concept, due, on the row's own topic and track — at
 *      most one row in five. Oldest miss first.
 *   2. Where the row's topic has a blueprint: a concept the student has not
 *      met, core before standard before extended, shuffled within a tier so two
 *      students' first sets are not identical.
 *   3. Then one met long enough ago to be due a re-test, oldest first.
 *   4. Then, the topic exhausted, the one met longest ago — repetition is now
 *      unavoidable, so it is spaced as far as it can be and asked from a new
 *      angle. Never one met in this very set, and never one cooling off from
 *      a recent miss.
 * A row with no blueprint and no revisit gets nothing, and the ledger guards it.
 *
 * Rows are visited in a shuffled order so a revisit lands on any position,
 * not always question one.
 */
export function assignRows(
  rows: AssignableRow[],
  memories: Map<string, TopicMemory>,
  generationId: string,
  random: () => number = Math.random
): { assignments: Map<number, RowAssignment>; coverage: Coverage[] } {
  const assignments = new Map<number, RowAssignment>();
  const usedThreads = new Set<string>();
  const usedConcepts = new Set<string>();
  const order = shuffle(rows, random);

  // Blueprint concept → its thread, per blueprint, built once.
  const conceptThreads = new Map<string, Thread>();
  for (const m of memories.values()) {
    for (const t of m.threads) if (t.concept) conceptThreads.set(`${t.concept.blueprint}:${t.concept.id}`, t);
  }
  const blueprintFor = (row: AssignableRow) => memories.get(row.topicKey)?.blueprints[row.examTrack] ?? null;
  const conceptText = (bp: Blueprint | null, t: Thread) =>
    bp && t.concept?.blueprint === bp.id ? bp.concepts.find((c) => c.id === t.concept!.id)?.text ?? null : null;

  // 1. Revisits.
  let slots = revisitSlots(rows.length);
  for (const row of order) {
    if (slots <= 0) break;
    const m = memories.get(row.topicKey);
    if (!m) continue;
    const due = m.threads
      .filter(
        (t) =>
          t.status === "due-revisit" &&
          t.latest &&
          !usedThreads.has(t.key) &&
          (t.examTrack === null || t.examTrack === row.examTrack)
      )
      .sort((a, b) => a.seenAt - b.seenAt)[0];
    if (!due) continue;

    const bp = blueprintFor(row);
    const text = conceptText(bp, due);
    assignments.set(row.index, {
      mode: "revisit",
      text: text ?? factOf(due.latest!).fact,
      conceptId: text ? due.concept!.id : null,
      blueprintId: text ? bp!.id : null,
      revisitOf: due.rootId,
      earlierLeadIn: due.latest!.leadIn || null,
    });
    usedThreads.add(due.key);
    if (text) usedConcepts.add(`${bp!.id}:${due.concept!.id}`);
    slots--;
  }

  // 2–4. Blueprint concepts.
  const shuffledConcepts = new Map<string, BlueprintConcept[]>();
  const conceptsOf = (bp: Blueprint) => {
    let list = shuffledConcepts.get(bp.id);
    if (!list) {
      list = shuffle(bp.concepts, random).sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
      shuffledConcepts.set(bp.id, list);
    }
    return list;
  };
  const unseen = (bp: Blueprint, c: BlueprintConcept) => {
    const t = conceptThreads.get(`${bp.id}:${c.id}`);
    return !t || (t.playable === 0 && t.held <= REPETITION_POLICY.heldRetries);
  };

  for (const row of order) {
    if (assignments.has(row.index)) continue;
    const bp = blueprintFor(row);
    if (!bp) continue;
    const free = conceptsOf(bp).filter((c) => !usedConcepts.has(`${bp.id}:${c.id}`));

    let pick: BlueprintConcept | undefined = free.find((c) => unseen(bp, c));
    let mode: RowAssignment["mode"] = "new";
    if (!pick) {
      const met = free
        .map((c) => ({ c, t: conceptThreads.get(`${bp.id}:${c.id}`) }))
        .filter((x): x is { c: BlueprintConcept; t: Thread } => !!x.t && x.t.playable > 0)
        .filter((x) => !x.t.generations.has(generationId) && x.t.status !== "cooling");
      const due = met.filter((x) => x.t.status === "due-retest" || x.t.status === "due-revisit");
      const choice = (due.length ? due : met).sort((a, b) => a.t.seenAt - b.t.seenAt)[0];
      pick = choice?.c;
      // Named for why it is back, which is what the writer is told: a miss is
      // revisited, anything else re-tested.
      mode = choice?.t.status === "due-revisit" ? "revisit" : "retest";
    }
    if (!pick) continue;

    const t = conceptThreads.get(`${bp.id}:${pick.id}`);
    assignments.set(row.index, {
      mode,
      text: pick.text,
      conceptId: pick.id,
      blueprintId: bp.id,
      revisitOf: mode === "new" ? null : t?.rootId ?? null,
      earlierLeadIn: mode === "new" ? null : t?.latest?.leadIn || null,
    });
    usedConcepts.add(`${bp.id}:${pick.id}`);
  }

  // Coverage of every blueprint this wave drew on.
  const coverage: Coverage[] = [];
  const reported = new Set<string>();
  for (const row of rows) {
    const m = memories.get(row.topicKey);
    const bp = blueprintFor(row);
    if (!m || !bp || reported.has(bp.id)) continue;
    reported.add(bp.id);
    const met = (c: BlueprintConcept) =>
      usedConcepts.has(`${bp.id}:${c.id}`) || (conceptThreads.get(`${bp.id}:${c.id}`)?.playable ?? 0) > 0;
    const covered = bp.concepts.filter(met).length;
    const skipped = bp.concepts.filter((c) => !met(c) && !unseen(bp, c)).length;
    coverage.push({
      topic: m.canonical,
      examTrack: row.examTrack,
      total: bp.concepts.length,
      covered,
      exhausted: covered + skipped >= bp.concepts.length,
      broader: bp.broader,
    });
  }

  return { assignments, coverage };
}
