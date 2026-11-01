// The shipped implementation, measured on the study's terms.
//
// Same topics, same seeded plans and the same writer, prompt, gate and probe
// as gen.mts, but each session's plan goes through the production
// applyTopicMemory against a fake database that serves this simulated
// student's earlier items. So the router's canonical name, the history
// policy, the blueprint builder and the prompt wording are all the real code.
//
//   E  ledger only (the topic has no blueprint yet)
//   F  blueprint built by the real buildBlueprint, no answers recorded
//   G  as F, sessions three days apart with answers simulated (60% correct),
//      so misses come due and revisits are exercised
//   H  as F, after the ledger began listing blueprint items too — F was run
//      before that change, so F against H measures it
//
// Output matches gen.mts (out/<arm>/<topic>/s<k>.json), so exp-groups.cjs,
// judge.mts, rate.mts and metrics.cjs read it unchanged.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  OUT, ROOT, config, readJson, writeJson, slug, pool, streamWriter,
  buildBatchPlan, buildUserMessage, systemPromptFor, prepareBatch, verifyOne,
  SYSTEM_ROUTER_PROMPT, SYSTEM_KEYS, stripFences, cortiComplete,
} from "./common.mts";

const MEM = await import(pathToFileURL(path.join(ROOT, "supabase/functions/_shared/qbank-memory.ts")).href);
const BP = await import(pathToFileURL(path.join(ROOT, "supabase/functions/_shared/qbank-blueprint.ts")).href);
const REP = await import(pathToFileURL(path.join(ROOT, "supabase/functions/_shared/qbank-repetition.ts")).href);

const SESSIONS = Number(process.env.SESSIONS ?? 4);
const COUNT = 5;
const DAY = 86_400_000;
const BASE = Date.parse("2026-11-01T09:00:00Z");

const TOPICS = [
  { topic: "heart failure", examMode: "step2ck" },
  { topic: "diabetic ketoacidosis", examMode: "step1" },
  { topic: "warfarin", examMode: "step1" },
];
type Arm = "E" | "F" | "G" | "H";
const ARMS = (process.env.ONLY_ARMS?.split(",") ?? ["E", "F", "G", "H"]) as Arm[];

