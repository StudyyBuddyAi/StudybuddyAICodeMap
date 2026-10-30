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
const calls = { stream: 0, verify: 0, flagCheck: 0, router: [] };
let lastStreamBody = null;
const ROUTES = { "heart failure": "cardiovascular", "nephrotic syndrome": "renal", "spikes protocol": "social_sciences", "banana bread": "not_medical" };
let streamStatus = 200;
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
      content = JSON.stringify({ system: ROUTES[user.toLowerCase()] ?? "cardiovascular", confidence: 0.9 });
    } else if (system.includes("board-certified physician")) {
      calls.flagCheck++;
      content = JSON.stringify({ verdict: n === 5 ? "outdated" : "confirmed", note: "test" });
    } else {
      calls.verify++;
      // Answer with the letter that carries the key text, except item 4.
      const letter = (/^([A-E])\. (.*)$/gm.exec ? [...user.matchAll(/^([A-E])\. (.*)$/gm)] : [])
        .find(([, , text]) => text === KEY_TEXT(n))?.[1]?.toLowerCase();
      const wrong = ["a", "b", "c", "d", "e"].find((l) => l !== letter);
      content = JSON.stringify({ answer: n === 4 ? wrong : letter, solvable: true, issue: "None." });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }
  return realFetch(url, init);
};

// ── Fake Supabase ────────────────────────────────────────────────────────────
function fakeClient({ isPro = false, granted = 5, remaining = 5 } = {}) {
  const log = { rpc: [], inserts: [] };
  let nextId = 1;
  const client = {
    log,
    auth: { getUser: async () => ({ data: { user: { id: "user-1", is_anonymous: false } }, error: null }) },
    rpc: async (name, args) => {
      log.rpc.push({ name, args });
      if (name === "reserve_usage") {
        return { data: { granted, count: 10 - remaining, remaining, date: "2026-10-30" }, error: null };
      }
      return { data: null, error: null };
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: table === "profiles" ? { is_pro: isPro, pro_expires_at: null } : null, error: null }) }),
      }),
      insert: (row) => {
        log.inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: `q-${nextId++}` }, error: null }) }) };
      },
    }),
  };
  return client;
}

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

console.log(results.join("\n"));
console.log(`calls: ${JSON.stringify(calls)}`);
