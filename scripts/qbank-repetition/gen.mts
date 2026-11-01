// Generates SESSIONS consecutive 5-question sessions per (topic, arm), as one
// student typing the same topic again on different days. Resumable: a session
// whose file exists is read back, not regenerated.
import fs from "node:fs";
import path from "node:path";
import {
  OUT, config, readJson, writeJson, slug, pool, cortiJson, streamWriter,
  buildBatchPlan, buildUserMessage, systemPromptFor, prepareBatch, verifyOne,
  SYSTEM_ROUTER_PROMPT, SYSTEM_KEYS, SYSTEM_NAMES, stripFences, cortiComplete,
} from "./common.mts";

const SESSIONS = Number(process.env.SESSIONS ?? 4);
const COUNT = 5;

export const TOPICS = [
  { topic: "heart failure", examMode: "step2ck" },
  { topic: "diabetic ketoacidosis", examMode: "step1" },
  { topic: "warfarin", examMode: "step1" },
];

export const ARMS = ["A", "B1", "B2", "C", "D"] as const;
type Arm = (typeof ARMS)[number];
const TEMP: Record<Arm, number> = { A: 0.7, B1: 0.7, B2: 0.7, C: 0.7, D: 1.0 };

/** Same plan (orders, letters) for session k of a topic in every arm. */
function seeded(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

async function route(topic: string) {
  const p = path.join(OUT, "route", `${slug(topic)}.json`);
  if (fs.existsSync(p)) return readJson(p);
  const raw = await cortiComplete(config, {
    model: config.routerModel, temperature: 0, maxTokens: 200, json: true,
    messages: [{ role: "system", content: SYSTEM_ROUTER_PROMPT }, { role: "user", content: topic }],
  });
  const parsed = JSON.parse(stripFences(raw));
  const r = { system: SYSTEM_KEYS.includes(parsed.system) ? parsed.system : "cardiovascular", confidence: parsed.confidence };
  writeJson(p, r);
  return r;
}

// ── Arm C: the topic's concept blueprint, built once and shared ────────────
async function blueprint(topic: string, system: string, examMode: string) {
  const p = path.join(OUT, "blueprint", `${slug(topic)}.json`);
  if (fs.existsSync(p)) return readJson(p);
  const exam = examMode === "step2ck" ? "USMLE Step 2 CK" : "USMLE Step 1";
  const scope = examMode === "step2ck"
    ? "Step 2 CK tests clinical decisions: diagnosis, the next best step, the study to order and how to read it, the drug or intervention for this patient, complications, prevention."
    : "Step 1 tests foundational science: mechanism, pathophysiology, pharmacology MOA and adverse effects, biochemistry, histology, and pattern recognition tied to mechanism — not management protocols.";
  const out = await cortiJson([
    { role: "system", content: `You map a medical study topic onto the distinct concepts a ${exam} question bank tests on it. ${scope}` },
    {
      role: "user",
      content: `Topic: ${topic}
System: ${SYSTEM_NAMES[system]}
Exam: ${exam}

List the distinct testable concepts for this topic on this exam. A concept is ONE specific fact, mechanism, interpretation or decision that a single multiple-choice item's correct answer can turn on. Phrase each as the point tested, in at most 15 words, not as a heading and not as an explanation: "Hypokalemia potentiates digoxin toxicity at the Na/K-ATPase", not "Digoxin", and not a paragraph.

Rules:
- Two concepts must never be answerable from the same learning. If a student who learned one would answer an item on the other without new knowledge, they are one concept — merge them. Before you answer, check every pair: where one is a consequence, a restatement or the clinical face of another, merge them.
- Stay squarely within the topic and within the exam's scope.
- Order by yield, highest first, and tag each: "core" (on nearly every exam form), "standard", or "extended" (fair, less common).
- Give between 18 and 30, as many as the topic genuinely holds. A narrow topic holds fewer; do not pad with obscure detail.

Return {"concepts":[{"id":"c1","concept":"...","tier":"core"}]}`,
    },
  ], { maxTokens: 20000, model: process.env.BP_MODEL ?? "corti-s1", temperature: 0.3, json: false });
  writeJson(p, out);
  return out;
}

const compact = (q: any) => ({
  index: q.index, subtopic: q.subtopic, difficulty: q.difficulty, reasoningOrder: q.reasoningOrder,
  vignette: q.vignette, leadIn: q.leadIn, options: q.options, correctOption: q.correctOption,
  keyText: q.options?.[q.correctOption], teachingPoint: q.teachingPoint, explanation: q.explanation,
  reviewerFlag: q.reviewerFlag, examTrack: q.examTrack,
});

function ledgerBlock(history: any[]) {
  return `
## This student's earlier sessions on this topic — do not re-test

This student has already answered these items on this topic in earlier sessions. Each line is the fact the item turned on.
${history.map((h) => `- ${h.subtopic}: ${String(h.teachingPoint).slice(0, 240)}`).join("\n")}

Every item in this batch must turn on a fact, mechanism or decision that is NOT on this list. The same fact in a new patient, a new vignette or a reversed lead-in is still a repeat. When the topic's most familiar facets are used up, go to other high-yield facets that are still squarely within the topic — never to obscure detail just to be new.
`;
}

function withConcepts(message: string, assigned: { concept: string }[]) {
  let i = 0;
  const rows = message.replace(/^- Question (\d+): (.*)$/gm, (_m, n, rest) => `- Question ${n}: ${rest} — concept: ${assigned[i++]?.concept ?? "any"}`);
  return rows.replace(
    "Write each item at the reasoning order assigned to it, and put its correct answer on whichever option is correct.",
    "Write each item at the reasoning order assigned to it, and put its correct answer on whichever option is correct.\n\nEach plan row names the concept its item must turn on. Write the item so its correct answer depends on that concept and not on any other row's; choose the patient, the lead-in direction and the distractors yourself. The concept is what the item tests, not the wording of its key: the options stay short, parallel and of equal length as the rules require."
  );
}

async function runSession(arm: Arm, t: (typeof TOPICS)[number], system: string, k: number, prior: any[], bp: any) {
  const file = path.join(OUT, arm, slug(t.topic), `s${k}.json`);
  if (fs.existsSync(file)) return readJson(file);

  const plan = buildBatchPlan(system, COUNT, seeded(hash(`${t.topic}#${k}`)), 1, "balanced", t.examMode, []);
  const seen = prior.flatMap((s) => s.items.filter((x: any) => x.playable));

  let avoid: string[] = [];
  if (arm === "B1") avoid = [...new Set(seen.map((x: any) => x.subtopic))].slice(0, 40);
  let user = buildUserMessage({ topic: t.topic, plan, avoidSubtopics: avoid });
  if (arm === "B2" && seen.length) user = user.replace("\n## Requested topic", `${ledgerBlock(seen)}\n## Requested topic`);
  let assigned: any[] = [];
  if (arm === "C") {
    const used = new Set(seen.map((x: any) => x.conceptId));
    assigned = bp.concepts.filter((c: any) => !used.has(c.id)).slice(0, COUNT);
    user = withConcepts(user, assigned);
  }

  const { content, ms } = await streamWriter(systemPromptFor(plan), user, TEMP[arm]);
  const prepared = prepareBatch(content, plan);
  const qs = prepared.questions.slice(0, plan.questions.length);
  const verdicts = await Promise.all(qs.map((q: any) => verifyOne(config, q, q.examTrack)));
  const items = qs.map((q: any, i: number) => {
    const qa = prepared.qa[i];
    const v = verdicts[i];
    return {
      ...compact(q),
      blocked: !!qa?.blocked,
      blockRules: (qa?.findings ?? []).filter((f: any) => f.severity === "block").map((f: any) => f.rule),
      agreed: v.agreed, verifierIssue: v.issue, verifierError: v.error,
      playable: !qa?.blocked && v.agreed,
      ...(arm === "C" ? { conceptId: assigned[i]?.id, assignedConcept: assigned[i]?.concept } : {}),
    };
  });
  const rec = { arm, topic: t.topic, examMode: t.examMode, system, session: k, temperature: TEMP[arm], ms, userMessage: user, rawChars: content.length, items };
  writeJson(file, rec);
  console.log(`${arm.padEnd(2)} ${t.topic.padEnd(22)} s${k} ${items.length} items, ${items.filter((x: any) => x.playable).length} playable, ${Math.round(ms / 1000)}s`);
  return rec;
}

async function chain(arm: Arm, t: (typeof TOPICS)[number]) {
  const { system } = await route(t.topic);
  const bp = arm === "C" ? await blueprint(t.topic, system, t.examMode) : null;
  const sessions: any[] = [];
  for (let k = 1; k <= SESSIONS; k++) {
    try {
      sessions.push(await runSession(arm, t, system, k, sessions, bp));
    } catch (err) {
      console.log(`FAIL ${arm} ${t.topic} s${k}: ${err instanceof Error ? err.message : err}`);
      return;
    }
  }
}

const onlyArms = process.env.ONLY_ARMS?.split(",");
const onlyTopics = process.env.ONLY_TOPICS?.split(",");
for (const t of TOPICS) console.log(t.topic, "→", (await route(t.topic)).system);
const jobs = ARMS.filter((a) => !onlyArms || onlyArms.includes(a))
  .flatMap((arm) => TOPICS.filter((t) => !onlyTopics || onlyTopics.includes(slug(t.topic))).map((t) => [arm, t] as const));
const t0 = Date.now();
await pool(jobs, Number(process.env.CONCURRENCY ?? 8), ([arm, t]) => chain(arm, t));
console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
