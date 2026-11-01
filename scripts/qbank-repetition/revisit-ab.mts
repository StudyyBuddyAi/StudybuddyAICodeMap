// Does the revisit wording make the writer come at a missed concept from a new
// direction? Replays every revisit wave arm G produced, with the old and the
// current paragraph, and compares each revisit item's lead-in with the earlier
// question its row quotes. The prompts are otherwise byte-identical.
import fs from "node:fs";
import path from "node:path";
import { OUT, pool, streamWriter, prepareBatch, buildBatchPlan, systemPromptFor } from "./common.mts";

const OLD =
  "A revisit row is a concept this student answered wrongly in an earlier session. Test the same concept again through a new patient and a different question from the one quoted, so that it is answered from understanding rather than from memory of the earlier item.";
const NEW =
  "A revisit row is a concept this student answered wrongly in an earlier session. Test the same concept again, but come at it from a different direction than the question quoted on its row, the way the exam would: if that asked for the treatment, ask what to monitor once it is started or which patient it would be wrong for; if it asked for the diagnosis, ask for the finding or the test that settles it; if it asked for a mechanism, ask for the finding or the consequence the mechanism explains. Use a new patient and never reuse the quoted lead-in, so the item is answered from understanding rather than from memory of the earlier one.";
const SAMPLES = Number(process.env.SAMPLES ?? 2);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
const jaccard = (a: string, b: string) => {
  const A = new Set(norm(a)), B = new Set(norm(b));
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / (A.size + B.size - inter || 1);
};

const cases: { file: string; index: number; earlier: string; message: string; examMode: string; system: string }[] = [];
for (const topic of fs.readdirSync(path.join(OUT, "G"))) {
  for (const f of fs.readdirSync(path.join(OUT, "G", topic))) {
    const rec = JSON.parse(fs.readFileSync(path.join(OUT, "G", topic, f), "utf8"));
    const row = rec.items.find((x: any) => x.concept?.mode === "revisit");
    if (!row || !rec.userMessage.includes(OLD)) continue;
    const quoted = new RegExp(`- Question ${row.index}:[^\\n]*\\(earlier question: "([^"]*)"\\)`).exec(rec.userMessage)?.[1];
    if (!quoted) continue;
    cases.push({ file: `${topic}/${f}`, index: row.index, earlier: quoted, message: rec.userMessage, examMode: rec.examMode, system: rec.system });
  }
}
console.log(`${cases.length} revisit waves`);

const jobs = cases.flatMap((c) => ["old", "new"].flatMap((arm) => Array.from({ length: SAMPLES }, (_, s) => ({ c, arm, s }))));
const results = await pool(jobs, Number(process.env.CONCURRENCY ?? 3), async ({ c, arm, s }) => {
  const file = path.join(OUT, "revisit-ab", `${c.file.replace(/[\\/]/g, "_")}-${arm}-${s}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const user = arm === "old" ? c.message : c.message.replace(OLD, NEW);
  // The system prompt only depends on the mode and family, which the plan carries.
  const plan = buildBatchPlan(c.system, 5, Math.random, 1, "balanced", c.examMode, []);
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { content } = await streamWriter(systemPromptFor(plan), user, 0.7);
      const qs = prepareBatch(content, plan).questions;
      const item = qs.find((q: any) => q.index === c.index) ?? qs[c.index - 1];
      if (!item) throw new Error("revisit item missing");
      const out = { case: c.file, arm, sample: s, earlier: c.earlier, leadIn: item.leadIn, key: item.options[item.correctOption], sim: jaccard(c.earlier, item.leadIn) };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(out, null, 1));
      return out;
    } catch (err) {
      if (attempt === 4) return { case: c.file, arm, sample: s, error: String(err) };
      await new Promise((r) => setTimeout(r, 15_000 * attempt));
    }
  }
});

for (const arm of ["old", "new"]) {
  const rs = results.filter((r: any) => r.arm === arm && !r.error);
  const same = rs.filter((r: any) => r.sim >= 0.999).length;
  const near = rs.filter((r: any) => r.sim >= 0.6).length;
  const mean = rs.reduce((a: number, r: any) => a + r.sim, 0) / (rs.length || 1);
  console.log(`${arm}: n=${rs.length}  identical lead-in ${same}  near-identical (≥0.6) ${near}  mean similarity ${mean.toFixed(2)}`);
}
for (const r of results as any[]) if (!r.error) console.log(`${r.arm} ${r.case} ${r.sim.toFixed(2)} | ${r.leadIn}\n      earlier: ${r.earlier}\n      key: ${r.key}`);
