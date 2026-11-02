// Runs every check over the gold set and the planted faults, and scores each
// pipeline: how many faulty items it holds back, how many sound ones it
// wastes. Corti calls are cached under out/cache, so a rerun after a change to
// a deterministic rule costs nothing, and an interrupted run resumes.
//   node scripts/qbank-accuracy/run.mts            → out/report.json, out/report.md
//   SKIP_VARIANTS=1 node scripts/qbank-accuracy/run.mts   (production checks only)
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { HERE, OUT, ROOT, QA, VERIFY, config, cached, pool, readJson, writeJson, CONCURRENCY, type GoldItem, type Mutant, type Item } from "./common.mts";
import { checkKeyConsistency } from "./candidates.mts";

const gold: GoldItem[] = readJson(path.join(HERE, "gold.json"));
const mutants: Mutant[] = fs.existsSync(path.join(HERE, "mutants.json")) ? readJson(path.join(HERE, "mutants.json")) : [];
const VARIANTS = !process.env.SKIP_VARIANTS;

// The gate as it was before the accuracy work, for the "before" pipeline.
const BEFORE_REF = process.env.BEFORE_REF ?? "d09d1c4";
const beforePath = path.join(OUT, `qbank-qa-${BEFORE_REF}.ts`);
if (!fs.existsSync(beforePath)) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(beforePath, execSync(`git show ${BEFORE_REF}:supabase/functions/_shared/qbank-qa.ts`, { cwd: ROOT, encoding: "utf8" }));
}
const QA_BEFORE = await import(pathToFileURL(beforePath).href);

const MINI = "corti-s1-mini-instant";
type Probe = { agreed: boolean; answer: string | null; solvable: boolean; issue: string; error: string | null };
type Consistency = { argued: string | null; consistent: boolean; error: string | null };
type Ambiguity = { defect: string; option: string | null; note: string; error: string | null };

const probeKey = (it: Item, variant: string) => ({ variant, v: it.vignette, l: it.leadIn, o: it.options, k: it.correctOption, t: it.examTrack });
const probe = (it: Item, variant: string, opts: Record<string, unknown> = {}): Promise<Probe> =>
  cached("probe", probeKey(it, variant), () => VERIFY.verifyOne(config, it, it.examTrack, opts));
const consistency = (it: Item, variant: string, model?: string): Promise<Consistency> =>
  cached("consistency", { variant, o: it.options, e: it.explanation, tp: it.teachingPoint, k: it.correctOption }, () => checkKeyConsistency(it, model));
const ambiguity = (it: Item, variant: string, model?: string): Promise<Ambiguity> =>
  cached("ambiguity", { variant, ...probeKey(it, variant) }, () => VERIFY.checkAmbiguity(config, it, model ? { model } : {}));

interface Row {
  id: string;
  kind: "gold" | "mutant";
  verdict: "ok" | "minor" | "fatal";
  type: string;
  gateBefore: string[];
  gate: string[];
  probe: Probe;
  flag: { verdict: string; confirmed: boolean } | null;
  mini?: Probe;
  sc?: Probe[];
  consMini?: Consistency;
  consS1?: Consistency;
  ambS1?: Ambiguity;
  ambMini?: Ambiguity;
}

const items: { it: Item; kind: Row["kind"]; verdict: Row["verdict"]; type: string }[] = [
  ...gold.map((g) => ({ it: g as Item, kind: "gold" as const, verdict: g.verdict, type: g.fault ?? g.verdict })),
  ...mutants.map((m) => ({ it: m as Item, kind: "mutant" as const, verdict: "fatal" as const, type: m.type })),
].slice(0, Number(process.env.LIMIT ?? Infinity));

let done = 0;
const rows: Row[] = await pool(items, CONCURRENCY, async ({ it, kind, verdict, type }) => {
  const blocks = (r: any) => r.findings.filter((f: any) => f.severity === "block").map((f: any) => f.rule);
  const row: Row = {
    id: it.id,
    kind,
    verdict,
    type,
    gateBefore: blocks(QA_BEFORE.checkQuestion(it)),
    gate: blocks(QA.checkQuestion(it)),
    probe: await probe(it, "s1-instant"),
    flag: null,
  };
  if (QA.hasWriterFlag(it.reviewerFlag)) {
    const f: any = await cached("flag", { v: it.vignette, l: it.leadIn, o: it.options, k: it.correctOption, e: it.explanation, r: it.reviewerFlag }, () =>
      VERIFY.checkWriterFlag(config, it, it.examTrack)
    );
    row.flag = { verdict: f.verdict, confirmed: f.confirmed };
  }
  if (VARIANTS) {
    row.mini = await probe(it, "mini", { model: MINI });
    row.sc = [];
    for (let k = 0; k < 3; k++) row.sc.push(await probe(it, `s1-instant-t0.7-${k}`, { temperature: 0.7 }));
    row.consMini = await consistency(it, "mini", MINI);
    row.consS1 = await consistency(it, "s1-instant");
    row.ambS1 = await ambiguity(it, "s1-instant");
    row.ambMini = await ambiguity(it, "mini", MINI);
  }
  if (++done % 25 === 0) console.log(`  ${done}/${items.length}`);
  return row;
});
writeJson(path.join(OUT, "rows.json"), rows);

// ── Pipelines ───────────────────────────────────────────────────────────────

const concern = (p?: Probe) => !!p && !p.error && p.agreed && !!p.answer && (!p.solvable || !!p.issue);
const flagHold = (r: Row) => !!r.flag && !r.flag.confirmed;
/** Majority of three sampled reads: held when the key does not win two. */
const scDisagree = (r: Row) => (r.sc ?? []).filter((p) => !p.error && p.answer && !p.agreed).length >= 2;
const scConcern = (r: Row) => (r.sc ?? []).filter((p) => concern(p)).length >= 2;

