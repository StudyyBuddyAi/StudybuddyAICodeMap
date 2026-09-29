/**
 * Scores a depth-pilot run (depth-pilot.ts): the contract each output was
 * given, how much of it repeats itself, how big it is, and what it cost.
 *
 *   DEPTH_PILOT_BASELINE=<dir> node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/depth-score.ts [run]
 *
 * Writes score.json and sheets.md (every output, readable) into the run folder.
 *
 * Repeats are the word-overlap proxy in redundancy.ts. It cannot tell a line
 * that restates an earlier one from a line that explains it, and depth is
 * meant to do the second — so read sheets.md before trusting a difference.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseSheetOutput } from "../../src/lib/parse-partial-sheet.ts";
import { bodyToLines, sheetRedundancy, type SectionLines } from "./redundancy.ts";
import { terms } from "../../src/lib/section-recall.ts";
import { PRICES } from "./cases.ts";
import { resolveSheetPlan, resolvePlanFromKeys, type PlannedSection } from "../../supabase/functions/_shared/sheet-plan.ts";
import { moreKey } from "../../supabase/functions/_shared/sheet-sections.ts";
import { depthSections } from "../../supabase/functions/_shared/sheet-section-prompts.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = process.argv[2] ?? "depth-pilot";
const DIR = path.join(HERE, "out", RUN);
const BASELINE = process.env.DEPTH_PILOT_BASELINE;
if (!BASELINE) throw new Error("DEPTH_PILOT_BASELINE must name the folder holding the baseline _shared modules");
const basePlan = await import(pathToFileURL(path.join(BASELINE, "_shared", "sheet-plan.ts")).href);

type Usage = { prompt_tokens?: number; completion_tokens?: number; cost?: number } | null;
const PRICE: Record<string, { in: number; out: number }> = {
  corti: PRICES["corti-s1-instant"],
  gpt: PRICES["openai/gpt-oss-20b"],
};
/** OpenRouter reports what it charged; Corti is priced from its token counts. */
const cost = (writer: string, u: Usage) =>
  !u ? null : typeof u.cost === "number" ? u.cost : ((u.prompt_tokens ?? 0) * PRICE[writer].in + (u.completion_tokens ?? 0) * PRICE[writer].out) / 1e6;

const words = (s: string) => s.replace(/\*\*/g, "").split(/\s+/).filter(Boolean).length;
const bodyWords = (b: unknown) => bodyToLines(b).reduce((n, l) => n + words(l), 0);
const itemCount = (b: unknown) => (Array.isArray(b) ? b.length : typeof b === "string" ? b.split("\n").filter((l) => l.trim()).length : 0);
const inRange = (n: number, [lo, hi]: [number, number]) => n >= lo && n <= hi;
const LABEL_RE = /^\s*([A-Z][A-Za-z ,/&-]{0,30}?)\s*:/;
const lineLabels = (s: string) =>
  s.split("\n").map((l) => LABEL_RE.exec(l)?.[1]?.trim()).filter((x): x is string => !!x);

interface Rec {
  kind: "sheet" | "expandall" | "expand" | "regen";
  writer: string;
  arm?: string;
  key?: string | null;
  instruction?: string | null;
  case: { id: string; notes: string; examMode: string; difficulty: string; archetype: string };
  plan: string[];
  before?: Record<string, unknown>;
  ok: boolean;
  error: string | null;
  text: string;
  ttfcMs: number | null;
  totalMs: number;
  marks: [number, number][];
  finishReason: string | null;
  usage: Usage;
  reasoningChars?: number;
}

const recs: Rec[] = fs
  .readdirSync(DIR)
  .filter((f) => /^(sheet|expandall|expand|regen)__.*\.json$/.test(f))
  .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")));

const issues: Record<string, string[]> = {};
const flag = (id: string, what: string) => (issues[id] ??= []).push(what);

for (const r of recs.filter((x) => !x.ok)) flag(`${r.kind}/${r.arm ?? r.writer}/${r.case.id}${r.key ? `/${r.key}` : ""}`, `call failed: ${r.error}`);

// ── Sheets ──────────────────────────────────────────────────────────────────

