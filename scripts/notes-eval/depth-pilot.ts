/**
 * Historical: branches have since replaced depth passages (branch-pilot.ts).
 * The section-request contract no longer has expand or expandAll, so only the
 * sheets and regen phases still run; the outputs under out/depth-pilot* are
 * the record of what depth passages were.
 *
 * Depth pilot: high-yield and comprehensive sheets, against the Concise and
 * Detailed sheets they replace, plus the follow-ups on one section (deepen it,
 * rewrite it in a direction).
 *
 * Runs the prompt builders locally and calls each writer directly with its
 * production settings: Corti (corti-s1-instant, temperature 0.3, the premium
 * writer) and GPT-OSS 20B through OpenRouter (Cerebras/Groq, temperature 0.7,
 * the free writer). Nothing goes through a deployed function. The archetype
 * is fixed per case rather than classified, and grounding is the cached
 * retrieval in out/retrieval, so no embedding calls are made.
 *
 * GPT-OSS spends OpenRouter credit (well under a cent a sheet). The account is
 * small prepaid credit that production may share, so it runs only when
 * DEPTH_PILOT_WRITERS names it.
 *
 * A comprehensive sheet is two calls: the high-yield sheet, then expandAll on
 * it — the way the handler makes one.
 *
 * The baseline is today's prompt modules, exported from git into a folder:
 *
 *   mkdir -p <dir>/_shared && for m in sheet-sections sheet-plan sheet-schema \
 *     medical-notes-prompts medical-notes-prompts-corti memory personalize; do
 *     git show <ref>:supabase/functions/_shared/$m.ts > <dir>/_shared/$m.ts; done
 *   DEPTH_PILOT_BASELINE=<dir> node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/depth-pilot.ts
 *
 * Knobs (env): DEPTH_PILOT_RUN=<name> (output folder), DEPTH_PILOT_WRITERS=corti,gpt,
 * DEPTH_PILOT_PHASES=sheets,expandall,expand,regen, DEPTH_PILOT_ARMS=hy and
 * DEPTH_PILOT_CASES=dka. Finished calls are kept and skipped on a rerun.
 * Score with depth-score.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDotEnv } from "./session.ts";

(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => process.env[k] } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
loadDotEnv(ROOT);
// OPENROUTER_API_KEY lives in .env.local.
const LOCAL_ENV = path.join(ROOT, ".env.local");
if (fs.existsSync(LOCAL_ENV)) {
  for (const line of fs.readFileSync(LOCAL_ENV, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const SHARED = path.join(ROOT, "supabase/functions/_shared");
const BASELINE = process.env.DEPTH_PILOT_BASELINE;
if (!BASELINE) throw new Error("DEPTH_PILOT_BASELINE must name the folder holding the baseline _shared modules");

const mod = (dir: string, name: string) => import(pathToFileURL(path.join(dir, `${name}.ts`)).href);
const next = {
  prompts: await mod(SHARED, "medical-notes-prompts-corti"),
  plan: await mod(SHARED, "sheet-plan"),
  section: await mod(SHARED, "sheet-section-prompts"),
};
const base = {
  prompts: await mod(path.join(BASELINE, "_shared"), "medical-notes-prompts-corti"),
  plan: await mod(path.join(BASELINE, "_shared"), "sheet-plan"),
};
const { cortiChatCompletion, cortiConfigFromEnv } = await mod(SHARED, "corti");
const { parseSheetOutput } = await import("../../src/lib/parse-partial-sheet.ts");

const RUN = process.env.DEPTH_PILOT_RUN ?? "depth-pilot";
const OUT = path.join(HERE, "out", RUN);
fs.mkdirSync(OUT, { recursive: true });
const PHASES = (process.env.DEPTH_PILOT_PHASES ?? "sheets,expandall,expand,regen").split(",");
const only = (env: string | undefined) => (id: string) => !env || env.split(",").includes(id);

// ── Writers ─────────────────────────────────────────────────────────────────

export type WriterId = "corti" | "gpt";

interface Writer {
  id: WriterId;
  /** The prompt family production gives this writer. */
  family: "haiku" | "gptOss";
  stream: (messages: Msg[], maxTokens: number) => Promise<CallRecord>;
}

type Msg = { role: "system" | "user"; content: string };

