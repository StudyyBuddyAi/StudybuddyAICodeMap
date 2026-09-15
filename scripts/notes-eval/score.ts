/**
 * medical-notes provider comparison — contract scoring.
 *
 * Runs every stored output through the parsers the app itself uses
 * (parseSheetOutput, parseFlashcardsFromOutput) and checks each mode against
 * the rules its prompt states: the length gate, the overview structure, the
 * card tags, the explain headers and word cap, the enhance sentence and word
 * caps. These are the things a user sees break — an unparseable sheet, 9 cards
 * when 10 were asked for, a raw "<Choose based on…>" placeholder leaking into
 * the reference note.
 *
 * Contract compliance is necessary, not sufficient: medical accuracy and
 * teaching quality are judged separately on blinded side-by-sides (judge.ts).
 *
 *   node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/score.ts <run> [<run>...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSheetOutput } from "../../src/lib/parse-partial-sheet.ts";
import { parseFlashcardsFromOutput } from "../../src/lib/parse-flashcards.ts";
import { PRICES } from "./cases.ts";
import type { RunRecord } from "./run.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export interface Check { name: string; pass: boolean; detail?: string }
export interface Scored {
  armId: string;
  tier: string;
  model: string;
  prompts: string;
  caseId: string;
  kind: string;
  ok: boolean;
  error: string | null;
  checks: Check[];
  passRate: number;
  ttfcMs: number | null;
  totalMs: number | null;
  outTokens: number | null;
  inTokens: number | null;
  costUsd: number | null;
  finishReason: string | null;
  retrievedChunks: number | null;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
/** Sentence count, ignoring common abbreviations and decimals. */
const sentences = (s: string) =>
  (s.replace(/\b(e\.g|i\.e|vs|approx|etc|Dr|mg|mEq)\./gi, "$1").replace(/(\d)\.(\d)/g, "$1$2").match(/[.!?](?=\s|$)/g) ?? []).length;
const bolds = (s: string) => (s.match(/\*\*[^*]+\*\*/g) ?? []).length;
const inRange = (n: number, lo: number, hi: number) => n >= lo && n <= hi;

const LENGTH_GATE: Record<string, { hooks: [number, number]; keyPoints: [number, number]; traps: [number, number]; cards: [number, number] }> = {
  Concise: { hooks: [3, 3], keyPoints: [5, 5], traps: [3, 3], cards: [3, 3] },
  Moderate: { hooks: [3, 4], keyPoints: [6, 8], traps: [4, 4], cards: [4, 4] },
  Detailed: { hooks: [5, 5], keyPoints: [8, 10], traps: [5, 6], cards: [5, 5] },
};

const CLINICAL_TAGS = new Set(["diagnosis", "mechanism", "next step", "complication", "association"]);

function scoreSheet(r: RunRecord): Check[] {
  const checks: Check[] = [];
  const raw = r.text.trim();
  checks.push({ name: "starts with {", pass: raw.startsWith("{"), detail: raw.slice(0, 20) });
  const parsed = parseSheetOutput(raw);
  checks.push({ name: "parses (as sent)", pass: parsed?.status === "ok", detail: parsed?.status ?? "unparseable" });
  checks.push({ name: "parses (after app repair)", pass: parsed?.status === "ok" || parsed?.status === "repaired", detail: parsed?.status ?? "unparseable" });
  if (!parsed) return checks;
  const s = parsed.sheet;

  for (const f of ["overview", "clinicalApproach", "referenceNote", "topic", "topicEmoji"] as const) {
    checks.push({ name: `${f} filled`, pass: typeof s[f] === "string" && s[f]!.trim().length > 0 });
  }

  const gate = LENGTH_GATE[String(r.case.body.length)] ?? LENGTH_GATE.Concise;
  checks.push({ name: "gate: memoryHooks", pass: inRange(s.memoryHooks.length, ...gate.hooks), detail: String(s.memoryHooks.length) });
  checks.push({ name: "gate: keyPoints", pass: inRange(s.keyPoints.length, ...gate.keyPoints), detail: String(s.keyPoints.length) });
  checks.push({ name: "gate: examTraps", pass: inRange(s.examTraps.length, ...gate.traps), detail: String(s.examTraps.length) });
  checks.push({ name: "gate: flashcards", pass: inRange(s.flashcards.length, ...gate.cards), detail: String(s.flashcards.length) });

  const ov = s.overview;
  checks.push({
    name: "overview structure",
    pass: /(^|\n)\s*Mechanism:/.test(ov) && /\n\s*Pathophysiology:/.test(ov) && /\n\s*Key associations:/.test(ov),
  });
  checks.push({ name: "overview uses bold", pass: bolds(ov) > 0 });
  checks.push({ name: "clinicalApproach structure", pass: /Diagnosis:/.test(s.clinicalApproach) && /Management:/.test(s.clinicalApproach) });
  checks.push({
    name: "no template placeholder leak",
    pass: !/<Choose|<one emoji|<mnemonic|<If X|<trap one-liner|<full vignette|If "full":/.test(raw),
  });
  checks.push({ name: "sourceCoverage valid", pass: !!s.sourceCoverage, detail: s.sourceCoverage?.level });
  if (r.retrievedChunks === 0 && s.sourceCoverage) {
    checks.push({ name: "coverage honest when ungrounded", pass: s.sourceCoverage.level === "none", detail: s.sourceCoverage.level });
  }
  checks.push({ name: "not truncated", pass: r.eval?.finishReason !== "length", detail: r.eval?.finishReason ?? "" });
  return checks;
}

