import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import type { CortiConfig } from "./corti.ts";
import { BLUEPRINT_VERSION, buildBlueprint } from "./qbank-blueprint.ts";
import type { PersistInput } from "./qbank-persist.ts";
import type { BatchPlan, ExamTrack, SystemKey } from "./qbank-prompt.ts";
import {
  REPETITION_VERSION,
  assignRows,
  buildLedger,
  buildThreads,
  topicKey,
  type Blueprint,
  type BlueprintConcept,
  type Coverage,
  type HistoryItem,
  type LedgerSection,
  type TopicMemory,
} from "./qbank-repetition.ts";

/**
 * The I/O around qbank-repetition.ts: reads a student's history and the topic
 * blueprints, applies the policy to a wave's plan, and starts the blueprint
 * builds a topic is missing.
 *
 * Everything here fails OPEN. A history that cannot be read — the migration
 * not yet applied, a timeout — means the wave is written blind, exactly as
 * every wave was before this existed. That is a worse set, never a failed one,
 * and the row records that it happened (generation_meta.repetition.memory).
 */

/** Rows of history read per wave. A heavy topic holds far fewer; this is a bound, not a target. */
const HISTORY_LIMIT = 300;

/**
 * Blueprint builds one wave may start. A curriculum block can name twenty
 * topics; they fill in over the student's next sets rather than twenty Corti
 * calls at once.
 */
const MAX_BUILDS_PER_WAVE = 2;

type Log = (event: string, fields?: Record<string, unknown>) => void;

/** One requested topic, as the handler resolved it. */
export interface WaveTopic {
  /** As typed, or as the curriculum named it. Plan rows' `focus` is this. */
  topic: string;
  system: SystemKey;
  /** The standard name the topic is stored and matched under. */
  canonical: string;
  /**
   * Whether `canonical` is good enough to build a SHARED blueprint under: the
   * router's name, a curriculum title, or one an earlier wave of the set
   * stored. Not a later wave's fallback to whatever was typed — that would
   * build blueprints for "dka" beside "diabetic ketoacidosis".
   */
  buildable: boolean;
}

const asString = (v: unknown) => (typeof v === "string" ? v : "");
const asNullableString = (v: unknown) => (typeof v === "string" && v ? v : null);

function toHistoryItem(raw: Record<string, unknown>): HistoryItem | null {
  const id = asNullableString(raw.id);
  if (!id) return null;
  const track = raw.examTrack === "step1" || raw.examTrack === "step2ck" ? raw.examTrack : null;
  const concept = raw.concept as { blueprint?: unknown; id?: unknown } | null;
  return {
    id,
    createdAt: asString(raw.createdAt),
    generationId: asNullableString(raw.generationId),
    storedKey: asNullableString(raw.storedKey),
    rawKey: asString(raw.rawKey),
    examTrack: track,
    concept:
      concept && asNullableString(concept.blueprint) && asNullableString(concept.id)
        ? { blueprint: concept.blueprint as string, id: concept.id as string }
        : null,
    revisitOf: asNullableString(raw.revisitOf),
    subtopic: asString(raw.subtopic),
    teachingPoint: asString(raw.teachingPoint),
    leadIn: asString(raw.leadIn),
    playable: raw.playable === true,
    lastAttemptAt: asNullableString(raw.lastAttemptAt),
    lastCorrect: typeof raw.lastCorrect === "boolean" ? raw.lastCorrect : null,
  };
}

/** The student's items on any of these keys, newest first. Throws; the caller decides to fail open. */
export async function loadHistory(client: SupabaseClient, userId: string, keys: string[]): Promise<HistoryItem[]> {
  const { data, error } = await client.rpc("qbank_topic_history", {
    p_user: userId,
    p_keys: keys,
    p_limit: HISTORY_LIMIT,
  });
  if (error) throw new Error(`qbank_topic_history: ${error.message}`);
  if (!Array.isArray(data)) return [];
  return data.map((r) => toHistoryItem(r as Record<string, unknown>)).filter((x): x is HistoryItem => x !== null);
}

const TIERS = new Set(["core", "standard", "extended"]);

function toConcepts(raw: unknown): BlueprintConcept[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .filter((c) => typeof c.id === "string" && typeof c.text === "string" && c.text)
    .map((c) => ({
      id: c.id as string,
      text: c.text as string,
      tier: TIERS.has(c.tier as string) ? (c.tier as BlueprintConcept["tier"]) : "standard",
    }));
}

