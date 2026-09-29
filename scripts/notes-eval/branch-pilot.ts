/**
 * Branch pilot: what a sheet suggests growing, and the branches it grows.
 *
 * For each case: the high-yield sheet (reused from an earlier run when one is
 * named, else written now), the suggest call on it, then the branches a
 * comprehensive sheet grows — the first two pills of each content section —
 * and one branch grown from a branch, to check the path goes further rather
 * than repeating itself.
 *
 * Runs the production prompt builders locally against Corti (corti-s1-instant,
 * temperature 0.3, the writer branches use) — never OpenRouter. Grounding is
 * the cached retrieval in out/retrieval, so no embedding calls are made.
 *
 *   node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/branch-pilot.ts
 *
 * Knobs (env): BRANCH_PILOT_RUN=<name> (output folder), BRANCH_PILOT_CASES=sbo,dka,
 * BRANCH_PILOT_GROW=0 (suggest only). Finished calls are kept and skipped on a rerun.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDotEnv } from "./session.ts";

(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => process.env[k] } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
loadDotEnv(ROOT);

const SHARED = path.join(ROOT, "supabase/functions/_shared");
const mod = (name: string) => import(pathToFileURL(path.join(SHARED, `${name}.ts`)).href);
const branch = await mod("sheet-branch-prompts");
const planMod = await mod("sheet-plan");
const notes = await mod("medical-notes-prompts-corti");
const { cortiChatCompletion, cortiConfigFromEnv } = await mod("corti");
const { parseSheetOutput } = await import("../../src/lib/parse-partial-sheet.ts");

const RUN = process.env.BRANCH_PILOT_RUN ?? "branch-pilot";
const OUT = path.join(HERE, "out", RUN);
fs.mkdirSync(OUT, { recursive: true });

interface Case {
  id: string;
  notes: string;
  examMode: string;
  difficulty: string;
  archetype: string;
  /** A high-yield sheet already written, under out/. */
  sheetFrom: string | null;
  retrieval: string | null;
}

const CASES: Case[] = [
  { id: "sbo", notes: "Small bowel obstruction", examMode: "USMLE Step 2", difficulty: "Advanced", archetype: "condition", sheetFrom: null, retrieval: null },
  { id: "dka", notes: "Diabetic ketoacidosis", examMode: "USMLE Step 2", difficulty: "Intermediate", archetype: "condition", sheetFrom: "depth-pilot-r5/sheet__corti-hy__dka.json", retrieval: "sheet-dka" },
  { id: "warfarin", notes: "Warfarin mechanism, monitoring and reversal", examMode: "USMLE Step 1", difficulty: "Basic", archetype: "drug", sheetFrom: "depth-pilot-r5/sheet__corti-hy__warfarin.json", retrieval: "sheet-warfarin-student" },
  { id: "hfref", notes: "Heart failure with reduced ejection fraction", examMode: "USMLE Step 1", difficulty: "Basic", archetype: "condition", sheetFrom: "depth-pilot-r5/sheet__corti-hy__hfref.json", retrieval: "sheet-hfref" },
];

const only = process.env.BRANCH_PILOT_CASES?.split(",");
const cases = CASES.filter((c) => !only || only.includes(c.id));
const GROW = process.env.BRANCH_PILOT_GROW !== "0";
const STUDY_AIDS = ["keyPoints", "memoryHooks", "examTraps"];

type Msg = { role: "system" | "user"; content: string };

interface CallRecord {
  ok: boolean;
  error: string | null;
  text: string;
  ttfcMs: number | null;
  totalMs: number;
  finishReason: string | null;
  usage: { completion_tokens?: number } | null;
}

