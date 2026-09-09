/**
 * Re-runs the QA gate over raw output a previous run already paid for.
 *
 * prepareBatch is pure given the model's text and the batch plan, so a change
 * to a rule can be scored against the same fifty questions without spending a
 * single token. Point it at a run's report.json.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const { prepareBatch } = await import(path.join(ROOT, "supabase/functions/_shared/qbank-persist.ts"));

const reportPath = process.argv[2];
if (!reportPath) throw new Error("usage: regate.ts <path to report.json>");
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const rawDir = path.join(path.dirname(reportPath), "raw");

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

const byRule = new Map<string, { severity: string; items: number; details: string[] }>();
let items = 0;
let blocked = 0;
let withFindings = 0;

for (const [i, run] of (report.runs as Record<string, unknown>[]).entries()) {
  if (run.genError) continue;
  const file = path.join(rawDir, `${i + 1}-${slug(String(run.topic))}.txt`);
  if (!fs.existsSync(file)) {
    console.log(`(no raw output for ${run.topic})`);
    continue;
  }

  const plan = { system: "", systemName: "", questions: run.plan };
  const { questions, qa } = prepareBatch(fs.readFileSync(file, "utf8"), plan);

  for (const [n, result] of qa.entries()) {
    items++;
    if (result.blocked) blocked++;
    if (result.findings.length) withFindings++;
    for (const f of result.findings) {
      const entry = byRule.get(f.rule) ?? { severity: f.severity, items: 0, details: [] };
      entry.items++;
      if (entry.details.length < 4) {
        entry.details.push(`[${String(run.topic).slice(0, 22)} Q${result.index}] ${questions[n]?.subtopic ?? ""}`);
      }
      byRule.set(f.rule, entry);
    }
  }
}

console.log(`items ${items} | with a finding ${withFindings} | blocked ${blocked} (${((blocked / items) * 100).toFixed(1)}%)\n`);
for (const [rule, e] of [...byRule.entries()].sort((a, b) => b[1].items - a[1].items)) {
  console.log(`${e.severity.padEnd(5)} ${rule.padEnd(30)} ${String(e.items).padStart(3)}`);
  for (const d of e.details) console.log(`        ${d}`);
}
