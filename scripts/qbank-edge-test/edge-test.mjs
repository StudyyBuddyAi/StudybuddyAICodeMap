// Runs the real supabase/functions/qbank-generate handler in Node against a
// fake Supabase client and a fake Corti, and checks the free-allowance and
// writer-flag paths end to end. Nothing leaves this process: no Deno, no
// network, no database. From the repo root:
//   node --import ./scripts/qbank-edge-test/loader.mjs scripts/qbank-edge-test/edge-test.mjs
// Exit code 1 on any failed check.
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const ROOT = process.argv[2] ?? process.cwd();
const env = {
  SUPABASE_URL: "http://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  CORTI_CLIENT_ID: "id",
  CORTI_CLIENT_SECRET: "secret",
  CORTI_TENANT: "base",
  CORTI_REGION: "eu",
};
globalThis.Deno = { env: { get: (k) => env[k] } };

// ── The batch the fake writer streams ────────────────────────────────────────
const KEY_TEXT = (n) => `Key answer number ${n}`;
function item(n, over = {}) {
  return {
    index: n,
    system: "Renal & Urinary",
    domain: "Physiology",
    subtopic: `Subtopic ${n} ${"abcdefghij"[n]}`,
    competency: "Foundational Science",
    difficulty: "Medium",
    reasoningOrder: "2nd",
    reasoningChain: "internal",
    vignette: `Case ${n}: a ${40 + n}-year-old presents with a finding that needs interpreting. Laboratory studies show one abnormal value.`,
    leadIn: "Which transporter is directly inhibited?",
    options: {
      a: KEY_TEXT(n),
      b: `Distractor b${n} option`,
      c: `Distractor c${n} option`,
      d: `Distractor d${n} option`,
      e: `Distractor e${n} option`,
    },
    correctOption: "a",
    explanation: `**Bolded mechanism ${n}** explains it.`,
    distractorExplanations: { b: "No.", c: "No.", d: "No.", e: "No." },
    teachingPoint: "**Point.**",
    suggestedImage: { needed: "No", type: "none", searchTags: [], mustShow: "" },
    selfCheck: {},
    reviewerFlag: "None.",
    ...over,
  };
}
const BATCH = {
  batchPlan: { system: "renal", answerPositions: [] },
  questions: [
    item(1),
    item(2),
    item(3, { reviewerFlag: "CRITICAL: correctOption is wrong; option c is the answer." }), // gate block
    item(4), // the probe will disagree
    item(5, { reviewerFlag: "Guideline from memory, unconfirmed." }), // fact check says outdated
  ],
};