/** Ready blueprints for these canonical keys, as `${key}|${track}`. Throws; the caller fails open. */
export async function loadBlueprints(client: SupabaseClient, keys: string[]): Promise<Map<string, Blueprint>> {
  const { data, error } = await client
    .from("qbank_topic_blueprints")
    .select("id, topic_key, exam_track, concepts, broader")
    .in("topic_key", keys)
    .eq("status", "ready");
  if (error) throw new Error(`qbank_topic_blueprints: ${error.message}`);
  const out = new Map<string, Blueprint>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const concepts = toConcepts(row.concepts);
    if (concepts.length === 0) continue;
    out.set(`${row.topic_key}|${row.exam_track}`, {
      id: String(row.id),
      concepts,
      broader: asNullableString(row.broader),
    });
  }
  return out;
}

/**
 * The canonical names an earlier wave of this set stored, by the key of what
 * was typed. Later waves are not routed (the client passes the systems back),
 * so this is how wave three knows "DKA" was "Diabetic ketoacidosis" — with no
 * client change and no way for a client to name a key of its own choosing.
 * Empty on failure: the caller falls back to the typed topic.
 */
export async function loadSetCanonicals(
  client: SupabaseClient,
  userId: string,
  generationId: string
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { data, error } = await client
      .from("questions")
      .select("focus:generation_meta->>focus, requested:generation_meta->>requestedTopic, canonical:generation_meta->>canonicalTopic")
      .eq("created_by", userId)
      .eq("origin", "generated")
      .eq("generation_meta->>generationId", generationId)
      .limit(50);
    if (error) return out;
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const typed = asNullableString(row.focus) ?? asNullableString(row.requested);
      const canonical = asNullableString(row.canonical);
      if (typed && canonical) out.set(topicKey(typed), canonical);
    }
  } catch {
    // Fail open.
  }
  return out;
}

/**
 * Claims a topic's blueprint build and runs it. Never throws: it runs in the
 * background of a wave, and a failed build is retried by a later wave once the
 * claim function's backoff allows.
 */