export interface CallRecord {
  ok: boolean;
  error: string | null;
  text: string;
  ttfcMs: number | null;
  totalMs: number;
  /** When the text first reached each length, for timing a point inside it. */
  marks: [number, number][];
  finishReason: string | null;
  usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | null;
  /** Hidden reasoning the writer spent before it wrote, in characters. */
  reasoningChars: number;
}

/** Reads an OpenAI-shaped SSE stream into a record. */
async function readStream(res: Response, started: number): Promise<CallRecord> {
  const rec: CallRecord = { ok: false, error: null, text: "", ttfcMs: null, totalMs: 0, marks: [], finishReason: null, usage: null, reasoningChars: 0 };
  if (!res.ok || !res.body) {
    rec.error = `${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`;
    rec.totalMs = Date.now() - started;
    return rec;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const ev of events) {
      const line = ev.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload);
        if (parsed.usage) rec.usage = parsed.usage;
        const choice = parsed.choices?.[0];
        if (choice?.finish_reason) rec.finishReason = choice.finish_reason;
        const reasoning = choice?.delta?.reasoning ?? choice?.delta?.reasoning_content;
        if (typeof reasoning === "string") rec.reasoningChars += reasoning.length;
        const t = choice?.delta?.content;
        if (typeof t === "string" && t) {
          if (rec.ttfcMs === null) rec.ttfcMs = Date.now() - started;
          rec.text += t;
          rec.marks.push([rec.text.length, Date.now() - started]);
        }
      } catch { /* partial frame */ }
    }
  }
  rec.ok = rec.text.length > 0;
  if (!rec.ok) rec.error = `empty response (finish ${rec.finishReason})`;
  rec.totalMs = Date.now() - started;
  return rec;
}

const WRITERS: Record<WriterId, Writer> = {
  corti: {
    id: "corti",
    family: "haiku",
    stream: async (messages, maxTokens) => {
      const started = Date.now();
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
        return await readStream(res, started);
      } catch (err) {
        return { ok: false, error: String(err), text: "", ttfcMs: null, totalMs: Date.now() - started, marks: [], finishReason: null, usage: null, reasoningChars: 0 };
      }
    },
  },
  gpt: {
    id: "gpt",
    family: "gptOss",
    // The request medical-notes-handler.ts makes (openRouterStream), plus usage.
    stream: async (messages, maxTokens) => {
      const started = Date.now();
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "HTTP-Referer": "https://studybuddy.app",
            "X-Title": "StudyBuddy (depth pilot)",
          },
          body: JSON.stringify({
            model: "openai/gpt-oss-20b",
            stream: true,
            temperature: 0.7,
            max_tokens: maxTokens,
            messages,
            provider: { order: ["Cerebras", "Groq"], allow_fallbacks: true },
            usage: { include: true },
          }),
          signal: AbortSignal.timeout(240_000),
        });
        return await readStream(res, started);
      } catch (err) {
        return { ok: false, error: String(err), text: "", ttfcMs: null, totalMs: Date.now() - started, marks: [], finishReason: null, usage: null, reasoningChars: 0 };
      }
    },
  },
};

const writers = (process.env.DEPTH_PILOT_WRITERS ?? "corti").split(",").filter((w): w is WriterId => w in WRITERS).map((w) => WRITERS[w]);
if (writers.some((w) => w.id === "gpt") && !process.env.OPENROUTER_API_KEY) throw new Error("gpt needs OPENROUTER_API_KEY");

// ── Cases ───────────────────────────────────────────────────────────────────

export interface PilotCase {
  id: string;
  notes: string;
  examMode: string;
  difficulty: string;
  archetype: string;
  /** Cached retrieval in out/retrieval, or null for a topic the library has not been asked about. */
  retrieval: string | null;
}

export const PILOT_CASES: PilotCase[] = [
  { id: "dka", notes: "Diabetic ketoacidosis", examMode: "USMLE Step 2", difficulty: "Intermediate", archetype: "condition", retrieval: "sheet-dka" },
  { id: "hfref", notes: "Heart failure with reduced ejection fraction", examMode: "USMLE Step 1", difficulty: "Basic", archetype: "condition", retrieval: "sheet-hfref" },
  { id: "meningitis", notes: "Bacterial meningitis", examMode: "General", difficulty: "Advanced", archetype: "condition", retrieval: "sheet-meningitis-expert" },
  { id: "warfarin", notes: "Warfarin mechanism, monitoring and reversal", examMode: "USMLE Step 1", difficulty: "Basic", archetype: "drug", retrieval: "sheet-warfarin-student" },
  { id: "staph", notes: "Staphylococcus aureus", examMode: "USMLE Step 1", difficulty: "Intermediate", archetype: "organism", retrieval: null },
  { id: "urea", notes: "Urea cycle", examMode: "USMLE Step 1", difficulty: "Intermediate", archetype: "pathway", retrieval: null },
];

