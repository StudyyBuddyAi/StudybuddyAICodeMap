/**
 * medical-notes provider comparison — the runner.
 *
 * Sends every case in cases.ts through the deployed medical-notes-corti edge
 * function in eval mode, once per arm, and stores the streamed text plus the
 * function's __meta.eval timings and usage. Both providers therefore run the
 * same retrieval, the same prompt builder and the same relay; the only
 * variable is the model (and, for tuned arms, the prompt set).
 *
 *   node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/run.ts
 *
 * Knobs (env): NOTES_EVAL_ARMS=P0-haiku,P1-s1i  NOTES_EVAL_CASES=sheet-dka
 * NOTES_EVAL_RUN=<name> (output folder)  NOTES_EVAL_CONCURRENCY=4
 * NOTES_EVAL_PROMPTS=tuned (overrides every Corti arm's prompt set)
 * NOTES_EVAL_SAMPLES=3 (repeat each case; sample 1 keeps the unsuffixed file name).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv, getEvalSession } from "./session.ts";
import { ARMS, CASES, type Arm, type EvalCase } from "./cases.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
loadDotEnv(ROOT);

const FN_URL = `${process.env.VITE_SUPABASE_URL}/functions/v1/medical-notes-corti`;
const RUN = process.env.NOTES_EVAL_RUN ?? new Date().toISOString().replace(/[:.]/g, "-");
const OUT = path.join(HERE, "out", RUN);
const CONCURRENCY = Number(process.env.NOTES_EVAL_CONCURRENCY ?? 4);
const SAMPLES = Math.max(1, Number(process.env.NOTES_EVAL_SAMPLES ?? 1));

const pick = <T extends { id: string }>(all: T[], env?: string) =>
  env ? all.filter((x) => env.split(",").some((p) => x.id === p || x.id.startsWith(p))) : all;

const arms: Arm[] = pick(ARMS, process.env.NOTES_EVAL_ARMS).map((a) =>
  process.env.NOTES_EVAL_PROMPTS === "tuned" && a.provider === "corti"
    ? { ...a, id: `${a.id}+tuned`, prompts: "tuned" }
    : a
);
const cases: EvalCase[] = pick(CASES, process.env.NOTES_EVAL_CASES);

export interface RunRecord {
  arm: Arm;
  case: EvalCase;
  /** 1-based repeat index. */
  sample?: number;
  ok: boolean;
  status: number;
  error: string | null;
  text: string;
  modelHeader: string | null;
  retrievedChunks: number | null;
  eval: {
    ttfbMs: number | null;
    ttfcMs: number | null;
    totalMs: number;
    reasoningChars: number;
    finishReason: string | null;
    usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | null;
  } | null;
  clientTotalMs: number;
}

/**
 * Retrieval, fetched once per case and shared by every arm and every later run,
 * so a comparison never hands two models different guideline context. A call
 * that errors (retrieval is fail-open, so an error looks like "no matches") is
 * retried rather than cached as an empty result.
 */
