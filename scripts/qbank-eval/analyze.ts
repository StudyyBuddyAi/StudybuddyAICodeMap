/**
 * Aggregates the report.json written by run.ts into the numbers worth reading.
 * Pure reporting - reads only, changes nothing.
 */

import fs from "node:fs";
import path from "node:path";

const REPORT = process.argv[2] ?? path.join(process.env.QBANK_EVAL_OUT ?? "", "report.json");
const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));

type Num = number[];
const num = (xs: Num) => xs.filter((x) => typeof x === "number" && !Number.isNaN(x));
const sum = (xs: Num) => num(xs).reduce((a, b) => a + b, 0);
const mean = (xs: Num) => (num(xs).length ? sum(xs) / num(xs).length : NaN);
const pct = (xs: Num, p: number) => {
  const s = num(xs).slice().sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const r0 = (x: number) => (Number.isNaN(x) ? "-" : Math.round(x).toString());
const r1 = (x: number) => (Number.isNaN(x) ? "-" : x.toFixed(1));
const tally = <T extends string>(xs: T[]) => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const line = (s = "") => console.log(s);

const runs = report.runs as Record<string, unknown>[];
const ok = runs.filter((r) => !r.genError);
const allQ = ok.flatMap((r) => (r.questions ?? []) as Record<string, unknown>[]);
const allQa = ok.flatMap((r) => (r.qa ?? []) as { index: number; findings: { rule: string; severity: string; detail: string }[]; blocked: boolean }[]);
const allCold = ok.flatMap((r) => (r.cold ?? []) as Record<string, unknown>[]);

line(`# QBank on-demand generation - measured run`);
line(`model: ${report.model} | batch size: ${report.count} | topics: ${runs.length} | started ${report.startedAt}`);
line();

// -- 1. pipeline reliability ------------------------------------------------
line(`## 1. Pipeline`);
line(`| topic | routed | conf | router ms | writer ms | finish | chars | server rows | client drafts | blocked | playable |`);
line(`|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of runs) {
  const s = r.stream as Record<string, number | string> | undefined;
  const p = r.parse as Record<string, number> | undefined;
  const qa = (r.qa ?? []) as { blocked: boolean }[];
  const rt = r.router as Record<string, unknown>;
  const blocked = qa.filter((q) => q.blocked).length;
  line(
    `| ${String(r.topic).slice(0, 44)} | ${rt.system}${rt.fellBack ? " (FALLBACK)" : ""} | ${rt.confidence ?? "-"} | ${rt.ms} | ` +
    `${r.genError ? "FAILED: " + r.genError : s?.totalMs} | ${s?.finishReason ?? "-"} | ${s?.contentChars ?? "-"} | ` +
    `${p?.serverPersisted ?? "-"} | ${p?.clientDrafts ?? "-"} | ${blocked || 0} | ${(p?.clientDrafts ?? 0) - blocked} |`
  );
}
line();
const requested = runs.length * report.count;
const written = sum(ok.map((r) => (r.parse as Record<string, number>).clientDrafts));
const blockedTotal = allQa.filter((q) => q.blocked).length;
line(`requested ${requested} | generated ${written} (${r1((written / requested) * 100)}%) | blocked by QA ${blockedTotal} | playable ${written - blockedTotal} (${r1(((written - blockedTotal) / requested) * 100)}% of requested)`);
const mismatch = ok.filter((r) => {
  const p = r.parse as Record<string, number>;
  return p.serverPersisted !== p.clientDrafts;
});
line(`server/client parse count mismatches: ${mismatch.length}`);
line();

// -- 2. router --------------------------------------------------------------
line(`## 2. Router`);
for (const r of runs) {
  const rt = r.router as Record<string, unknown>;
  const expected = String(r.expectSystem).split("|");
  const hit = expected.includes(String(rt.system));
  line(`- ${hit ? "OK  " : "MISS"} "${r.topic}" -> ${rt.system} (conf ${rt.confidence ?? "-"}, ${rt.ms}ms) [expected ${r.expectSystem}] ${r.note}`);
}
const routerMs = runs.map((r) => (r.router as Record<string, number>).ms);
line(`router latency: mean ${r0(mean(routerMs))}ms, p50 ${r0(pct(routerMs, 50))}ms, max ${r0(Math.max(...routerMs))}ms`);
line();

// -- 3. latency -------------------------------------------------------------
line(`## 3. Latency`);
const totals = ok.map((r) => (r.stream as Record<string, number>).totalMs);
const ttfb = ok.map((r) => (r.stream as Record<string, number>).ttfbMs);
const ttfc = ok.map((r) => (r.stream as Record<string, number>).ttfcMs);
line(`writer total : mean ${r1(mean(totals) / 1000)}s | p50 ${r1(pct(totals, 50) / 1000)}s | p90 ${r1(pct(totals, 90) / 1000)}s | min ${r1(Math.min(...totals) / 1000)}s | max ${r1(Math.max(...totals) / 1000)}s`);
line(`time to first byte   : mean ${r0(mean(ttfb))}ms`);
line(`time to first content: mean ${r0(mean(ttfc))}ms  (= how long the progress console shows nothing but "routing")`);
const firstReveal = ok.map((r) => ((r.stream as { reveals: { ms: number }[] }).reveals[0]?.ms ?? NaN));
const lastReveal = ok.map((r) => {
  const rev = (r.stream as { reveals: { ms: number }[] }).reveals;
  return rev[rev.length - 1]?.ms ?? NaN;
});
line(`first question tick  : mean ${r1(mean(firstReveal) / 1000)}s | max ${r1(Math.max(...num(firstReveal)) / 1000)}s`);
line(`last question tick   : mean ${r1(mean(lastReveal) / 1000)}s`);
const gaps: number[] = [];
for (const r of ok) {
  const rev = (r.stream as { reveals: { ms: number }[] }).reveals;
  for (let i = 1; i < rev.length; i++) gaps.push(rev[i].ms - rev[i - 1].ms);
}
line(`gap between ticks    : mean ${r1(mean(gaps) / 1000)}s | max ${r1(Math.max(...gaps) / 1000)}s`);
const chars = ok.map((r) => (r.stream as Record<string, number>).contentChars);
line(`output              : mean ${r0(mean(chars))} chars/batch, ~${r0(mean(chars) / 4)} tokens; throughput ~${r0(mean(chars.map((c, i) => c / (totals[i] / 1000))))} chars/s`);
line(`reasoning deltas    : ${sum(ok.map((r) => (r.stream as Record<string, number>).reasoningChars))} chars total (0 expected on an -instant model)`);
const coldMs = allCold.map((c) => c.ms as number);
line(`cold-answer probe   : mean ${r0(mean(coldMs))}ms per item (harness only, not in production)`);
const usages = ok.map((r) => (r.stream as { usage: unknown }).usage).filter(Boolean);
line(`usage frames returned by Corti: ${usages.length}/${ok.length}${usages.length ? " " + JSON.stringify(usages[0]) : " (no token accounting available in-stream)"}`);
line();

// -- 4. QA gate -------------------------------------------------------------
line(`## 4. QA gate (src/lib/qbank-qa.ts)`);
const findings = allQa.flatMap((q) => q.findings);
line(`items checked ${allQa.length} | items with >=1 finding ${allQa.filter((q) => q.findings.length).length} | blocked ${blockedTotal} (${r1((blockedTotal / Math.max(1, allQa.length)) * 100)}%)`);
line();
line(`| rule | severity | hits | items | % of items |`);
line(`|---|---|---|---|---|`);
for (const [rule, n] of tally(findings.map((f) => f.rule))) {
  const sev = findings.find((f) => f.rule === rule)!.severity;
  const items = allQa.filter((q) => q.findings.some((f) => f.rule === rule)).length;
  line(`| ${rule} | ${sev} | ${n} | ${items} | ${r1((items / allQa.length) * 100)}% |`);
}
line();
line(`Blocking findings in full:`);
for (const r of ok) {
  for (const q of (r.qa ?? []) as { index: number; blocked: boolean; findings: { rule: string; severity: string; detail: string }[] }[]) {
    for (const f of q.findings.filter((f) => f.severity === "block")) {
      line(`- [${String(r.topic).slice(0, 30)} Q${q.index}] ${f.rule}: ${f.detail}`);
    }
  }
}
line();

// -- 5. blueprint adherence -------------------------------------------------
line(`## 5. Blueprint adherence`);
const perm = ok.flatMap((r) => (r.permutation ?? []) as Record<string, unknown>[]);
if (perm.length) {
  const moved = perm.filter((p) => p.moved).length;
  line(`the model's own key choice : ${tally(perm.map((p) => String(p.modelChose))).map(([k, n]) => `${k}=${n}`).join("  ")}`);
  line(`after permutation          : ${tally(allQ.map((q) => q.correctOption as string)).map(([k, n]) => `${k}=${n}`).join("  ")}`);
  line(`options permuted in ${moved}/${perm.length} items (${r1((moved / perm.length) * 100)}%) — the spread is bought here, not asked of the model`);
} else {
  const letterHit = allQ.filter((q) => q.correctOption === q.plannedLetter).length;
  line(`answer letter matches the plan: ${letterHit}/${allQ.length} (${r1((letterHit / allQ.length) * 100)}%)`);
  line(`actual key distribution : ${tally(allQ.map((q) => q.correctOption as string)).map(([k, n]) => `${k}=${n}`).join("  ")}`);
}
line(`planned key distribution: ${tally(runs.flatMap((r) => (r.plan as { answerLetter: string }[]).map((p) => p.answerLetter))).map(([k, n]) => `${k}=${n}`).join("  ")}`);
const orderHit = allQ.filter((q) => q.reasoningOrder === q.plannedOrder).length;
line(`reasoning order matches plan: ${orderHit}/${allQ.length} (${r1((orderHit / allQ.length) * 100)}%)`);
line(`reasoning order actual : ${tally(allQ.map((q) => q.reasoningOrder as string)).map(([k, n]) => `${k}=${n}`).join("  ")}`);
line(`difficulty             : ${tally(allQ.map((q) => q.difficulty as string)).map(([k, n]) => `${k}=${n}`).join("  ")}`);
// Positional bias: the mix used to be emitted in order, so Q1 was always the
// easy one. These two lines are what tell you whether the shuffle took.
line(`  1st-order sat at index : ${tally(allQ.filter((q) => q.reasoningOrder === "1st").map((q) => String(q.index))).map(([k, n]) => `Q${k}×${n}`).join("  ")}`);
line(`  Easy items sat at index: ${tally(allQ.filter((q) => q.difficulty === "Easy").map((q) => String(q.index))).map(([k, n]) => `Q${k}×${n}`).join("  ")}`);
line(`domain                 : ${tally(allQ.map((q) => q.domain as string)).map(([k, n]) => `${k}=${n}`).join("  ")}`);
line(`competency             : ${tally(allQ.map((q) => q.competency as string)).map(([k, n]) => `${k}=${n}`).join("  ")}`);
line();

// -- 6. item shape ----------------------------------------------------------
line(`## 6. Item shape`);
const vw = allQ.map((q) => q.vignetteWords as number);
const vs = allQ.map((q) => q.vignetteSentences as number);
line(`vignette: mean ${r0(mean(vw))} words / ${r1(mean(vs))} sentences | range ${Math.min(...vs)}-${Math.max(...vs)} sentences`);
line(`  by domain: ${tally(allQ.map((q) => q.domain as string)).map(([d]) => `${d} ${r1(mean(allQ.filter((q) => q.domain === d).map((q) => q.vignetteSentences as number)))}`).join(" | ")}`);
line(`  prompt targets: short 3-5 (histopath/anatomy/1st-order pharm/pattern), medium 5-8 (physio/embryo/2nd-order), long 8-12 (3rd-order only)`);
const byOrder = ["1st", "2nd", "3rd"];
line(`  by reasoning order: ${byOrder.map((o) => `${o} ${r1(mean(allQ.filter((q) => q.reasoningOrder === o).map((q) => q.vignetteSentences as number)))}`).join(" | ")}`);
const keyRatio = allQ.map((q) => (q.keyChars as number) / (q.longestDistractorChars as number));
line(`key length / longest distractor: mean ${r1(mean(keyRatio) * 100)}% | over 100% in ${allQ.filter((q) => (q.keyChars as number) > (q.longestDistractorChars as number)).length}/${allQ.length} items (block threshold is 140% AND +20 chars)`);
const ew = allQ.map((q) => q.explanationWords as number);
line(`explanation: mean ${r0(mean(ew))} words | range ${Math.min(...ew)}-${Math.max(...ew)} | bolds mean ${r1(mean(allQ.map((q) => q.explanationBolds as number)))} (cap 5)`);
line(`teaching point present: ${allQ.filter((q) => (q.teachingPointWords as number) > 0).length}/${allQ.length} | mean ${r0(mean(allQ.map((q) => q.teachingPointWords as number)))} words`);
line(`distractor explanations: ${allQ.filter((q) => q.distractorExplanationCount === 4).length}/${allQ.length} items have all four`);
line(`reasoning chain: mean ${r0(mean(allQ.map((q) => q.reasoningChainWords as number)))} words (billed output, never shown to a student)`);
line(`suggestedImage needed: ${tally(allQ.map((q) => String(q.suggestedImageNeeded))).map(([k, n]) => `${k}=${n}`).join("  ")} (no image is ever fetched)`);
line();

// -- 7. self-report ---------------------------------------------------------
line(`## 7. The model's own report`);
const anyFalse = allQ.filter((q) => (q.selfCheckFalse as string[]).length > 0);
line(`selfCheck all-true: ${allQ.length - anyFalse.length}/${allQ.length}`);
for (const q of anyFalse) line(`  - Q${q.index}: ${(q.selfCheckFalse as string[]).join(", ")}`);
const flagged = allQ.filter((q) => !/^none\.?$/i.test(String(q.reviewerFlag).trim()));
line(`reviewerFlag not "None.": ${flagged.length}/${allQ.length}`);
for (const q of flagged) line(`  - ${String(q.subtopic).slice(0, 40)}: ${String(q.reviewerFlag).slice(0, 220)}`);
line();

// -- 8. cold answering ------------------------------------------------------
line(`## 8. Independent cold-answering pass (harness-only accuracy probe)`);
const answered = allCold.filter((c) => !c.error && c.answer);
const agree = answered.filter((c) => c.answer === c.key);
line(`answered ${answered.length}/${allCold.length} | agreed with the key ${agree.length} (${r1((agree.length / Math.max(1, answered.length)) * 100)}%)`);
line(`judged unsolvable/ambiguous by the answerer: ${answered.filter((c) => c.solvable === false).length}`);
line(`mean self-reported confidence: ${r1(mean(answered.map((c) => c.confidence as number)))}`);
line();
line(`Disagreements and flagged items:`);
for (const r of ok) {
  for (const c of (r.cold ?? []) as Record<string, unknown>[]) {
    const bad = c.answer !== c.key || c.solvable === false || (c.issue && !/^none\.?$/i.test(String(c.issue).trim()));
    if (!bad) continue;
    const q = ((r.questions ?? []) as Record<string, unknown>[]).find((x) => x.index === c.index);
    line(`- [${String(r.topic).slice(0, 28)} Q${c.index}] key=${c.key} answered=${c.answer || "-"} conf=${c.confidence ?? "-"} solvable=${c.solvable} :: ${c.issue || "-"} :: ${q?.subtopic ?? ""}`);
  }
}
line();

// -- 9. duplication ---------------------------------------------------------
line(`## 9. Within-batch duplication`);
for (const r of ok) {
  const dups = ((r.qa ?? []) as { findings: { rule: string; detail: string }[] }[])
    .flatMap((q) => q.findings.filter((f) => f.rule === "duplicate-question").map((f) => f.detail));
  const uniq = [...new Set(dups)];
  if (uniq.length) line(`- ${String(r.topic).slice(0, 40)}: ${uniq.join(" | ")}`);
}
line(`subtopics per batch (are the five items actually different?):`);
for (const r of ok) {
  line(`- ${String(r.topic).slice(0, 40)}: ${((r.questions ?? []) as Record<string, unknown>[]).map((q) => q.subtopic).join(" / ")}`);
}