function seeded(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

/** The production router, prompt and parse, cached per topic. */
async function route(topic: string): Promise<{ system: string; canonical: string }> {
  const p = path.join(OUT, "route-impl", `${slug(topic)}.json`);
  if (fs.existsSync(p)) return readJson(p);
  const raw = await cortiComplete(config, {
    model: config.routerModel, temperature: 0, maxTokens: 200, json: true,
    messages: [{ role: "system", content: SYSTEM_ROUTER_PROMPT }, { role: "user", content: topic }],
  });
  const parsed = JSON.parse(stripFences(raw));
  const r = { system: SYSTEM_KEYS.includes(parsed.system) ? parsed.system : "cardiovascular", canonical: parsed.canonical || topic };
  writeJson(p, r);
  return r;
}

/** The production builder, cached per topic: one shared blueprint, as in the table. */
async function blueprint(canonical: string, system: string, track: string) {
  const p = path.join(OUT, "blueprint-impl", `${slug(canonical)}-${track}.json`);
  if (fs.existsSync(p)) return readJson(p);
  const t0 = Date.now();
  const built = await BP.buildBlueprint(config, { topic: canonical, system, track });
  const row = { id: `bp-${slug(canonical)}-${track}`, topic_key: REP.topicKey(canonical), exam_track: track, concepts: built.concepts, broader: built.broader, ms: Date.now() - t0 };
  writeJson(p, row);
  return row;
}

/** A Supabase stand-in answering exactly the calls applyTopicMemory makes. */
function fakeDb(history: unknown[], blueprints: unknown[]) {
  const query = (table: string) => {
    const b: any = {
      select: () => b, eq: () => b, in: () => b, limit: () => b, update: () => b,
      then: (res: any, rej: any) =>
        Promise.resolve({ data: table === "qbank_topic_blueprints" ? blueprints : [], error: null }).then(res, rej),
    };
    return b;
  };
  return {
    rpc: async (name: string) =>
      name === "qbank_topic_history" ? { data: history, error: null } : { data: null, error: null },
    from: query,
  };
}

async function runSession(arm: Arm, t: (typeof TOPICS)[number], routed: { system: string; canonical: string }, k: number, prior: any[], bp: any) {
  const file = path.join(OUT, arm, slug(t.topic), `s${k}.json`);
  if (fs.existsSync(file)) return readJson(file);

  const sessionAt = arm === "G" ? BASE + (k - 1) * 3 * DAY : BASE;
  const random = seeded(hash(`${t.topic}#${k}`));
  const plan = buildBatchPlan(routed.system, COUNT, random, 1, "balanced", t.examMode, []);

  // The student's earlier items, in the shape qbank_topic_history returns.
  const history = prior.flatMap((s: any) =>
    s.items.map((x: any) => ({
      id: x.id,
      createdAt: new Date(s.at).toISOString(),
      generationId: `gen-${arm}-${k}-${s.session}`,
      storedKey: REP.topicKey(routed.canonical),
      rawKey: REP.topicKey(t.topic),
      examTrack: x.examTrack,
      concept: x.concept?.id && x.concept?.blueprint ? { blueprint: x.concept.blueprint, id: x.concept.id } : null,
      revisitOf: x.concept?.revisitOf ?? null,
      subtopic: x.subtopic,
      teachingPoint: x.teachingPoint,
      leadIn: x.leadIn,
      playable: x.playable,
      lastAttemptAt: x.answer ? new Date(s.at + 10 * 60_000).toISOString() : null,
      lastCorrect: x.answer ? x.answer === "correct" : null,
    }))
  ).reverse();

  const memory = await MEM.applyTopicMemory({
    client: fakeDb(history, bp ? [bp] : []),
    config,
    userId: "sim",
    generationId: `gen-${arm}-${k}`,
    plan,
    topics: [{ topic: t.topic, system: routed.system, canonical: routed.canonical, buildable: false }],
    log: () => {},
    random,
    now: sessionAt,
  });

  const user = buildUserMessage({ topic: t.topic, plan, avoidSubtopics: [], ledger: memory.ledger });
  // A busy gateway answers 429/503, or occasionally 200 with an empty stream.
  // Either is retried; an empty session is never saved, since every later
  // session in the chain would be built on it.
  let content = "";
  let ms = 0;
  let prepared: any = null;
  for (let attempt = 1; ; attempt++) {
    try {
      ({ content, ms } = await streamWriter(systemPromptFor(plan), user, 0.7));
      prepared = prepareBatch(content, plan);
      if (prepared.questions.length > 0) break;
      throw new Error("empty wave");
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 15_000 * attempt));
    }
  }
  const qs = prepared.questions.slice(0, plan.questions.length);
  const verdicts = await Promise.all(qs.map((q: any) => verifyOne(config, q, q.examTrack)));
  const answerRandom = seeded(hash(`${t.topic}#${k}#answers`));
  const items = qs.map((q: any, i: number) => {
    const row = plan.questions.find((p: any) => p.index === q.index) ?? plan.questions[i];
    const a = row?.assignment;
    const playable = !prepared.qa[i]?.blocked && verdicts[i].agreed;
    return {
      id: `${arm}-${slug(t.topic)}-s${k}-${q.index}`,
      index: q.index, subtopic: q.subtopic, difficulty: q.difficulty, reasoningOrder: q.reasoningOrder,
      vignette: q.vignette, leadIn: q.leadIn, options: q.options, correctOption: q.correctOption,
      keyText: q.options?.[q.correctOption], teachingPoint: q.teachingPoint, explanation: q.explanation,
      reviewerFlag: q.reviewerFlag, examTrack: q.examTrack,
      blocked: !!prepared.qa[i]?.blocked,
      blockRules: (prepared.qa[i]?.findings ?? []).filter((f: any) => f.severity === "block").map((f: any) => f.rule),
      agreed: verdicts[i].agreed, verifierIssue: verdicts[i].issue,
      playable,
      concept: a ? { mode: a.mode, id: a.conceptId, blueprint: a.blueprintId, revisitOf: a.revisitOf, text: a.text } : null,
      answer: arm === "G" && playable ? (answerRandom() < 0.6 ? "correct" : "wrong") : null,
    };
  });
  const rec = {
    arm, topic: t.topic, canonical: routed.canonical, examMode: t.examMode, system: routed.system, session: k,
    at: sessionAt, ms, userMessage: user, ledgerLines: memory.repetition.ledger, coverage: memory.coverage, items,
  };
  writeJson(file, rec);
  const modes = items.map((x: any) => x.concept?.mode ?? "-").join(",");
  console.log(`${arm} ${t.topic.padEnd(22)} s${k} ${items.filter((x: any) => x.playable).length}/${items.length} playable, ledger ${memory.repetition.ledger}, modes ${modes}, ${Math.round(ms / 1000)}s`);
  return rec;
}

async function chain(arm: Arm, t: (typeof TOPICS)[number]) {
  const routed = await route(t.topic);
  const bp = arm === "E" ? null : await blueprint(routed.canonical, routed.system, t.examMode);
  const sessions: any[] = [];
  for (let k = 1; k <= SESSIONS; k++) {
    try {
      sessions.push(await runSession(arm, t, routed, k, sessions, bp));
    } catch (err) {
      console.log(`FAIL ${arm} ${t.topic} s${k}: ${err instanceof Error ? err.message : err}`);
      return;
    }
  }
}

for (const t of TOPICS) {
  const r = await route(t.topic);
  console.log(`${t.topic} → ${r.system}, canonical "${r.canonical}"`);
}
// Blueprints first, one per topic, so F and G share each topic's single build.
for (const t of TOPICS) {
  if (!ARMS.some((a) => a !== "E")) break;
  const r = await route(t.topic);
  const b = await blueprint(r.canonical, r.system, t.examMode);
  console.log(`blueprint ${r.canonical}/${t.examMode}: ${b.concepts.length} concepts, broader "${b.broader}"${b.ms ? `, ${Math.round(b.ms / 1000)}s` : ""}`);
}
const jobs = ARMS.flatMap((arm) => TOPICS.map((t) => [arm, t] as const));
await pool(jobs, Number(process.env.CONCURRENCY ?? 9), ([arm, t]) => chain(arm, t));
console.log("done");