const RETRIEVAL_DIR = path.join(HERE, "out", "retrieval");
async function sharedChunks(token: string, c: EvalCase): Promise<unknown[] | null> {
  if (c.kind !== "sheet" && c.kind !== "cards") return null;
  const file = path.join(RETRIEVAL_DIR, `${c.id}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")).chunks;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...c.body, eval: { provider: "corti", model: "corti-s1-instant", retrieveOnly: true } }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(body.chunks) && !body.error) {
      fs.mkdirSync(RETRIEVAL_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ chunks: body.chunks, attempts: attempt }, null, 2));
      console.log(`retrieval ${c.id}: ${body.chunks.length} chunks (attempt ${attempt})`);
      return body.chunks;
    }
    console.log(`retrieval ${c.id}: attempt ${attempt} failed — ${res.status} ${body.error ?? JSON.stringify(body).slice(0, 200)}`);
  }
  throw new Error(`retrieval for ${c.id} kept failing; not running arms on unequal context`);
}

async function runOne(token: string, arm: Arm, c: EvalCase, chunks: unknown[] | null): Promise<RunRecord> {
  const started = Date.now();
  const base = { arm, case: c, text: "", modelHeader: null, retrievedChunks: null, eval: null };
  let res: Response;
  try {
    res = await fetch(FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ...c.body,
        eval: {
          provider: arm.provider,
          model: arm.model,
          family: arm.family,
          prompts: arm.prompts,
          ...(arm.temperature !== undefined ? { temperature: arm.temperature } : {}),
          ...(chunks ? { chunks } : {}),
        },
      }),
      signal: AbortSignal.timeout(arm.timeoutMs ?? 300_000),
    });
  } catch (err) {
    return { ...base, ok: false, status: 0, error: String(err), clientTotalMs: Date.now() - started };
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    return { ...base, ok: false, status: res.status, error: body.slice(0, 500), clientTotalMs: Date.now() - started };
  }

  const record: RunRecord = { ...base, ok: true, status: res.status, error: null, modelHeader: res.headers.get("x-model-used"), clientTotalMs: 0 };
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split(/\n\n/);
      buffer = events.pop() ?? "";
      for (const ev of events) {
        const line = ev.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          if (parsed.__meta?.eval) record.eval = parsed.__meta.eval;
          else if (typeof parsed.__meta?.retrievedChunks === "number") record.retrievedChunks = parsed.__meta.retrievedChunks;
          const text = parsed.choices?.[0]?.delta?.content;
          if (typeof text === "string") record.text += text;
        } catch { /* partial frame */ }
      }
    }
  } catch (err) {
    // A connection reset or timeout mid-stream fails this attempt; it must not
    // take down the whole run.
    return { ...record, ok: false, status: 0, error: `stream error: ${String(err)}`, clientTotalMs: Date.now() - started };
  }
  record.clientTotalMs = Date.now() - started;
  if (!record.eval) {
    record.ok = false;
    record.error = "stream ended without __meta.eval (upstream stream broke?)";
  }
  return record;
}

const { accessToken } = await getEvalSession();
fs.mkdirSync(OUT, { recursive: true });

const chunksByCase = new Map<string, unknown[] | null>();
for (const c of cases) chunksByCase.set(c.id, await sharedChunks(accessToken, c));

const jobs = arms.flatMap((arm) =>
  cases.flatMap((c) => Array.from({ length: arm.samples ?? SAMPLES }, (_, i) => ({ arm, c, sample: i + 1 })))
);
console.log(`run ${RUN}: ${arms.length} arms × ${cases.length} cases, up to ${SAMPLES} samples = ${jobs.length} calls → ${OUT}`);

let next = 0;
let done = 0;
async function worker() {
  while (next < jobs.length) {
    const { arm, c, sample } = jobs[next++];
    const file = path.join(OUT, `${arm.id}__${c.id}${sample > 1 ? `__s${sample}` : ""}.json`);
    if (fs.existsSync(file)) {
      const prior = JSON.parse(fs.readFileSync(file, "utf8")) as RunRecord;
      if (prior.ok) { done++; continue; }
    }
    // One retry: a 429 or broken stream says nothing about output quality.
    const chunks = chunksByCase.get(c.id) ?? null;
    let rec = await runOne(accessToken, arm, c, chunks);
    // A timeout is a result for a latency-gated arm, not a transient failure.
    if (!rec.ok && !(arm.timeoutMs && rec.status === 0)) rec = await runOne(accessToken, arm, c, chunks);
    rec.sample = sample;
    fs.writeFileSync(file, JSON.stringify(rec, null, 2));
    done++;
    const e = rec.eval;
    console.log(
      `[${done}/${jobs.length}] ${arm.id.padEnd(16)} ${`${c.id}#${sample}`.padEnd(27)} ` +
        (rec.ok
          ? `${String(e?.totalMs).padStart(6)}ms ttfc=${e?.ttfcMs} out=${e?.usage?.completion_tokens ?? "?"}tok finish=${e?.finishReason} chunks=${rec.retrievedChunks ?? "-"}`
          : `FAILED ${rec.status}: ${rec.error?.slice(0, 160)}`)
    );
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`done → ${OUT}`);