// ── Fake Corti ───────────────────────────────────────────────────────────────
const calls = { stream: 0, verify: 0, flagCheck: 0, ambiguity: 0, router: [], blueprint: 0, audit: 0 };
let lastStreamBody = null;
const ROUTES = { "heart failure": "cardiovascular", "nephrotic syndrome": "renal", "spikes protocol": "social_sciences", "banana bread": "not_medical", dka: "endocrine" };
const CANONICAL = { dka: "Diabetic ketoacidosis", "heart failure": "Heart failure" };
/** Draft calls the fake gateway refuses as busy before it answers. */
const busy = { draft: 0 };
const DRAFT = {
  broader: "Diabetes mellitus",
  concepts: Array.from({ length: 12 }, (_, i) => ({ concept: `Testable point number ${i + 1} about ketoacidosis`, tier: i < 4 ? "core" : "standard" })),
};
let streamStatus = 200;
/** Per item: the probe answers with the key but objects to the item. */
let probeObjections = {};
/** Items the second blind read (corti-s1-mini-instant) answers off the key; and that read failing outright. */
let secondReadWrong = new Set();
let secondReadDown = false;
/** Per item: what the ambiguity reviewer reports ("second_answer" | "missing_data"). */
let ambiguityDefects = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/protocol/openid-connect/token")) {
    return new Response(JSON.stringify({ access_token: "tok", expires_in: 300 }), { status: 200 });
  }
  if (u.endsWith("/chat/completions")) {
    const body = JSON.parse(init.body);
    if (body.stream) {
      calls.stream++;
      lastStreamBody = body;
      if (streamStatus !== 200) return new Response("boom", { status: streamStatus });
      const text = JSON.stringify(BATCH);
      const chunks = text.match(/[\s\S]{1,180}/g);
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        start(c) {
          for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`));
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    const system = body.messages[0].content;
    const user = body.messages[1].content;
    const n = Number(/Case (\d+)/.exec(user)?.[1]);
    let content;
    if (system.startsWith("You classify a medical study topic")) {
      calls.router.push(user);
      const canonical = CANONICAL[user.toLowerCase()];
      content = JSON.stringify({ system: ROUTES[user.toLowerCase()] ?? "cardiovascular", confidence: 0.9, ...(canonical ? { canonical } : {}) });
    } else if (system.startsWith("You map a medical study topic")) {
      calls.blueprint++;
      // What the first live build met: the gateway refusing while the wave ran.
      if (busy.draft > 0) {
        busy.draft--;
        return new Response(JSON.stringify({ error: { message: "The engine is currently busy", code: 503 } }), { status: 429 });
      }
      content = JSON.stringify(DRAFT);
    } else if (system.includes("auditing a concept list")) {
      calls.audit++;
      content = JSON.stringify({ duplicates: [[2, 5]], unusable: [12] });
    } else if (system.includes("senior USMLE item reviewer")) {
      calls.ambiguity++;
      content = JSON.stringify({ defect: ambiguityDefects[n] ?? "none", option: null, note: ambiguityDefects[n] ? "test" : "" });
    } else if (system.includes("board-certified physician")) {
      calls.flagCheck++;
      content = JSON.stringify({ verdict: n === 5 ? "outdated" : "confirmed", note: "test" });
    } else {
      calls.verify++;
      // Answer with the letter that carries the key text, except item 4.
      const letter = (/^([A-E])\. (.*)$/gm.exec ? [...user.matchAll(/^([A-E])\. (.*)$/gm)] : [])
        .find(([, , text]) => text === KEY_TEXT(n))?.[1]?.toLowerCase();
      const wrong = ["a", "b", "c", "d", "e"].find((l) => l !== letter);
      const objection = probeObjections[n];
      const second = body.model === "corti-s1-mini-instant";
      if (second && secondReadDown) {
        return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 });
      }
      content = JSON.stringify({
        answer: n === 4 || (second && secondReadWrong.has(n)) ? wrong : letter,
        solvable: objection?.solvable ?? true,
        issue: objection?.issue ?? "None.",
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }
  return realFetch(url, init);
};

// ── Fake Supabase ────────────────────────────────────────────────────────────
/**
 * A fake Supabase client. Queries chain and resolve like the real builder, and
 * are answered from `memory`: the student's history, the ready blueprints, an
 * earlier wave's stored names, and whether a blueprint build is claimed.
 */
function fakeClient({ isPro = false, granted = 5, remaining = 5, memory = {} } = {}) {
  const log = { rpc: [], inserts: [], queries: [], updates: [] };
  let nextId = 1;
  const answer = (q) => {
    if (q.op === "update") return { data: null, error: null };
    if (q.table === "profiles") return { data: { is_pro: isPro, pro_expires_at: null }, error: null };
    if (q.table === "qbank_topic_blueprints") return { data: memory.blueprints ?? [], error: null };
    if (q.table === "questions") return { data: memory.setRows ?? [], error: null };
    return { data: null, error: null };
  };
  const from = (table) => {
    const q = { table, op: "select", filters: [], cols: null, payload: null };
    log.queries.push(q);
    const b = {
      select: (cols) => ((q.cols = cols), b),
      eq: (c, v) => (q.filters.push(["eq", c, v]), b),
      in: (c, v) => (q.filters.push(["in", c, v]), b),
      limit: () => b,
      update: (payload) => ((q.op = "update"), (q.payload = payload), log.updates.push(q), b),
      maybeSingle: async () => answer(q),
      then: (resolve, reject) => Promise.resolve(answer(q)).then(resolve, reject),
      insert: (row) => {
        log.inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: `q-${nextId++}` }, error: null }) }) };
      },
    };
    return b;
  };
  const client = {
    log,
    auth: { getUser: async () => ({ data: { user: { id: "user-1", is_anonymous: false } }, error: null }) },
    rpc: async (name, args) => {
      log.rpc.push({ name, args });
      if (name === "reserve_usage") {
        return { data: { granted, count: 10 - remaining, remaining, date: "2026-10-30" }, error: null };
      }
      if (name === "qbank_topic_history") {
        return memory.historyError
          ? { data: null, error: { message: memory.historyError } }
          : { data: memory.history ?? [], error: null };
      }
      if (name === "claim_qbank_blueprint_build") return { data: memory.claimId ?? null, error: null };
      return { data: null, error: null };
    },
    from,
  };
  return client;
}

const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
/** One history row, as qbank_topic_history returns it. */
const past = (over = {}) => ({
  id: "h-1",
  createdAt: daysAgo(10),
  generationId: "g-old",
  storedKey: "diabetic ketoacidosis",
  rawKey: "dka",
  examTrack: "step1",
  concept: null,
  revisitOf: null,
  subtopic: "Potassium shift",
  teachingPoint: "**Insulin** drives potassium into cells.",
  leadIn: "Which mechanism explains the fall in potassium?",
  playable: true,
  lastAttemptAt: daysAgo(9),
  lastCorrect: true,
  ...over,
});

async function run(body) {
  const req = new Request("http://edge.test/qbank-generate", {
    method: "POST",
    headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
    body: JSON.stringify({ topic: "renal tubular acidosis", generationId: "gen-1", system: "renal", count: 5, ...body }),
  });
  const res = await globalThis.__handler(req);
  const text = await res.text();
  const metas = [];
  for (const block of text.split(/\n\n/)) {
    const line = block.split("\n").find((l) => l.startsWith("data:"));
    if (!line) continue;
    try {
      const j = JSON.parse(line.slice(5));
      if (j.__meta) metas.push(j.__meta);
    } catch { /* model frames and [DONE] */ }
  }
  return { status: res.status, text, metas };
}

await import(pathToFileURL(path.join(ROOT, "supabase/functions/qbank-generate/index.ts")).href);
// The same module instance the handler imported: no real seconds spent waiting out a busy gateway.
const { BLUEPRINT_RETRY } = await import(pathToFileURL(path.join(ROOT, "supabase/functions/_shared/qbank-blueprint.ts")).href);
BLUEPRINT_RETRY.delaysMs = [0, 0, 0];
assert.equal(typeof globalThis.__handler, "function", "serve() captured the handler");

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
};

// 1. Free account, a wave of five: two delivered, three held back → three released.
{
  globalThis.__fakeClient = fakeClient({ granted: 5, remaining: 5 });
  const { status, metas } = await run({});
  const log = globalThis.__fakeClient.log;
  const ready = metas.filter((m) => m.questionReady).map((m) => m.questionReady);
  const done = metas.find((m) => m.waveComplete)?.waveComplete;
  check("free wave streams", () => assert.equal(status, 200));
  check("reserved the wave against the cap", () =>
    assert.deepEqual(log.rpc.find((c) => c.name === "reserve_usage")?.args, { p_user: "user-1", p_kind: "qbank_generate", p_want: 5, p_cap: 10 }));
  check("five written, five announced", () => assert.equal(ready.length, 5));
  const byIndex = Object.fromEntries(ready.map((r) => [r.index, r]));
  check("critical writer flag blocks", () => assert.equal(byIndex[3].blocked, true));
  check("critical flag rule named", () => assert.equal(byIndex[3].blockRule, "writer-critical"));
  check("probe disagreement withholds item 4", () => assert.equal(byIndex[4].agreed, false));
  check("unconfirmed doubt blocks item 5", () => assert.equal(byIndex[5].blockRule, "flag-unconfirmed"));
  check("clean items 1 and 2 playable", () => assert.ok(!byIndex[1].blocked && byIndex[1].agreed && !byIndex[2].blocked && byIndex[2].agreed));
  check("fact check ran only on item 5 (3 was blocked, 4 disputed)", () => assert.equal(calls.flagCheck, 1));
  const release = log.rpc.find((c) => c.name === "release_usage");
  check("released the three undelivered", () =>
    assert.deepEqual(release?.args, { p_user: "user-1", p_kind: "qbank_generate", p_n: 3, p_date: "2026-10-30" }));
  check("summary reports the settled allowance", () => assert.deepEqual(done?.allowance, { limit: 10, remaining: 8 }));
  const row5 = log.inserts.find((r) => r.generation_meta.index === 5);
  check("fact-check verdict stored on the row", () => assert.equal(row5?.generation_meta.flagCheck?.verdict, "outdated"));
  check("blocked row stored as qaBlocked", () => assert.equal(row5?.generation_meta.qaBlocked, true));
}

// 2. Allowance spent: refused before any generation.
{
  const streamsBefore = calls.stream;
  globalThis.__fakeClient = fakeClient({ granted: 0, remaining: 0 });
  const { status, text } = await run({});
  const body = JSON.parse(text);
  check("spent allowance → 429", () => assert.equal(status, 429));
  check("daily_cap code", () => assert.equal(body.code, "daily_cap"));
  check("no generation when refused", () => assert.equal(calls.stream, streamsBefore));
}

// 3. Partial grant trims the wave.
{
  globalThis.__fakeClient = fakeClient({ granted: 2, remaining: 0 });
  const { metas } = await run({});
  const plan = metas.find((m) => m.plan)?.plan;
  check("wave trimmed to the grant", () => assert.equal(plan?.length, 2));
  const ready = metas.filter((m) => m.questionReady);
  check("over-production past the plan is not written", () => assert.equal(ready.length, 2));
  check("nothing past the plan inserted", () => assert.equal(globalThis.__fakeClient.log.inserts.length, 2));
}

// 4. Pro: no reservation at all, no allowance in the summary.
{
  globalThis.__fakeClient = fakeClient({ isPro: true });
  const { metas } = await run({});
  const log = globalThis.__fakeClient.log;
  check("pro never reserves", () => assert.equal(log.rpc.filter((c) => c.name === "reserve_usage").length, 0));
  check("pro summary has no allowance", () => assert.equal(metas.find((m) => m.waveComplete)?.waveComplete.allowance, null));
}

// 5. Upstream down: the whole reservation goes back.
{
  streamStatus = 500;
  globalThis.__fakeClient = fakeClient({ granted: 5, remaining: 5 });
  const { status } = await run({});
  const release = globalThis.__fakeClient.log.rpc.find((c) => c.name === "release_usage");
  check("upstream failure → 502", () => assert.equal(status, 502));
  check("upstream failure releases all five", () => assert.equal(release?.args.p_n, 5));
  streamStatus = 200;
}

// 6. A mixed set: each topic routed on its own, the family prompt chosen,
//    each question filed under its own system, the set labelled "Mixed".
{
  globalThis.__fakeClient = fakeClient({ isPro: true });
  calls.router = [];
  const { status, metas } = await run({ topic: undefined, system: undefined, topics: ["Heart failure", "Nephrotic syndrome", "SPIKES protocol"] });
  const open = metas.find((m) => m.plan);
  const inserts = globalThis.__fakeClient.log.inserts;
  check("mixed set streams", () => assert.equal(status, 200));
  check("router asked once per topic", () => assert.equal(calls.router.length, 3));
  check("set labelled Mixed", () => assert.equal(open?.systemName, "Mixed"));
  check("per-topic systems reported", () => assert.deepEqual(open?.systems, ["cardiovascular", "renal", "social_sciences"]));
  check("plan rows rotate through the topics", () =>
    assert.deepEqual(open?.plan.map((r) => r.focus), ["Heart failure", "Nephrotic syndrome", "SPIKES protocol", "Heart failure", "Nephrotic syndrome"]));
  check("family prompt used when an ethics item is in the set", () =>
    assert.ok(lastStreamBody.messages[0].content.includes("Communication & Ethics and Biostatistics items")));
  check("user message briefs each system", () => {
    const user = lastStreamBody.messages[1].content;
    assert.ok(user.includes("## System Brief — Renal & Urinary") && user.includes("## System Brief — Communication & Ethics"));
  });
  check("each question filed under its own system", () =>
    assert.deepEqual(inserts.slice(0, 3).map((r) => r.subject).sort(), ["Cardiovascular", "Communication & Ethics", "Renal & Urinary"].sort()));
  check("ethics row pinned to its family domain", () =>
    assert.equal(inserts.find((r) => r.generation_meta.focus === "SPIKES protocol")?.domain, "Communication & Ethics"));
  check("topics recorded on the row", () =>
    assert.deepEqual(inserts[0].generation_meta.topics, ["Heart failure", "Nephrotic syndrome", "SPIKES protocol"]));
}

// 7. Later waves pass the systems back: no routing at all.
{
  globalThis.__fakeClient = fakeClient({ isPro: true });
  calls.router = [];
  await run({ topic: undefined, system: undefined, topics: ["Heart failure", "Nephrotic syndrome"], systems: ["cardiovascular", "renal"], startIndex: 6 });
  check("resolved systems skip the router", () => assert.equal(calls.router.length, 0));
}

// 8. One junk topic in a mix is named and refused.
{
  globalThis.__fakeClient = fakeClient({ isPro: true });
  const streamsBefore = calls.stream;
  const { status, text } = await run({ topic: undefined, system: undefined, topics: ["Heart failure", "banana bread"] });
  check("junk topic in a mix → 422", () => assert.equal(status, 422));
  check("the refusal names the topic", () => assert.ok(JSON.parse(text).error.includes("banana bread")));
  check("nothing generated for a refused mix", () => assert.equal(calls.stream, streamsBefore));
}

// 9. Too many un-routed topics.
{
  globalThis.__fakeClient = fakeClient({ isPro: true });
  const { status } = await run({ topic: undefined, system: undefined, topics: ["a1 heart", "b2 kidney", "c3 lung", "d4 liver", "e5 brain", "f6 skin"] });
  check("more than five topics to route → 400", () => assert.equal(status, 400));
}

// ── Topic memory ─────────────────────────────────────────────────────────────
const settle = async (done, ms = 3000) => {
  const t0 = Date.now();
  while (!done() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
};
const userMessage = () => lastStreamBody.messages[1].content;
const metaOf = (inserts) => inserts.map((r) => r.generation_meta);

// 10. History, no blueprint: the canonical name joins "DKA" to its history, a
//     recent fact goes on the do-not-re-test list, a due miss is revisited.
{
  calls.router = [];
  globalThis.__fakeClient = fakeClient({
    isPro: true,
    memory: {
      history: [
        past(),
        past({ id: "h-2", subtopic: "Cerebral edema", teachingPoint: "Rapid osmolar correction swells the brain.", leadIn: "What caused the headache?", lastAttemptAt: daysAgo(5), lastCorrect: false }),
      ],
    },
  });
  const { status, metas } = await run({ topic: "DKA", system: undefined });
  const log = globalThis.__fakeClient.log;
  const history = log.rpc.find((c) => c.name === "qbank_topic_history");
  const rows = metaOf(log.inserts);
  const open = metas.find((m) => m.plan);
  check("memory wave streams", () => assert.equal(status, 200));
  check("history read under the canonical key and the typed one", () =>
    assert.deepEqual([...history.args.p_keys].sort(), ["diabetic ketoacidosis", "dka"]));
  check("recent fact on the do-not-re-test list", () =>
    assert.ok(userMessage().includes("- Potassium shift: Insulin drives potassium into cells.")));
  check("due miss is revisited, not listed", () => {
    assert.ok(userMessage().includes('— revisit: Rapid osmolar correction swells the brain. (earlier question: "What caused the headache?")'));
    assert.ok(!userMessage().includes("- Cerebral edema:"));
  });
  check("rows stored under the canonical topic", () =>
    assert.ok(rows.every((m) => m.topicKey === "diabetic ketoacidosis" && m.canonicalTopic === "Diabetic ketoacidosis")));
  check("exactly one row records the revisit", () => {
    const tagged = rows.filter((m) => m.concept);
    assert.equal(tagged.length, 1);
    assert.deepEqual({ mode: tagged[0].concept.mode, revisitOf: tagged[0].concept.revisitOf }, { mode: "revisit", revisitOf: "h-2" });
  });
  check("rows record how the wave used history", () =>
    assert.deepEqual(rows[0].repetition, { version: "r1", memory: "ok", ledger: 1, blueprints: 0 }));
  check("stream shows a row's mode, never its concept or answer letter", () => {
    assert.equal(open.plan.filter((r) => r.mode === "revisit").length, 1);
    const frame = JSON.stringify(open.plan);
    assert.ok(!frame.includes("answerLetter") && !frame.includes("osmolar"));
  });
  check("a missing blueprint is claimed for the routed name", () => {
    const claim = log.rpc.find((c) => c.name === "claim_qbank_blueprint_build");
    assert.deepEqual(claim?.args, { p_topic_key: "diabetic ketoacidosis", p_exam_track: "step1", p_canonical: "Diabetic ketoacidosis", p_system: "endocrine", p_version: "b1" });
  });
}

// 11. A ready blueprint: every row assigned a concept the student has not met.
{
  const concepts = Array.from({ length: 12 }, (_, i) => ({ id: `c${i + 1}`, text: `Ketoacidosis concept ${i + 1}`, tier: "core" }));
  globalThis.__fakeClient = fakeClient({
    isPro: true,
    memory: {
      history: [past({ concept: { blueprint: "bp-1", id: "c1" } })],
      blueprints: [{ id: "bp-1", topic_key: "diabetic ketoacidosis", exam_track: "step1", concepts, broader: "Diabetes mellitus" }],
    },
  });
  const { metas } = await run({ topic: "DKA", system: undefined });
  const log = globalThis.__fakeClient.log;
  const rows = metaOf(log.inserts);
  const done = metas.find((m) => m.waveComplete)?.waveComplete;
  const ids = rows.map((m) => m.concept?.id);
  check("every row assigned a distinct blueprint concept", () => {
    assert.ok(rows.every((m) => m.concept?.blueprint === "bp-1" && m.concept.mode === "new"));
    assert.equal(new Set(ids).size, 5);
  });
  check("the met concept is not assigned again", () => assert.ok(!ids.includes("c1")));
  check("the writer is told each row's concept", () => {
    assert.ok(userMessage().includes("Each plan row names the concept its item must turn on."));
    assert.equal((userMessage().match(/ — concept: Ketoacidosis concept/g) ?? []).length, 5);
  });
  check("a met blueprint concept is listed by what its item taught, and rows override the list", () => {
    assert.ok(userMessage().includes("- Potassium shift: Insulin drives potassium into cells."));
    assert.ok(userMessage().includes("The one exception is a concept a plan row names"));
  });
  check("summary reports coverage", () =>
    assert.deepEqual(done?.coverage, [{ topic: "Diabetic ketoacidosis", examTrack: "step1", total: 12, covered: 6, exhausted: false, broader: "Diabetes mellitus" }]));
  check("no build when the blueprint is ready", () => assert.ok(!log.rpc.some((c) => c.name === "claim_qbank_blueprint_build")));
}

// 12. A claimed build runs in the background and stores the audited list.
{
  const before = { blueprint: calls.blueprint, audit: calls.audit };
  globalThis.__fakeClient = fakeClient({ isPro: true, memory: { history: [], claimId: "bp-new" } });
  await run({ topic: "DKA", system: undefined });
  const log = globalThis.__fakeClient.log;
  await settle(() => log.updates.some((u) => u.table === "qbank_topic_blueprints"));
  const stored = log.updates.find((u) => u.table === "qbank_topic_blueprints");
  check("draft and audit each called once", () =>
    assert.deepEqual({ b: calls.blueprint - before.blueprint, a: calls.audit - before.audit }, { b: 1, a: 1 }));
  check("audited blueprint stored ready on the claimed row", () => {
    assert.equal(stored?.payload.status, "ready");
    assert.deepEqual(stored?.filters, [["eq", "id", "bp-new"]]);
    // Twelve drafted; line 5 duplicates line 2 and line 12 is unusable.
    assert.equal(stored?.payload.concepts.length, 10);
    assert.deepEqual(stored?.payload.concepts.map((c) => c.id), ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10"]);
    assert.ok(!stored?.payload.concepts.some((c) => c.text.endsWith("number 5 about ketoacidosis")));
    assert.equal(stored?.payload.broader, "Diabetes mellitus");
  });
}

// 12b. A busy gateway is retried inside the build, not parked for an hour.
{
  const before = calls.blueprint;
  busy.draft = 2;
  globalThis.__fakeClient = fakeClient({ isPro: true, memory: { history: [], claimId: "bp-busy" } });
  await run({ topic: "DKA", system: undefined });
  const log = globalThis.__fakeClient.log;
  await settle(() => log.updates.some((u) => u.table === "qbank_topic_blueprints"));
  const stored = log.updates.find((u) => u.table === "qbank_topic_blueprints");
  check("busy gateway retried until it answers", () => assert.equal(calls.blueprint - before, 3));
  check("retried build stored ready", () => assert.equal(stored?.payload.status, "ready"));
}

// 12c. Busy throughout: stored as a transient failure, which the claim
//      function retries in minutes rather than hours.
{
  busy.draft = 99;
  globalThis.__fakeClient = fakeClient({ isPro: true, memory: { history: [], claimId: "bp-busy-2" } });
  await run({ topic: "DKA", system: undefined });
  const log = globalThis.__fakeClient.log;
  await settle(() => log.updates.some((u) => u.table === "qbank_topic_blueprints"));
  const stored = log.updates.find((u) => u.table === "qbank_topic_blueprints");
  busy.draft = 0;
  check("exhausted retries stored as a transient failure", () => {
    assert.equal(stored?.payload.status, "failed");
    assert.match(stored?.payload.last_error ?? "", /^transient: corti_429/);
  });
}

// 13. A later wave is not routed: it reads the set's stored name back.
{
  calls.router = [];
  globalThis.__fakeClient = fakeClient({
    isPro: true,
    memory: { history: [], setRows: [{ focus: null, requested: "DKA", canonical: "Diabetic ketoacidosis" }] },
  });
  await run({ topic: "DKA", system: "endocrine", startIndex: 6 });
  const log = globalThis.__fakeClient.log;
  const setQuery = log.queries.find((q) => q.table === "questions" && q.op === "select");
  check("later wave not routed", () => assert.equal(calls.router.length, 0));
  check("later wave looks its set up by generation id", () =>
    assert.ok(setQuery?.filters.some(([op, col, v]) => op === "eq" && col === "generation_meta->>generationId" && v === "gen-1")));
  check("later wave keeps the canonical name", () =>
    assert.ok(metaOf(log.inserts).every((m) => m.canonicalTopic === "Diabetic ketoacidosis" && m.topicKey === "diabetic ketoacidosis")));
}

// 14. A later wave with nothing stored falls back to what was typed — and
//     never builds a shared blueprint under it.
{
  globalThis.__fakeClient = fakeClient({ isPro: true, memory: { history: [], setRows: [] } });
  await run({ topic: "DKA", system: "endocrine", startIndex: 6 });
  const log = globalThis.__fakeClient.log;
  check("fallback name keyed but not stored as canonical", () =>
    assert.ok(metaOf(log.inserts).every((m) => m.topicKey === "dka" && m.canonicalTopic === null)));
  check("no blueprint claimed for a fallback name", () => assert.ok(!log.rpc.some((c) => c.name === "claim_qbank_blueprint_build")));
}

// 15. History unreadable: the wave is written blind, and says so.
{
  const streamsBefore = calls.stream;
  globalThis.__fakeClient = fakeClient({ isPro: true, memory: { historyError: "function qbank_topic_history does not exist" } });
  const { status, metas } = await run({ topic: "DKA", system: undefined });
  const rows = metaOf(globalThis.__fakeClient.log.inserts);
  check("unreadable history still generates", () => {
    assert.equal(status, 200);
    assert.equal(calls.stream, streamsBefore + 1);
    assert.equal(metas.filter((m) => m.questionReady).length, 5);
  });
  check("blind wave recorded on its rows", () => assert.equal(rows[0].repetition.memory, "unavailable"));
  check("blind wave assigns nothing and lists nothing", () => {
    assert.ok(rows.every((m) => m.concept === null));
    assert.ok(!userMessage().includes("do not re-test"));
  });
}

// 16. A curriculum mix on its first wave: titles are canonical as given, and
//     at most two builds start.
{
  calls.router = [];
  globalThis.__fakeClient = fakeClient({ isPro: true, memory: { history: [] } });
  await run({
    topic: undefined,
    system: undefined,
    topics: ["Heart failure", "Nephrotic syndrome", "SPIKES protocol"],
    systems: ["cardiovascular", "renal", "social_sciences"],
  });
  const log = globalThis.__fakeClient.log;
  const claims = log.rpc.filter((c) => c.name === "claim_qbank_blueprint_build");
  check("curriculum titles used as given, unrouted", () => {
    assert.equal(calls.router.length, 0);
    assert.deepEqual(
      [...new Set(metaOf(log.inserts).map((m) => m.canonicalTopic))].sort(),
      ["Heart failure", "Nephrotic syndrome", "SPIKES protocol"]
    );
  });
  check("history read only for the wave's own topics", () =>
    assert.deepEqual([...log.rpc.find((c) => c.name === "qbank_topic_history").args.p_keys].sort(), ["heart failure", "nephrotic syndrome", "spikes protocol"]));
  check("at most two builds per wave", () => assert.equal(claims.length, 2));
}

// 17. The probe chose the key but objected to the item: held back like a gate
// block, stored as such, and not charged to a free account.
{
  // Item 1 is otherwise clean; item 5 carries a writer flag, so without the
  // objection it would go on to the fact check.
  probeObjections = {
    1: { solvable: false, issue: "Options A and C are essentially identical." },
    5: { solvable: true, issue: "No option names the actual cause." },
  };
  const flagChecksBefore = calls.flagCheck;
  globalThis.__fakeClient = fakeClient({ granted: 5, remaining: 5 });
  const { metas } = await run({});
  probeObjections = {};
  const log = globalThis.__fakeClient.log;
  const byIndex = Object.fromEntries(metas.filter((m) => m.questionReady).map((m) => [m.questionReady.index, m.questionReady]));
  const done = metas.find((m) => m.waveComplete)?.waveComplete;
  const row = (n) => log.inserts.find((r) => r.generation_meta.index === n)?.generation_meta;
  check("probe objection blocks an agreed item", () =>
    assert.ok(byIndex[1].agreed && byIndex[1].blocked && byIndex[5].agreed && byIndex[5].blocked));
  check("probe objection named as the block rule", () =>
    assert.deepEqual([byIndex[1].blockRule, byIndex[5].blockRule], ["probe-concern", "probe-concern"]));
  check("probe objection stored on the row as qaBlocked", () => {
    assert.equal(row(1).qaBlocked, true);
    assert.ok(row(1).qa.some((f) => f.rule === "probe-concern" && f.detail.includes("essentially identical")));
  });
  check("only item 2 delivered, the other four not charged", () => {
    assert.ok(!byIndex[2].blocked && byIndex[2].agreed);
    assert.equal(done.blocked, 3);
    assert.equal(log.rpc.find((c) => c.name === "release_usage")?.args.p_n, 4);
  });
  check("an objected item is not fact-checked as well", () => assert.equal(calls.flagCheck - flagChecksBefore, 0));
}

// 18. The second blind read, on another model: its disagreement holds an item
// the first read passed; when it fails, it changes nothing.
{
  secondReadWrong = new Set([2]);
  globalThis.__fakeClient = fakeClient({ granted: 5, remaining: 5 });
  const { metas } = await run({});
  secondReadWrong = new Set();
  const log = globalThis.__fakeClient.log;
  const byIndex = Object.fromEntries(metas.filter((m) => m.questionReady).map((m) => [m.questionReady.index, m.questionReady]));
  const row = (n) => log.inserts.find((r) => r.generation_meta.index === n)?.generation_meta;
  check("second read's disagreement holds item 2", () => assert.equal(byIndex[2].agreed, false));
  check("both reads stored, the combined verdict gating", () => {
    assert.equal(row(2).reads.primary.agreed, true);
    assert.equal(row(2).reads.second.agreed, false);
    assert.equal(row(2).verification.agreed, false);
  });
  check("item 1 still delivered", () => assert.ok(!byIndex[1].blocked && byIndex[1].agreed));

  secondReadDown = true;
  globalThis.__fakeClient = fakeClient({ granted: 5, remaining: 5 });
  const down = await run({});
  secondReadDown = false;
  const ready = Object.fromEntries(down.metas.filter((m) => m.questionReady).map((m) => [m.questionReady.index, m.questionReady]));
  check("a failed second read changes nothing", () => assert.ok(ready[1].agreed && ready[2].agreed && ready[4].agreed === false));
}

// 19. The ambiguity review: a second defensible answer holds an item both
// blind reads passed; an item the gate already blocked is never reviewed.
{
  ambiguityDefects = { 1: "second_answer" };
  const before = calls.ambiguity;
  globalThis.__fakeClient = fakeClient({ granted: 5, remaining: 5 });
  const { metas } = await run({});
  ambiguityDefects = {};
  const log = globalThis.__fakeClient.log;
  const byIndex = Object.fromEntries(metas.filter((m) => m.questionReady).map((m) => [m.questionReady.index, m.questionReady]));
  const row = (n) => log.inserts.find((r) => r.generation_meta.index === n)?.generation_meta;
  check("reviewer's second answer holds item 1", () => {
    assert.equal(byIndex[1].blocked, true);
    assert.equal(byIndex[1].blockRule, "reviewer-ambiguity");
  });
  check("the review is stored on every reviewed row", () => {
    assert.equal(row(1).ambiguity.defect, "second_answer");
    assert.equal(row(2).ambiguity.defect, "none");
  });
  check("a gate-blocked item is not reviewed", () => {
    assert.equal(row(3).ambiguity, null);
    assert.equal(calls.ambiguity - before, 4);
  });
  check("item 2 still delivered", () => assert.ok(!byIndex[2].blocked && byIndex[2].agreed));
}

console.log(results.join("\n"));
console.log(`calls: ${JSON.stringify(calls)}`);