function scoreCards(r: RunRecord): Check[] {
  const checks: Check[] = [];
  const raw = r.text;
  const want = Number(r.case.body.cardCount);
  const cards = parseFlashcardsFromOutput(raw, String(r.case.body.notes));
  checks.push({ name: "FLASHCARDS header", pass: /^\s*FLASHCARDS/i.test(raw) });
  checks.push({ name: "exact card count", pass: cards.length === want, detail: `${cards.length}/${want}` });
  checks.push({ name: "topic emoji", pass: cards.some((c) => !!c.topicEmoji) });
  const qLines = raw.split("\n").filter((l) => /^\s*Q\s*:/.test(l));
  const twoTags = qLines.filter((l) => {
    const tags = [...(l.match(/^\s*Q\s*:\s*((?:\[[^\]]+\]\s*)+)/)?.[1] ?? "").matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim().toLowerCase());
    return tags.length === 2 && tags.some((t) => CLINICAL_TAGS.has(t)) && tags.some((t) => t === "grounded" || t === "general");
  });
  checks.push({ name: "every Q has clinical+sourcing tag", pass: qLines.length > 0 && twoTags.length === qLines.length, detail: `${twoTags.length}/${qLines.length}` });
  checks.push({ name: "questions end with ?", pass: cards.length > 0 && cards.every((c) => c.question.trim().endsWith("?")), detail: `${cards.filter((c) => c.question.trim().endsWith("?")).length}/${cards.length}` });
  checks.push({ name: "answers ≤ 2 sentences", pass: cards.length > 0 && cards.every((c) => sentences(c.answer) <= 2), detail: `${cards.filter((c) => sentences(c.answer) <= 2).length}/${cards.length}` });
  if (r.retrievedChunks === 0) {
    checks.push({ name: "all [General] when ungrounded", pass: cards.every((c) => !c.grounded) });
  }
  checks.push({ name: "no preamble/numbering", pass: !/^\s*\d+[.)]\s/m.test(raw) });
  return checks;
}