/** Sheet arms. A comprehensive sheet is "hy" plus the expandall phase. */
export type ArmId = "base-concise" | "base-detailed" | "hy";
export const ARMS: ArmId[] = ["base-concise", "base-detailed", "hy"];

/** One content section and one study aid, deepened on their own. */
const EXPAND: { id: string; keys: string[] }[] = [
  { id: "dka", keys: ["clinicalApproach", "examTraps"] },
  { id: "warfarin", keys: ["moa", "examTraps"] },
  { id: "urea", keys: ["cofactors", "keyPoints"] },
];

/** A rewrite the student asked for in their words, and one in a set direction. */
const REGEN: { id: string; key: string; style: string; instruction?: string }[] = [
  { id: "dka", key: "clinicalApproach", style: "custom", instruction: "focus more on potassium and fluids" },
  { id: "warfarin", key: "adverseEffects", style: "mechanism" },
];

const chunksFor = (c: PilotCase) =>
  c.retrieval
    ? JSON.parse(fs.readFileSync(path.join(HERE, "out", "retrieval", `${c.retrieval}.json`), "utf8")).chunks
    : [];

const fileFor = (...parts: string[]) => path.join(OUT, `${parts.join("__")}.json`);
const done = (file: string) => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).ok;
const cases = PILOT_CASES.filter((c) => only(process.env.DEPTH_PILOT_CASES)(c.id));

const log = (what: string, rec: CallRecord) =>
  console.log(
    `${what} ${rec.ok ? `${rec.totalMs}ms out=${rec.usage?.completion_tokens ?? "?"} finish=${rec.finishReason}${rec.reasoningChars ? ` reasoning=${rec.reasoningChars}ch` : ""}` : `FAILED ${rec.error}`}`
  );

// ── Sheets ──────────────────────────────────────────────────────────────────

function sheetPrompt(w: Writer, arm: ArmId, c: PilotCase) {
  const settings = { examMode: c.examMode, difficulty: c.difficulty };
  const common = { notes: c.notes, ...settings, groundingAttempted: true, ragChunks: chunksFor(c), hasMemory: false, family: w.family };
  if (arm === "hy") {
    const plan = next.plan.resolveSheetPlan({ archetype: c.archetype, ...settings });
    return { plan, prompts: next.prompts.buildCortiNotesPrompts({ ...common, depth: "highYield", plan }) };
  }
  const length = arm === "base-concise" ? "Concise" : "Detailed";
  const plan = base.plan.resolveSheetPlan({ archetype: c.archetype, ...settings, length });
  return { plan, prompts: base.prompts.buildCortiNotesPrompts({ ...common, length, plan }) };
}

async function runSheets() {
  const arms = ARMS.filter(only(process.env.DEPTH_PILOT_ARMS));
  const jobs = writers.flatMap((w) => arms.flatMap((arm) => cases.map((c) => ({ w, arm, c }))));
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const { w, arm, c } = jobs[i++];
      const file = fileFor("sheet", `${w.id}-${arm}`, c.id);
      if (done(file)) continue;
      const { plan, prompts } = sheetPrompt(w, arm, c);
      const rec = await w.stream(
        [
          { role: "system", content: prompts.systemPrompt },
          { role: "user", content: prompts.userContent },
        ],
        8192
      );
      fs.writeFileSync(file, JSON.stringify({ kind: "sheet", writer: w.id, arm: `${w.id}-${arm}`, case: c, plan: plan.map((s: { key: string }) => s.key), ...rec }, null, 2));
      log(`sheet ${`${w.id}-${arm}`.padEnd(18)} ${c.id.padEnd(10)}`, rec);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}

// ── Depth and rewrites ──────────────────────────────────────────────────────

/** A writer's high-yield sheet, as the page would hold it. */
function hySheet(w: Writer, c: PilotCase): { plan: string[]; sections: Record<string, unknown> } | null {
  const file = fileFor("sheet", `${w.id}-hy`, c.id);
  if (!fs.existsSync(file)) return null;
  const rec = JSON.parse(fs.readFileSync(file, "utf8"));
  const parsed = rec.ok ? parseSheetOutput(rec.text) : null;
  if (!parsed) {
    console.log(`  ${w.id}-hy ${c.id} does not parse — skipped`);
    return null;
  }
  return { plan: rec.plan, sections: { ...(parsed.sheet.sections ?? {}) } };
}