interface SheetRow {
  arm: string;
  caseId: string;
  words: number;
  coreWords: number;
  moreWords: number;
  repeatShare: number;
  moreRepeatShare: number | null;
  gateOk: number;
  gateTotal: number;
  totalMs: number;
  ttfcMs: number | null;
  coresDoneMs: number | null;
  outTokens: number | null;
  costUsd: number | null;
  truncated: boolean;
}
const sheetRows: SheetRow[] = [];

function checkProseCore(id: string, p: PlannedSection, core: string, gate: { ok: number; total: number }) {
  const got = lineLabels(core);
  const lacking = (p.coreLabels ?? []).filter((l) => !got.includes(l));
  gate.total++;
  if (!lacking.length) gate.ok++;
  else flag(id, `${p.key} core lacks ${lacking.join("/")}`);
  const leaked = (p.moreLabels ?? []).filter((l) => got.includes(l));
  if (leaked.length) flag(id, `${p.key} core has depth labels ${leaked.join("/")}`);
}

for (const r of recs.filter((x) => x.kind === "sheet" && x.ok)) {
  const id = `${r.arm}/${r.case.id}`;
  const parsed = parseSheetOutput(r.text);
  if (!parsed) {
    flag(id, `does not parse (finish ${r.finishReason})`);
    continue;
  }
  if (parsed.status !== "ok") flag(id, `parsed only after repair (${parsed.status})`);
  const s = parsed.sheet.sections ?? {};
  const isNew = r.arm!.endsWith("-hy");
  const plan: PlannedSection[] = isNew
    ? resolveSheetPlan({ archetype: r.case.archetype as never, examMode: r.case.examMode, difficulty: r.case.difficulty })
    : basePlan.resolveSheetPlan({
        archetype: r.case.archetype,
        examMode: r.case.examMode,
        difficulty: r.case.difficulty,
        length: r.arm!.endsWith("base-concise") ? "Concise" : "Detailed",
      });

  const expected = plan.map((p) => p.key);
  const written = Object.keys(s);
  const missing = expected.filter((k) => !written.includes(k));
  const extra = written.filter((k) => !expected.includes(k));
  if (missing.length) flag(id, `missing: ${missing.join(", ")}`);
  if (extra.length) flag(id, `unplanned: ${extra.join(", ")}`);

  const gate = { ok: 0, total: 0 };
  for (const p of plan) {
    if (p.items) {
      gate.total++;
      const n = itemCount(s[p.key]);
      if (inRange(n, p.items)) gate.ok++;
      else flag(id, `${p.key}: ${n} (want ${p.items.join("-")})`);
    }
    if (p.kind === "prose" && isNew) checkProseCore(id, p, typeof s[p.key] === "string" ? (s[p.key] as string) : "", gate);
  }

  const red = sheetRedundancy(plan.map((p) => ({ key: p.key, lines: bodyToLines(s[p.key]) })));
  const cov = parsed.sheet.sourceCoverage;
  if (cov) {
    const n = cov.uncovered.length;
    const consistent = cov.level === "full" ? n === 0 : cov.level === "none" ? n >= plan.length : n > 0 && n < plan.length;
    if (!consistent) flag(id, `sourceCoverage ${cov.level} with ${n} uncovered`);
  } else flag(id, "no sourceCoverage");

  const coreWords = plan.reduce((n, p) => n + bodyWords(s[p.key]), 0);
  sheetRows.push({
    arm: r.arm!,
    caseId: r.case.id,
    words: coreWords,
    coreWords,
    moreWords: 0,
    repeatShare: red.share,
    moreRepeatShare: null,
    gateOk: gate.ok,
    gateTotal: gate.total,
    totalMs: r.totalMs,
    ttfcMs: r.ttfcMs,
    coresDoneMs: null,
    outTokens: r.usage?.completion_tokens ?? null,
    costUsd: cost(r.writer, r.usage),
    truncated: r.finishReason === "length",
  });
}

// ── Comprehensive: the high-yield sheet, then every content section's depth ─