async function corti(messages: Msg[], maxTokens: number): Promise<CallRecord> {
  const started = Date.now();
  const rec: CallRecord = { ok: false, error: null, text: "", ttfcMs: null, totalMs: 0, finishReason: null, usage: null };
  try {
    const res: Response = await cortiChatCompletion(cortiConfigFromEnv(), {
      model: "corti-s1-instant",
      messages,
      stream: true,
      streamUsage: true,
      temperature: 0.3,
      maxTokens,
      signal: AbortSignal.timeout(240_000),
    });
    if (!res.ok || !res.body) throw new Error(`${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const ev of events) {
        const line = ev.split("\n").find((l) => l.startsWith("data:"));
        const payload = line?.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          if (parsed.usage) rec.usage = parsed.usage;
          const choice = parsed.choices?.[0];
          if (choice?.finish_reason) rec.finishReason = choice.finish_reason;
          const t = choice?.delta?.content;
          if (typeof t === "string" && t) {
            if (rec.ttfcMs === null) rec.ttfcMs = Date.now() - started;
            rec.text += t;
          }
        } catch { /* partial frame */ }
      }
    }
    rec.ok = rec.text.length > 0;
    if (!rec.ok) rec.error = `empty (finish ${rec.finishReason})`;
  } catch (err) {
    rec.error = String(err);
  }
  rec.totalMs = Date.now() - started;
  return rec;
}

const file = (...parts: string[]) => path.join(OUT, `${parts.join("__")}.json`);
const cached = (f: string): CallRecord | null => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const chunksFor = (c: Case) =>
  c.retrieval ? JSON.parse(fs.readFileSync(path.join(HERE, "out", "retrieval", `${c.retrieval}.json`), "utf8")).chunks : [];

const jsonOf = (text: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return null;
  }
};

async function call(f: string, prompts: { systemPrompt: string; userContent: string }, maxTokens: number, what: string) {
  const prior = cached(f);
  if (prior?.ok) return prior;
  const rec = await corti(
    [
      { role: "system", content: prompts.systemPrompt },
      { role: "user", content: prompts.userContent },
    ],
    maxTokens
  );
  fs.writeFileSync(f, JSON.stringify({ what, prompts, ...rec }, null, 2));
  console.log(`${what.padEnd(48)} ${rec.ok ? `${rec.totalMs}ms out=${rec.usage?.completion_tokens ?? "?"} finish=${rec.finishReason}` : `FAILED ${rec.error}`}`);
  return rec;
}

async function sheetFor(c: Case): Promise<{ plan: string[]; sections: Record<string, unknown>; topic: string } | null> {
  if (c.sheetFrom) {
    const rec = JSON.parse(fs.readFileSync(path.join(HERE, "out", c.sheetFrom), "utf8"));
    const parsed = parseSheetOutput(rec.text);
    if (!parsed) return null;
    return { plan: rec.plan, sections: { ...(parsed.sheet.sections ?? {}) }, topic: parsed.sheet.topic || c.notes };
  }
  const plan = planMod.resolveSheetPlan({ archetype: c.archetype, examMode: c.examMode, difficulty: c.difficulty });
  const prompts = notes.buildCortiNotesPrompts({
    notes: c.notes,
    examMode: c.examMode,
    difficulty: c.difficulty,
    depth: "highYield",
    plan,
    groundingAttempted: false,
    ragChunks: [],
    hasMemory: false,
    family: "haiku",
  });
  const rec = await call(file("sheet", c.id), prompts, 8192, `sheet ${c.id}`);
  const parsed = rec.ok ? parseSheetOutput(rec.text) : null;
  if (!parsed) return null;
  return { plan: plan.map((s: { key: string }) => s.key), sections: { ...(parsed.sheet.sections ?? {}) }, topic: parsed.sheet.topic || c.notes };
}

interface Pill {
  section: string;
  line: number;
  type: string;
  label: string;
  ask: string;
  versus?: string;
}

async function runCase(c: Case) {
  const sheet = await sheetFor(c);
  if (!sheet) return console.log(`${c.id}: no sheet`);
  const base = { plan: sheet.plan, sections: sheet.sections, topic: sheet.topic, sourceIds: [] };
  const ctx = { examMode: c.examMode, difficulty: c.difficulty, ragChunks: chunksFor(c) };

  const suggestReq = branch.parseBranchRequest({ action: "suggest", ...base });
  if (!suggestReq) return console.log(`${c.id}: suggest request invalid`);
  const suggested = await call(file("suggest", c.id), branch.buildSuggestPrompts({ request: suggestReq, ...ctx }), branch.SUGGEST_MAX_TOKENS, `suggest ${c.id}`);
  const raw = jsonOf(suggested.text);
  const all = (Array.isArray(raw?.pills) ? raw!.pills : []) as Pill[];
  const valid = all.filter((p) => {
    const q = branch.parseQuestion(p, branch.SUGGESTED_TYPES);
    return q && sheet.plan.includes(p.section) && branch.lineAt(suggestReq.sections, `${p.section}:${p.line}`) !== null;
  });
  console.log(`\n${c.id}: ${valid.length}/${all.length} pills valid`);
  for (const p of all) {
    const ok = valid.includes(p) ? " " : "✗";
    console.log(`  ${ok} ${p.section}:${p.line} [${p.type}] ${p.label}${p.versus ? ` (vs ${p.versus})` : ""}\n      ${p.ask}`);
  }
  if (!GROW) return;

  // What a comprehensive sheet grows: the first two of each content section.
  const bySection = new Map<string, Pill[]>();
  for (const p of valid) bySection.set(p.section, [...(bySection.get(p.section) ?? []), p]);
  const picks = [...bySection.entries()].filter(([k]) => !STUDY_AIDS.includes(k)).flatMap(([, ps]) => ps.slice(0, 2));

  const grown = await Promise.all(
    picks.map(async (p, i) => {
      const req = branch.parseBranchRequest({
        action: "grow",
        ...base,
        anchor: `${p.section}:${p.line}`,
        question: p,
        path: [],
        others: valid.filter((o) => o !== p).map((o) => ({ label: o.label, ask: o.ask })),
      });
      if (!req) return console.log(`  grow ${p.label}: invalid request`);
      const rec = await call(file("grow", c.id, String(i)), branch.buildGrowPrompts({ request: req, ...ctx }), branch.GROW_MAX_TOKENS, `grow ${c.id} ${i} [${p.type}] ${p.label}`.slice(0, 48));
      return { p, rec, json: jsonOf(rec.text) };
    })
  );
  for (const g of grown) {
    if (!g) continue;
    const keys = g.json ? Object.keys(g.json) : ["UNPARSEABLE"];
    const want = branch.BODY_KEYS[g.p.type];
    const missing = want.filter((k: string) => !(k in (g.json ?? {})));
    console.log(`  ${g.p.type.padEnd(12)} ${g.p.label.padEnd(44)} keys=${keys.join(",")}${missing.length ? ` MISSING=${missing.join(",")}` : ""}`);
  }

  // One branch of a branch: the first grown branch's first suggestion.
  const first = grown.find((g) => g?.json && Array.isArray(g.json.next) && g.json.next.length);
  if (!first) return;
  const nextQ = (first.json!.next as Pill[])[0];
  const parentText = JSON.stringify(Object.fromEntries(branch.BODY_KEYS[first.p.type].map((k: string) => [k, first.json![k]])));
  const req = branch.parseBranchRequest({
    action: "grow",
    ...base,
    anchor: `${first.p.section}:${first.p.line}`,
    question: nextQ,
    path: [{ label: first.p.label, text: parentText }],
    others: [],
  });
  if (!req) return console.log(`  nested: invalid request ${JSON.stringify(nextQ)}`);
  const rec = await call(file("grow", c.id, "nested"), branch.buildGrowPrompts({ request: req, ...ctx }), branch.GROW_MAX_TOKENS, `grow ${c.id} nested [${nextQ.type}] ${nextQ.label}`.slice(0, 48));
  console.log(`  nested from "${first.p.label}": [${nextQ.type}] ${nextQ.label} → ${rec.ok ? "ok" : "failed"}`);
}

for (const c of cases) await runCase(c);