const PIPELINES: Record<string, (r: Row) => boolean> = {
  "before (live until step 1)": (r) => r.gateBefore.length > 0 || !r.probe.agreed || flagHold(r),
  "step 1 (gate + probe concern)": (r) => r.gate.length > 0 || !r.probe.agreed || concern(r.probe) || flagHold(r),
};
if (VARIANTS) {
  const step1 = PIPELINES["step 1 (gate + probe concern)"];
  const second = (r: Row) => step1(r) || r.mini?.agreed === false;
  const amb = (a?: Ambiguity) => !!a && a.defect !== "none";
  Object.assign(PIPELINES, {
    "step 1 + second blind read (mini)": second,
    "step 1 + second read + ambiguity (s1-instant)": (r: Row) => second(r) || amb(r.ambS1),
    "step 1 + second read + ambiguity (mini)": (r: Row) => second(r) || amb(r.ambMini),
    "step 1 + second read + consistency (mini)": (r: Row) => second(r) || r.consMini?.consistent === false,
    "step 1, probe as 3-read majority": (r: Row) => r.gate.length > 0 || scDisagree(r) || scConcern(r) || flagHold(r),
    "step 1 + second read, no flag check": (r: Row) => r.gate.length > 0 || !r.probe.agreed || concern(r.probe) || r.mini?.agreed === false,
  });
}

/** Single checks, to see what each one contributes on its own. */
const CHECKS: Record<string, (r: Row) => boolean> = {
  "gate (before)": (r) => r.gateBefore.length > 0,
  "gate (now)": (r) => r.gate.length > 0,
  "probe disagreement": (r) => !r.probe.agreed,
  "probe concern": (r) => concern(r.probe),
  "flag check": flagHold,
  ...(VARIANTS
    ? {
        "mini probe disagreement": (r: Row) => r.mini?.agreed === false,
        "3-read majority disagreement": scDisagree,
        "consistency (mini)": (r: Row) => r.consMini?.consistent === false,
        "consistency (s1-instant)": (r: Row) => r.consS1?.consistent === false,
        "ambiguity (s1-instant)": (r: Row) => !!r.ambS1 && r.ambS1.defect !== "none",
        "ambiguity (mini)": (r: Row) => !!r.ambMini && r.ambMini.defect !== "none",
      }
    : {}),
};

const pct = (n: number, d: number) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : "–");
const groups: Record<string, Row[]> = {
  "gold fatal": rows.filter((r) => r.kind === "gold" && r.verdict === "fatal"),
  "gold sound (ok)": rows.filter((r) => r.kind === "gold" && r.verdict === "ok"),
  "gold minor": rows.filter((r) => r.kind === "gold" && r.verdict === "minor"),
  "planted faults": rows.filter((r) => r.kind === "mutant"),
};
const mutantTypes = [...new Set(rows.filter((r) => r.kind === "mutant").map((r) => r.type))];

const score = (fn: (r: Row) => boolean) => ({
  ...Object.fromEntries(Object.entries(groups).map(([g, rs]) => [g, pct(rs.filter(fn).length, rs.length)])),
  byType: Object.fromEntries(mutantTypes.map((t) => {
    const rs = rows.filter((r) => r.kind === "mutant" && r.type === t);
    return [t, pct(rs.filter(fn).length, rs.length)];
  })),
  faultsMissed: rows.filter((r) => r.verdict === "fatal" && !fn(r)).map((r) => `${r.id} (${r.type})`),
  soundHeld: rows.filter((r) => r.kind === "gold" && r.verdict === "ok" && fn(r)).map((r) => r.id.slice(0, 8)),
});

const report = {
  at: new Date().toISOString(),
  items: { gold: gold.length, mutants: mutants.length },
  errors: {
    probe: rows.filter((r) => r.probe.error).length,
    mini: rows.filter((r) => r.mini?.error).length,
    consMini: rows.filter((r) => r.consMini?.error).length,
    ambiguity: rows.filter((r) => r.ambS1?.error || r.ambMini?.error).length,
  },
  pipelines: Object.fromEntries(Object.entries(PIPELINES).map(([k, fn]) => [k, score(fn)])),
  checks: Object.fromEntries(Object.entries(CHECKS).map(([k, fn]) => [k, score(fn)])),
};
writeJson(path.join(OUT, "report.json"), report);

const table = (title: string, entries: Record<string, ReturnType<typeof score>>) => {
  const cols = ["gold fatal", "planted faults", "gold sound (ok)", "gold minor"];
  let md = `### ${title}\n\n| | held: gold fatal | held: planted | held: sound (waste) | held: minor |\n|---|---|---|---|---|\n`;
  for (const [k, s] of Object.entries(entries)) md += `| ${k} | ${cols.map((c) => (s as any)[c]).join(" | ")} |\n`;
  md += `\n| planted fault | ${Object.keys(entries).join(" | ")} |\n|---|${Object.keys(entries).map(() => "---").join("|")}|\n`;
  for (const t of mutantTypes) md += `| ${t} | ${Object.values(entries).map((s) => s.byType[t]).join(" | ")} |\n`;
  return md;
};
const md = `# QBank accuracy run — ${report.at}\n\n${gold.length} gold items, ${mutants.length} planted faults. Errors (failed open): probe ${report.errors.probe}, mini ${report.errors.mini}, consistency ${report.errors.consMini}.\n\n${table("Pipelines", report.pipelines)}\n${table("Single checks", report.checks)}`;
fs.writeFileSync(path.join(OUT, "report.md"), md);
console.log(md);