for (const r of recs.filter((x) => x.kind === "expandall" && x.ok)) {
  const id = `${r.writer}-comp2/${r.case.id}`;
  const hy = recs.find((x) => x.kind === "sheet" && x.arm === `${r.writer}-hy` && x.case.id === r.case.id);
  const hyParsed = hy ? parseSheetOutput(hy.text) : null;
  const depth = parseSheetOutput(r.text);
  if (!hy || !hyParsed || !depth) {
    flag(id, "does not parse");
    continue;
  }
  if (depth.status !== "ok") flag(id, `depth parsed only after repair (${depth.status})`);
  const plan = resolvePlanFromKeys(r.plan, r.case.examMode);
  const deepened = depthSections(plan);
  const cores = hyParsed.sheet.sections ?? {};
  const mores = depth.sheet.sections ?? {};
  const s = { ...cores, ...mores };

  const expected = deepened.map((p) => moreKey(p.key));
  const written = Object.keys(mores);
  const missing = expected.filter((k) => !written.includes(k));
  const extra = written.filter((k) => !expected.includes(k));
  if (missing.length) flag(id, `missing: ${missing.join(", ")}`);
  if (extra.length) flag(id, `unplanned: ${extra.join(", ")}`);

  let gateOk = 0;
  let gateTotal = 0;
  for (const p of deepened) {
    const body = s[moreKey(p.key)];
    if (p.moreItems) {
      // Deepening the whole sheet, a section may add nothing.
      gateTotal++;
      const n = itemCount(body);
      if (inRange(n, [0, p.moreItems[1]])) gateOk++;
      else flag(id, `${moreKey(p.key)}: ${n} (want 0-${p.moreItems[1]})`);
    }
    if (p.kind === "prose") {
      const allowed = new Set([...(p.coreLabels ?? []), ...(p.moreLabels ?? [])]);
      const lines = (typeof body === "string" ? body : "").split("\n").filter((l) => l.trim());
      const stray = lines.filter((l) => !allowed.has(LABEL_RE.exec(l)?.[1]?.trim() ?? ""));
      gateTotal++;
      if (!stray.length) gateOk++;
      else flag(id, `${moreKey(p.key)}: ${stray.length}/${lines.length} lines without a section label`);
    }
  }
  const empties = deepened.filter((p) => itemCount(s[moreKey(p.key)]) === 0).map((p) => p.key);
  if (empties.length) flag(id, `nothing added to: ${empties.join(", ")} (allowed)`);

  const ordered: SectionLines[] = [
    ...plan.map((p) => ({ key: p.key, lines: bodyToLines(s[p.key]) })),
    ...deepened.map((p) => ({ key: moreKey(p.key), lines: bodyToLines(s[moreKey(p.key)]) })),
  ];
  const red = sheetRedundancy(ordered);
  const coresOnly = sheetRedundancy(ordered.slice(0, plan.length));
  const moreLines = red.lines - coresOnly.lines;
  const coreWords = plan.reduce((n, p) => n + bodyWords(s[p.key]), 0);
  const moreWords = deepened.reduce((n, p) => n + bodyWords(s[moreKey(p.key)]), 0);
  sheetRows.push({
    arm: `${r.writer}-comp2`,
    caseId: r.case.id,
    words: coreWords + moreWords,
    coreWords,
    moreWords,
    repeatShare: red.share,
    moreRepeatShare: moreLines ? (red.repeated - coresOnly.repeated) / moreLines : 0,
    gateOk,
    gateTotal,
    // The depth call starts when the high-yield sheet has finished.
    totalMs: hy.totalMs + r.totalMs,
    ttfcMs: hy.ttfcMs,
    coresDoneMs: hy.totalMs,
    outTokens: (hy.usage?.completion_tokens ?? 0) + (r.usage?.completion_tokens ?? 0),
    costUsd: (cost(r.writer, hy.usage) ?? 0) + (cost(r.writer, r.usage) ?? 0),
    truncated: r.finishReason === "length",
  });
}

// ── One section: deepen, rewrite ────────────────────────────────────────────

interface FollowRow {
  kind: string;
  writer: string;
  caseId: string;
  key: string;
  ok: boolean;
  keysOk: boolean;
  countOk: boolean;
  covered: unknown;
  newLines: number;
  repeatedLines: number;
  words: number;
  totalMs: number;
  costUsd: number | null;
}
const followRows: FollowRow[] = [];

