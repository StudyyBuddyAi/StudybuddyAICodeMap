// Shared setup for the cross-session repetition study (docs/qbank/repetition-study-2026-11.md).
// Loads the repo's production QBank modules exactly as scripts/qbank-eval/run.ts
// does (Deno env shim + .env), and never writes to the database.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

export const EXP = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(EXP, "../..");
export const OUT = process.env.REPETITION_OUT ?? path.join(EXP, "out");

for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
(globalThis as any).Deno = { env: { get: (k: string) => process.env[k] } };

const P = await import(pathToFileURL(path.join(ROOT, "supabase/functions/_shared/qbank-prompt.ts")).href);
const PERSIST = await import(pathToFileURL(path.join(ROOT, "supabase/functions/_shared/qbank-persist.ts")).href);
const VERIFY = await import(pathToFileURL(path.join(ROOT, "supabase/functions/_shared/qbank-verify.ts")).href);
const CORTI = await import(pathToFileURL(path.join(ROOT, "supabase/functions/_shared/corti.ts")).href);

export const { buildBatchPlan, buildUserMessage, systemPromptFor, SYSTEM_ROUTER_PROMPT, SYSTEM_KEYS, SYSTEM_NAMES } = P;
export const { prepareBatch } = PERSIST;
export const { verifyOne } = VERIFY;
export const { cortiConfigFromEnv, cortiChatCompletion, cortiComplete } = CORTI;
export const config = cortiConfigFromEnv();

export const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
export const writeJson = (p: string, v: unknown) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 1));
};
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const stripFences = (raw: string) => raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

/** Non-streaming JSON call with one retry. */
export async function cortiJson(messages: { role: string; content: string }[], opts: { temperature?: number; maxTokens?: number; model?: string; json?: boolean } = {}) {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await cortiComplete(config, {
        ...(opts.model ? { model: opts.model } : {}),
        temperature: opts.temperature ?? 0,
        maxTokens: opts.maxTokens ?? 8000,
        json: opts.json ?? true,
        messages,
        signal: AbortSignal.timeout(900_000),
      });
      const text = stripFences(raw);
      return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

/** Streams the writer call the way qbank-generate does and returns the content. */
export async function streamWriter(system: string, user: string, temperature: number) {
  const t0 = Date.now();
  const res: Response = await cortiChatCompletion(config, {
    stream: true,
    temperature,
    maxTokens: 32768,
    json: true,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    signal: AbortSignal.timeout(420_000),
  });
  if (!res.ok || !res.body) throw new Error(`upstream ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const events = buf.split(/\r?\n\r?\n/);
    buf = events.pop() ?? "";
    for (const ev of events) {
      const line = ev.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const d = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (typeof d === "string") content += d;
      } catch {}
    }
  }
  return { content, ms: Date.now() - t0 };
}

/** Bounded-concurrency map. */
export async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}