async function buildAndStore(
  client: SupabaseClient,
  config: CortiConfig,
  target: { key: string; canonical: string; system: SystemKey; track: ExamTrack },
  log: Log
): Promise<void> {
  const startedAt = Date.now();
  try {
    const { data: id, error } = await client.rpc("claim_qbank_blueprint_build", {
      p_topic_key: target.key,
      p_exam_track: target.track,
      p_canonical: target.canonical,
      p_system: target.system,
      p_version: BLUEPRINT_VERSION,
    });
    // Null: built already, being built, or failed too recently to retry.
    if (error || !id) return;

    try {
      const built = await buildBlueprint(config, { topic: target.canonical, system: target.system, track: target.track });
      const { error: storeError } = await client
        .from("qbank_topic_blueprints")
        .update({
          status: "ready",
          concepts: built.concepts,
          broader: built.broader,
          model: built.model,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (storeError) throw new Error(`store: ${storeError.message}`);
      log("blueprint_built", { track: target.track, concepts: built.concepts.length, ms: Date.now() - startedAt });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await client
        .from("qbank_topic_blueprints")
        .update({ status: "failed", last_error: message.slice(0, 300), updated_at: new Date().toISOString() })
        .eq("id", id);
      log("blueprint_failed", { track: target.track, message: message.slice(0, 200), ms: Date.now() - startedAt });
    }
  } catch (err) {
    log("blueprint_claim_failed", { message: err instanceof Error ? err.message : String(err) });
  }
}

export interface TopicMemoryResult {
  ledger: LedgerSection[];
  coverage: Coverage[];
  repetition: NonNullable<PersistInput["repetition"]>;
  /** Blueprint builds started for this wave's topics; the caller keeps the isolate alive for them. */
  builds: Promise<void>[];
}

/**
 * Applies the student's history to a wave's plan.
 *
 * Stamps every row with its topic's key and canonical name, assigns rows from
 * the history and the blueprints (assignRows), and lays out the do-not-re-test
 * list (buildLedger). Mutates the plan's rows in place: the plan is the one
 * object the prompt, persistence and the stream all read, so assigning on it is
 * what keeps the three in step.
 */
export async function applyTopicMemory(opts: {
  client: SupabaseClient;
  config: CortiConfig;
  userId: string;
  generationId: string;
  plan: BatchPlan;
  topics: WaveTopic[];
  log: Log;
  random?: () => number;
  now?: number;
}): Promise<TopicMemoryResult> {
  const { client, config, userId, generationId, plan, topics, log } = opts;
  const now = opts.now ?? Date.now();

  // Every row takes its topic's canonical identity. The name itself is stored
  // only when it is trusted: a later wave reads it back as the set's name for
  // the topic, and an untrusted fallback stored there would make itself
  // trusted one wave later.
  const topicOf = (focus: string | undefined) => topics.find((t) => t.topic === focus) ?? topics[0];
  for (const row of plan.questions) {
    const t = topicOf(row.focus);
    row.topicKey = topicKey(t.canonical);
    if (t.buildable) row.canonical = t.canonical;
  }

  // Only the topics this wave writes on: a twenty-topic exam block reads the
  // five its wave touches, not all twenty.
  const waveTopics = [...new Map(plan.questions.map((q) => [q.topicKey!, topicOf(q.focus)])).values()];
  const keysOf = (t: WaveTopic) => [...new Set([topicKey(t.canonical), topicKey(t.topic)])];
  const allKeys = [...new Set(waveTopics.flatMap(keysOf))];
  const canonicalKeys = [...new Set(waveTopics.map((t) => topicKey(t.canonical)))];

  const blind: TopicMemoryResult = {
    ledger: [],
    coverage: [],
    repetition: { version: REPETITION_VERSION, memory: "unavailable", ledger: 0, blueprints: 0 },
    builds: [],
  };

  const [history, blueprints] = await Promise.all([
    loadHistory(client, userId, allKeys).catch((err) => {
      log("history_unavailable", { message: err instanceof Error ? err.message : String(err) });
      return null;
    }),
    loadBlueprints(client, canonicalKeys).catch((err) => {
      log("blueprints_unavailable", { message: err instanceof Error ? err.message : String(err) });
      return new Map<string, Blueprint>();
    }),
  ]);
  // Assigning from a blueprint without the history would hand every student
  // the same first concepts every time — the problem this exists to fix — so
  // without history the wave is written blind, blueprints or not.
  if (history === null) return blind;

  const memories = new Map<string, TopicMemory>();
  for (const t of waveTopics) {
    const key = topicKey(t.canonical);
    const keys = new Set(keysOf(t));
    const items = history.filter((i) => (i.storedKey && keys.has(i.storedKey)) || keys.has(i.rawKey));
    memories.set(key, {
      key,
      canonical: t.canonical,
      threads: buildThreads(items, now),
      blueprints: {
        ...(blueprints.get(`${key}|step1`) ? { step1: blueprints.get(`${key}|step1`) } : {}),
        ...(blueprints.get(`${key}|step2ck`) ? { step2ck: blueprints.get(`${key}|step2ck`) } : {}),
      },
    });
  }

  const { assignments, coverage } = assignRows(
    plan.questions.map((q) => ({ index: q.index, examTrack: q.examTrack, topicKey: q.topicKey! })),
    memories,
    generationId,
    opts.random ?? Math.random
  );
  for (const row of plan.questions) {
    const a = assignments.get(row.index);
    if (a) row.assignment = a;
  }

  const ledger = buildLedger([...memories.values()]);

  // Blueprints this wave would have used and does not have.
  const missing = new Map<string, { key: string; canonical: string; system: SystemKey; track: ExamTrack }>();
  for (const row of plan.questions) {
    const t = topicOf(row.focus);
    const key = row.topicKey!;
    if (!t.buildable || memories.get(key)?.blueprints[row.examTrack]) continue;
    missing.set(`${key}|${row.examTrack}`, { key, canonical: t.canonical, system: t.system, track: row.examTrack });
  }
  const builds = [...missing.values()].slice(0, MAX_BUILDS_PER_WAVE).map((target) => buildAndStore(client, config, target, log));

  const usedBlueprints = new Set(
    [...assignments.values()].map((a) => a.blueprintId).filter((id): id is string => !!id)
  );
  return {
    ledger,
    coverage,
    repetition: {
      version: REPETITION_VERSION,
      memory: "ok",
      ledger: ledger.reduce((n, s) => n + s.entries.length, 0),
      blueprints: usedBlueprints.size,
    },
    builds,
  };
}