/** Lines of `added` that repeat any line of `sheet` (same test as redundancy.ts). */
function repeatsOf(added: string[], sheet: string[]): number {
  const sets = sheet.map((l) => new Set(terms(l))).filter((t) => t.size >= 3);
  let hits = 0;
  for (const line of added) {
    const t = new Set(terms(line));
    if (t.size < 3) continue;
    const hit = sets.some((prior) => {
      let shared = 0;
      for (const x of t) if (prior.has(x)) shared++;
      return shared >= 3 && shared / t.size >= 0.5;
    });
    if (hit) hits++;
  }
  return hits;
}

for (const r of recs.filter((x) => (x.kind === "expand" || x.kind === "regen") && x.ok)) {
  const id = `${r.kind}/${r.writer}/${r.case.id}/${r.key}`;
  const plan = resolvePlanFromKeys(r.plan, r.case.examMode);
  const p = plan.find((x) => x.key === r.key)!;
  let raw: Record<string, unknown> | null = null;
  const text = r.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  const repaired = raw ? null : parseSheetOutput(r.text);
  if (!raw && !repaired) {
    flag(id, "does not parse");
    followRows.push({ kind: r.kind, writer: r.writer, caseId: r.case.id, key: r.key!, ok: false, keysOk: false, countOk: false, covered: null, newLines: 0, repeatedLines: 0, words: 0, totalMs: r.totalMs, costUsd: cost(r.writer, r.usage) });
    continue;
  }
  if (!raw) flag(id, "parsed only after repair");
  const want = r.kind === "expand" ? [moreKey(p.key), "covered"] : [p.key, "covered"];
  const got = raw ? Object.keys(raw) : Object.keys(repaired!.sheet.sections ?? {});
  const keysOk = raw ? want.every((k) => got.includes(k)) && got.every((k) => want.includes(k)) : got.includes(want[0]);
  if (!keysOk) flag(id, `keys ${got.join(", ")}`);
  const body = raw ? raw[want[0]] : repaired!.sheet.sections?.[want[0]];
  const range = r.kind === "expand" ? p.moreItems : p.items;
  const countOk = range ? inRange(itemCount(body), range) : true;
  if (!countOk) flag(id, `${want[0]}: ${itemCount(body)} (want ${range!.join("-")})`);
  if (p.kind === "prose" && typeof body === "string") {
    const allowed = new Set([...(p.coreLabels ?? []), ...(r.kind === "expand" ? p.moreLabels ?? [] : [])]);
    const lines = body.split("\n").filter((l) => l.trim());
    const stray = lines.filter((l) => !allowed.has(LABEL_RE.exec(l)?.[1]?.trim() ?? ""));
    if (stray.length) flag(id, `${stray.length}/${lines.length} lines without an allowed label`);
  }
  const added = bodyToLines(body);
  const before = r.before ?? {};
  // A depth must not repeat anything on the sheet; a rewrite must not repeat
  // the other sections.
  const sheetLines = Object.entries(before)
    .filter(([k]) => (r.kind === "expand" ? true : k !== p.key && k !== moreKey(p.key)))
    .flatMap(([, v]) => bodyToLines(v));
  followRows.push({
    kind: r.kind,
    writer: r.writer,
    caseId: r.case.id,
    key: r.key!,
    ok: true,
    keysOk,
    countOk,
    covered: raw?.covered ?? null,
    newLines: added.length,
    repeatedLines: repeatsOf(added, sheetLines),
    words: bodyWords(body),
    totalMs: r.totalMs,
    costUsd: cost(r.writer, r.usage),
  });
}

// ── Report ──────────────────────────────────────────────────────────────────

const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const f0 = (x: number | null) => (x === null ? "-" : Math.round(x).toString());
const f1 = (x: number | null) => (x === null ? "-" : (x / 1000).toFixed(1));
const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);
const usd = (x: number | null) => (x === null ? "-" : x < 0.01 ? `$${x.toFixed(5)}` : `$${x.toFixed(3)}`);