function scoreExplain(r: RunRecord): Check[] {
  const t = r.text;
  return [
    { name: "3 section headers", pass: /EXPLANATION/.test(t) && /WHY THIS ANSWER/.test(t) && /EXAM TIP/.test(t) },
    { name: "starts with EXPLANATION", pass: t.trim().startsWith("EXPLANATION") },
    { name: "≤ 180 words", pass: words(t) <= 180, detail: String(words(t)) },
    { name: "no markdown", pass: !/(^|\n)\s*(#|[-*] )|\*\*/.test(t) },
  ];
}

function scoreEnhance(r: RunRecord, kind: "expand" | "clinical"): Check[] {
  const t = r.text.trim();
  const n = sentences(t);
  const w = words(t);
  return kind === "expand"
    ? [
        { name: "2–3 sentences", pass: inRange(n, 2, 3), detail: String(n) },
        { name: "≤ 60 words", pass: w <= 60, detail: String(w) },
        { name: "uses bold", pass: bolds(t) > 0 },
        { name: "plain prose", pass: !/(^|\n)\s*(#|[-*] |\d+\.)/.test(t) },
      ]
    : [
        { name: "exactly 2 sentences", pass: n === 2, detail: String(n) },
        { name: "≤ 50 words", pass: w <= 50, detail: String(w) },
        { name: "uses bold", pass: bolds(t) > 0 },
        { name: "plain prose", pass: !/(^|\n)\s*(#|[-*] |\d+\.)/.test(t) },
      ];
}

export function scoreRecord(r: RunRecord): Scored {
  const kind = r.case.kind;
  const checks = !r.ok
    ? [{ name: "request succeeded", pass: false, detail: r.error ?? "" }]
    : kind === "sheet" ? scoreSheet(r)
    : kind === "cards" ? scoreCards(r)
    : kind === "explain" ? scoreExplain(r)
    : scoreEnhance(r, kind);

  const usage = r.eval?.usage ?? null;
  const price = PRICES[r.arm.model];
  const inTokens = usage?.prompt_tokens ?? null;
  const outTokens = usage?.completion_tokens ?? null;
  const costUsd = typeof usage?.cost === "number"
    ? usage.cost
    : price && inTokens != null && outTokens != null && price.in > 0
    ? (inTokens * price.in + outTokens * price.out) / 1e6
    : null;

  return {
    armId: r.arm.id,
    tier: r.arm.tier,
    model: r.arm.model,
    prompts: r.arm.prompts,
    caseId: r.case.id,
    kind,
    ok: r.ok,
    error: r.error,
    checks,
    passRate: checks.filter((c) => c.pass).length / checks.length,
    ttfcMs: r.eval?.ttfcMs ?? null,
    totalMs: r.eval?.totalMs ?? null,
    outTokens,
    inTokens,
    costUsd,
    finishReason: r.eval?.finishReason ?? null,
    retrievedChunks: r.retrievedChunks,
  };
}

export function loadRun(run: string): RunRecord[] {
  const dir = path.join(HERE, "out", run);
  return fs.readdirSync(dir)
    .filter((f) => f.includes("__") && f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as RunRecord);
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const runs = process.argv.slice(2);
  if (!runs.length) throw new Error("usage: score.ts <run> [<run>...]");
  const scored = runs.flatMap(loadRun).map(scoreRecord);
  const outFile = path.join(HERE, "out", runs[runs.length - 1], "score.json");
  fs.writeFileSync(outFile, JSON.stringify(scored, null, 2));

  const arms = [...new Set(scored.map((s) => s.armId))].sort();
  const kinds = ["sheet", "cards", "explain", "expand", "clinical"];
  console.log(`| arm | ok | ${kinds.join(" | ")} | all checks | median TTFC | median total (sheet) | out tok (sheet) | $/100 sheets |`);
  console.log(`|---|---|${kinds.map(() => "---").join("|")}|---|---|---|---|---|`);
  for (const arm of arms) {
    const rows = scored.filter((s) => s.armId === arm);
    const pct = (xs: Scored[]) => {
      const cs = xs.flatMap((x) => x.checks);
      return cs.length ? `${Math.round((100 * cs.filter((c) => c.pass).length) / cs.length)}%` : "-";
    };
    const sheets = rows.filter((r) => r.kind === "sheet" && r.ok);
    const sheetCost = sheets.map((s) => s.costUsd).filter((c): c is number => c != null);
    console.log(
      `| ${arm} | ${rows.filter((r) => r.ok).length}/${rows.length} | ${kinds.map((k) => pct(rows.filter((r) => r.kind === k))).join(" | ")} | ${pct(rows)} | ` +
        `${median(rows.map((r) => r.ttfcMs).filter((x): x is number => x != null))}ms | ${median(sheets.map((r) => r.totalMs!))}ms | ` +
        `${median(sheets.map((r) => r.outTokens).filter((x): x is number => x != null))} | ` +
        `${sheetCost.length ? "$" + ((100 * sheetCost.reduce((a, b) => a + b, 0)) / sheetCost.length).toFixed(2) : "-"} |`
    );
  }

  console.log("\nFailed checks by arm:");
  for (const arm of arms) {
    const fails = new Map<string, string[]>();
    for (const s of scored.filter((x) => x.armId === arm)) {
      for (const c of s.checks.filter((c) => !c.pass)) {
        const k = `${s.kind}: ${c.name}`;
        fails.set(k, [...(fails.get(k) ?? []), `${s.caseId}${c.detail ? `(${c.detail})` : ""}`]);
      }
    }
    console.log(`\n${arm}`);
    for (const [k, v] of [...fails].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${v.length}× ${k} — ${v.join(", ")}`);
  }
  console.log(`\n→ ${outFile}`);
}
