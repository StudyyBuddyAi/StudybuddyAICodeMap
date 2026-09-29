/**
 * Review pilot: does the clinical review catch the errors it exists for, and
 * leave correct branches alone?
 *
 * The regression set is fixtures/review-dka.json: the eight branches a
 * comprehensive DKA sheet grew in QA on 2026-09-28. Two carry known errors — a
 * potassium branch that treats hyperkalemia's ECG signs as a reason to give
 * more potassium, and a cerebral-edema branch with the sodium warning sign
 * inverted. The review must correct both, and change nothing in the other six.
 *
 * Runs the production review prompt (sheet-branch-prompts.ts) against Corti,
 * the way the handler does: REVIEW_MODEL, temperature 0.1, REVIEW_MAX_TOKENS,
 * non-streaming. Never OpenRouter. REVIEW_PILOT_MODEL tries another model.
 *
 * Measured 2026-09-28: corti-s1-instant caught 1 of 2 known errors and
 * "corrected" 1 of 6 right branches (wrongly); with a stricter prompt, 2 of 4
 * and 5 of 12. corti-s1 caught 4 of 4 — and in two branches the set had
 * called right, it found real errors (free-water loss blamed for
 * hyponatremia; acidosis moving potassium into cells). Those are now in the set.
 *
 *   node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/review-pilot.ts
 *
 * REVIEW_PILOT_RUNS=3 runs each branch that many times (the review should be
 * steady, not lucky). Writes out/review-pilot/<timestamp>.json.
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
const { cortiChatCompletion, cortiConfigFromEnv } = await mod("corti");

interface FixtureBranch {
  anchor: string;
  type: string;
  label: string;
  ask: string;
  versus?: string;
  markdown: string;
  knownError: string | null;
}
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/review-dka.json"), "utf8")) as {
  topic: string;
  examMode: string;
  difficulty: string;
  plan: string[];
  sections: Record<string, unknown>;
  branches: FixtureBranch[];
};
const RUNS = Number(process.env.REVIEW_PILOT_RUNS ?? 1);
const MODEL = process.env.REVIEW_PILOT_MODEL ?? branch.REVIEW_MODEL;
const MAX_TOKENS = Number(process.env.REVIEW_PILOT_MAX_TOKENS ?? 0) || undefined;
const ONLY = process.env.REVIEW_PILOT_ONLY?.split(",");

/** A kept branch's markdown, back in the JSON shape its writer returned — what the review is shown. */
function bodyOf(b: FixtureBranch): Record<string, unknown> {
  const lines = b.markdown.split("\n");
  switch (b.type) {
    case "management": {
      const at = lines.findIndex((l) => l.startsWith("#### Watch for"));
      const steps = (at < 0 ? lines : lines.slice(0, at)).filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s+/, ""));
      const watch = at < 0 ? [] : lines.slice(at + 1).filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
      return { steps, watch };
    }
    case "compare": {
      const rows = lines
        .filter((l) => l.startsWith("|"))
        .slice(2)
        .map((l) => l.replace(/^\|\s*/, "").replace(/\s*\|$/, "").split(/\s*\|\s*/));
      const takeaway = lines.find((l) => l.startsWith("> "))?.slice(2) ?? "";
      return { rows, takeaway };
    }
    default:
      return { paragraphs: b.markdown.split(/\n\n+/).filter(Boolean) };
  }
}

async function review(b: FixtureBranch) {
  const request = branch.parseBranchRequest({
    action: "grow",
    plan: fixture.plan,
    sections: fixture.sections,
    topic: fixture.topic,
    sourceIds: [],
    anchor: b.anchor,
    question: { type: b.type, label: b.label, ask: b.ask, ...(b.versus ? { versus: b.versus } : {}) },
  });
  if (!request) throw new Error(`fixture branch not a valid request: ${b.label}`);
  const prompts = branch.buildReviewPrompts({
    request,
    body: bodyOf(b),
    examMode: fixture.examMode,
    difficulty: fixture.difficulty,
    ragChunks: [],
  });
  const started = Date.now();
  const res = await cortiChatCompletion(cortiConfigFromEnv(), {
    model: MODEL,
    messages: [
      { role: "system", content: prompts.systemPrompt },
      { role: "user", content: prompts.userContent },
    ],
    stream: false,
    temperature: 0.1,
    maxTokens: MAX_TOKENS ?? branch.REVIEW_MAX_TOKENS,
  });
  const ms = Date.now() - started;
  if (!res.ok) return { ms, verdict: `http_${res.status}`, fixes: [] as string[], raw: await res.text() };
  const data = await res.json();
  const raw: string = data?.choices?.[0]?.message?.content ?? "";
  const parsed = branch.parseReview(raw, b.type);
  return { ms, verdict: parsed?.verdict ?? "unreadable", fixes: parsed?.verdict === "corrected" ? parsed.fixes : [], raw };
}

const results: unknown[] = [];
let caught = 0;
let errors = 0;
let falseAlarms = 0;
let clean = 0;
const jobs = fixture.branches
  .filter((x) => !ONLY || ONLY.some((o) => x.label.startsWith(o)))
  .flatMap((b) => Array.from({ length: RUNS }, (_, run) => ({ b, run })));
// A few at a time, as the page runs them: the reasoning reviewer takes most of a minute each.
const CONCURRENCY = Number(process.env.REVIEW_PILOT_CONCURRENCY ?? 4);
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const { b, run } = jobs[next++];
      const r = await review(b);
      results.push({ label: b.label, knownError: b.knownError, run, ...r });
      const flagged = r.verdict === "corrected";
      if (b.knownError) {
        errors++;
        if (flagged) caught++;
      } else {
        clean++;
        if (flagged) falseAlarms++;
      }
      const mark = b.knownError ? (flagged ? "CAUGHT " : "MISSED ") : flagged ? "CHANGED" : r.verdict === "ok" ? "ok     " : r.verdict;
      console.log(`${mark} ${String(r.ms).padStart(6)}ms  ${b.label}${r.fixes.length ? `\n          fixes: ${r.fixes.join(" | ")}` : ""}`);
    }
  })
);
console.log(`\nknown errors caught: ${caught}/${errors} · correct branches changed: ${falseAlarms}/${clean}`);
const out = path.join(HERE, "out/review-pilot");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(results, null, 2));
