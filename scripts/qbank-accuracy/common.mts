// Shared setup for the QBank accuracy suite (docs/qbank/accuracy-2026-11.md §6).
// Loads the production check modules exactly as the edge function runs them
// (Deno env shim + .env), reads the live database read-only through the
// Supabase CLI, and caches every Corti call so a run can be resumed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
export const OUT = process.env.ACCURACY_OUT ?? path.join(HERE, "out");

for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
(globalThis as any).Deno = { env: { get: (k: string) => process.env[k] } };

const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
export const QA = await load("supabase/functions/_shared/qbank-qa.ts");
export const VERIFY = await load("supabase/functions/_shared/qbank-verify.ts");
export const CORTI = await load("supabase/functions/_shared/corti.ts");
export const config = CORTI.cortiConfigFromEnv();

export const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
export const writeJson = (p: string, v: unknown) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 1) + "\n");
};
export const sha = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 24);

/** A stable pseudo-random number in [0, 1) for a string, so a run is reproducible. */
export const unit = (s: string) => parseInt(crypto.createHash("md5").update(s).digest("hex").slice(0, 8), 16) / 0x100000000;

/**
 * Read-only SQL against the linked live project, through the CLI's Management
 * API path (no Docker needed). Returns the result rows.
 */
export function liveQuery(sql: string): any[] {
  const file = path.join(OUT, `query-${sha(sql)}.sql`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(file, sql);
  const out = execSync(`npx --no-install supabase db query --linked -f "${file}"`, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.indexOf("{"))).rows;
}

/**
 * Memoises one Corti-backed check on disk, keyed by what it was asked. A
 * result that carries an error is not kept, so a rerun retries it.
 */
export async function cached<T extends { error?: string | null }>(kind: string, key: unknown, run: () => Promise<T>): Promise<T> {
  const file = path.join(OUT, "cache", kind, `${sha(key)}.json`);
  if (fs.existsSync(file)) return readJson(file);
  let result = await run();
  for (let attempt = 1; result.error && attempt < 3; attempt++) {
    await new Promise((r) => setTimeout(r, 4000 * attempt));
    result = await run();
  }
  if (!result.error) writeJson(file, result);
  return result;
}

/** Bounded-concurrency map. Corti answers 429 or empty under ~9 parallel chains. */
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

export const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3);

export type Letter = "a" | "b" | "c" | "d" | "e";
export const LETTERS: Letter[] = ["a", "b", "c", "d", "e"];

/** One item as every check reads it — the production CheckableQuestion shape plus its track. */
export interface Item {
  id: string;
  index: number;
  examTrack: "step1" | "step2ck";
  subtopic: string;
  vignette: string;
  leadIn: string;
  options: Record<Letter, string>;
  correctOption: Letter;
  explanation: string;
  distractorExplanations: Partial<Record<Letter, string>>;
  teachingPoint: string;
  reviewerFlag: string;
}

/** A gold item: the snapshot and the reviewer's verdict on it. */
export interface GoldItem extends Item {
  verdict: "ok" | "minor" | "fatal";
  fault?: string;
  note: string;
}

/** A gold item with one known fault planted. Every mutant is a fatal item. */
export interface Mutant extends Item {
  parent: string;
  type: string;
  change: string;
}
