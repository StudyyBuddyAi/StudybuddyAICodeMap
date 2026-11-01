import type { TopicCoverage } from "./qbank-types";
import type { BlueprintRow } from "./qbank-wave-runner";

/**
 * What the student's history did to a set, in words a student reads.
 *
 * The server decides (supabase/functions/_shared/qbank-repetition.ts): rows
 * assigned to concepts the student has not met, a revisit of one they missed,
 * a re-test of one met long ago, and how much of each topic's concept list
 * they have now been asked. These turn that into the one line on the waiting
 * screen and the note on the summary page. They never see a concept itself —
 * the server keeps those, since a concept named before the question is a
 * concept answered before the question.
 */

/** The first wave's plan, summarised for the waiting screen. Null when the writer chose freely. */
export function memoryNote(rows: BlueprintRow[]): string | null {
  const count = (mode: BlueprintRow["mode"]) => rows.filter((r) => r.mode === mode).length;
  const fresh = count("new");
  const revisit = count("revisit");
  const retest = count("retest");
  const parts: string[] = [];
  if (fresh) {
    parts.push(fresh === rows.length ? "concepts you haven't been asked yet" : `${fresh} new concept${fresh === 1 ? "" : "s"}`);
  }
  if (revisit) parts.push(`${revisit === 1 ? "a concept" : `${revisit} concepts`} you missed before, asked a new way`);
  if (retest) parts.push(`${retest === 1 ? "a concept" : `${retest} concepts`} from a while back`);
  return parts.length ? `Built from your history: ${parts.join(", ")}.` : null;
}

/** Reads the server's coverage list, dropping anything malformed rather than trusting it. */
export function parseCoverage(raw: unknown): TopicCoverage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .filter((c) => typeof c.topic === "string" && c.topic && Number.isFinite(c.total) && Number.isFinite(c.covered))
    .map((c) => ({
      topic: c.topic as string,
      examTrack: c.examTrack === "step2ck" ? "step2ck" : "step1",
      total: Number(c.total),
      covered: Number(c.covered),
      exhausted: c.exhausted === true,
      broader: typeof c.broader === "string" && c.broader ? c.broader : null,
    }));
}

/** Later reports replace earlier ones for the same topic and track; other topics are kept. */
export function mergeCoverage(earlier: TopicCoverage[], later: TopicCoverage[]): TopicCoverage[] {
  const key = (c: TopicCoverage) => `${c.topic.toLowerCase()}|${c.examTrack}`;
  const merged = new Map(earlier.map((c) => [key(c), c]));
  for (const c of later) merged.set(key(c), c);
  return [...merged.values()];
}

export interface TopicStanding {
  topic: string;
  covered: number;
  total: number;
  /** Every concept on every track the topic was asked on has been met. */
  exhausted: boolean;
  broader: string | null;
}

/**
 * One line per topic, its tracks combined — a mixed-exam set reports Step 1
 * and Step 2 CK separately, and a student thinks of one topic. Used-up topics
 * first, since those are the ones with something to do about them.
 */
export function topicStandings(coverage: TopicCoverage[] | undefined): TopicStanding[] {
  const byTopic = new Map<string, TopicStanding>();
  for (const c of coverage ?? []) {
    if (c.total <= 0) continue;
    const key = c.topic.toLowerCase();
    const had = byTopic.get(key);
    byTopic.set(
      key,
      had
        ? {
            topic: had.topic,
            covered: had.covered + Math.min(c.covered, c.total),
            total: had.total + c.total,
            exhausted: had.exhausted && c.exhausted,
            broader: had.broader ?? c.broader,
          }
        : { topic: c.topic, covered: Math.min(c.covered, c.total), total: c.total, exhausted: c.exhausted, broader: c.broader }
    );
  }
  return [...byTopic.values()].sort((a, b) => Number(b.exhausted) - Number(a.exhausted));
}