async function sectionCall(w: Writer, c: PilotCase, request: Record<string, unknown>, maxTokens: number) {
  const req = next.section.parseSectionRequest(request);
  if (!req) throw new Error(`invalid section request for ${c.id}`);
  const prompts = next.section.buildSectionPrompts({
    request: req,
    examMode: c.examMode,
    difficulty: c.difficulty,
    ragChunks: chunksFor(c),
  });
  return w.stream(
    [
      { role: "system", content: prompts.systemPrompt },
      { role: "user", content: prompts.userContent },
    ],
    // GPT-OSS reasons before it writes, against the same budget.
    w.id === "gpt" ? maxTokens + next.section.REASONING_HEADROOM : maxTokens
  );
}

/** The comprehensive sheet's second call: every content section's depth, from the high-yield sheet. */
async function runExpandAll() {
  await Promise.all(
    writers.flatMap((w) =>
      cases.map(async (c) => {
        const file = fileFor("expandall", w.id, c.id);
        if (done(file)) return;
        const sheet = hySheet(w, c);
        if (!sheet) return;
        const rec = await sectionCall(
          w,
          c,
          { action: "expandAll", topic: c.notes, plan: sheet.plan, sections: sheet.sections, sourceIds: [] },
          next.section.EXPAND_ALL_MAX_TOKENS
        );
        fs.writeFileSync(file, JSON.stringify({ kind: "expandall", writer: w.id, case: c, key: null, plan: sheet.plan, before: sheet.sections, ...rec }, null, 2));
        log(`expandall ${w.id.padEnd(6)} ${c.id.padEnd(10)}`, rec);
      })
    )
  );
}

async function runExpand() {
  await Promise.all(
    writers.flatMap((w) =>
      EXPAND.filter((e) => cases.some((c) => c.id === e.id)).flatMap((e) =>
        e.keys.map(async (key) => {
          const c = PILOT_CASES.find((x) => x.id === e.id)!;
          const file = fileFor("expand", w.id, c.id, key);
          if (done(file)) return;
          const sheet = hySheet(w, c);
          if (!sheet || !sheet.plan.includes(key)) return;
          const rec = await sectionCall(
            w,
            c,
            { action: "expand", key, topic: c.notes, plan: sheet.plan, sections: sheet.sections, sourceIds: [] },
            next.section.SECTION_MAX_TOKENS
          );
          fs.writeFileSync(file, JSON.stringify({ kind: "expand", writer: w.id, case: c, key, plan: sheet.plan, before: sheet.sections, ...rec }, null, 2));
          log(`expand ${w.id.padEnd(6)} ${c.id.padEnd(10)} ${key.padEnd(18)}`, rec);
        })
      )
    )
  );
}

async function runRegen() {
  await Promise.all(
    writers.flatMap((w) =>
      REGEN.filter((r) => cases.some((c) => c.id === r.id)).map(async (r) => {
        const c = PILOT_CASES.find((x) => x.id === r.id)!;
        const file = fileFor("regen", w.id, c.id, r.key);
        if (done(file)) return;
        const sheet = hySheet(w, c);
        if (!sheet) return;
        const rec = await sectionCall(
          w,
          c,
          { action: "regenerate", key: r.key, style: r.style, instruction: r.instruction, depth: "highYield", topic: c.notes, plan: sheet.plan, sections: sheet.sections, sourceIds: [] },
          next.section.SECTION_MAX_TOKENS
        );
        fs.writeFileSync(
          file,
          JSON.stringify({ kind: "regen", writer: w.id, case: c, key: r.key, instruction: r.instruction ?? r.style, plan: sheet.plan, before: sheet.sections, ...rec }, null, 2)
        );
        log(`regen  ${w.id.padEnd(6)} ${c.id.padEnd(10)} ${r.key.padEnd(18)}`, rec);
      })
    )
  );
}

if (PHASES.includes("sheets")) await runSheets();
if (PHASES.includes("expandall")) await runExpandAll();
if (PHASES.includes("expand")) await runExpand();
if (PHASES.includes("regen")) await runRegen();
console.log(`done → ${OUT}`);