console.log("\nSHEETS (mean over cases)");
console.log("| arm | sheets | contract | words | depth words | repeats | repeats (depth only) | ttfc s | HY done s | total s | out tok | $/sheet | truncated |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
const writerIds = [...new Set(recs.map((r) => r.writer))];
for (const w of writerIds) {
  for (const arm of ["base-concise", "hy", "base-detailed", "comp2"].map((a) => `${w}-${a}`)) {
    const rows = sheetRows.filter((r) => r.arm === arm);
    if (!rows.length) continue;
    const gate = rows.reduce((n, r) => n + r.gateOk, 0) / Math.max(1, rows.reduce((n, r) => n + r.gateTotal, 0));
    console.log(
      `| ${arm} | ${rows.length} | ${pct(gate)} | ${f0(mean(rows.map((r) => r.words)))} | ${f0(mean(rows.map((r) => r.moreWords)))} | ${pct(mean(rows.map((r) => r.repeatShare)))} | ${pct(mean(rows.map((r) => r.moreRepeatShare)))} | ${f1(mean(rows.map((r) => r.ttfcMs)))} | ${f1(mean(rows.map((r) => r.coresDoneMs ?? (arm.endsWith("-hy") ? r.totalMs : null))))} | ${f1(mean(rows.map((r) => r.totalMs)))} | ${f0(mean(rows.map((r) => r.outTokens)))} | ${usd(mean(rows.map((r) => r.costUsd)))} | ${rows.filter((r) => r.truncated).length} |`
    );
  }
}

console.log("\nPER SHEET");
console.log("| case | arm | words | repeats | contract | total s |");
console.log("|---|---|---|---|---|---|");
for (const r of [...sheetRows].sort((a, b) => a.caseId.localeCompare(b.caseId) || a.arm.localeCompare(b.arm))) {
  console.log(`| ${r.caseId} | ${r.arm} | ${r.words} | ${pct(r.repeatShare)} | ${r.gateOk}/${r.gateTotal} | ${f1(r.totalMs)} |`);
}

console.log("\nONE SECTION");
console.log("| kind | writer | case | section | keys ok | count ok | covered | new lines | repeat an existing line | words | s | $ |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of followRows) {
  console.log(
    `| ${r.kind} | ${r.writer} | ${r.caseId} | ${r.key} | ${r.keysOk ? "yes" : "NO"} | ${r.countOk ? "yes" : "NO"} | ${String(r.covered)} | ${r.newLines} | ${r.repeatedLines} | ${r.words} | ${f1(r.totalMs)} | ${usd(r.costUsd)} |`
  );
}

console.log("\nISSUES");
for (const [id, list] of Object.entries(issues).sort()) console.log(`- ${id}: ${list.join("; ")}`);

for (const w of writerIds) {
  const total = recs.filter((r) => r.writer === w).reduce((n, r) => n + (cost(r.writer, r.usage) ?? 0), 0);
  console.log(`\n${w} spend for this run: ${usd(total)}`);
}

fs.writeFileSync(path.join(DIR, "score.json"), JSON.stringify({ sheetRows, followRows, issues }, null, 2));

// Every output, readable, for reviewing what the sheets actually say.
const md: string[] = [];
const order = (r: Rec) => `${r.case.id}|${r.writer}|${["sheet", "expandall", "expand", "regen"].indexOf(r.kind)}|${r.arm ?? ""}|${r.key ?? ""}`;
for (const r of [...recs].sort((a, b) => order(a).localeCompare(order(b)))) {
  md.push(`\n\n# ${r.case.id} · ${r.writer} · ${r.kind}${r.arm ? ` · ${r.arm}` : ""}${r.key ? ` · ${r.key}` : ""}${r.instruction ? ` · "${r.instruction}"` : ""}`);
  md.push(`${r.case.notes} · ${r.case.examMode} · ${r.case.difficulty}`);
  const parsed = r.ok ? parseSheetOutput(r.text) : null;
  if (!parsed) {
    md.push("```\n" + (r.text || r.error) + "\n```");
    continue;
  }
  for (const [k, v] of Object.entries(parsed.sheet.sections ?? {})) {
    md.push(`\n## ${k}`);
    md.push(bodyToLines(v).map((l) => (typeof v === "string" ? l : `- ${l}`)).join("\n"));
  }
}
fs.writeFileSync(path.join(DIR, "sheets.md"), md.join("\n"));
console.log(`→ ${path.join(DIR, "score.json")}, sheets.md`);
