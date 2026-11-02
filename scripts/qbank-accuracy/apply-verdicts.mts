// Closes the loop on a filled-in review file from review-queue.mts.
//   node scripts/qbank-accuracy/apply-verdicts.mts out/review-<date>.json            (dry run)
//   node scripts/qbank-accuracy/apply-verdicts.mts out/review-<date>.json --apply    (writes live)
//
// Always: every judged item joins labels.json, so the gold set grows with each
// review (run snapshot.mts afterwards to capture the items).
// With --apply, on the live database:
//   - fatal → withdrawn (hold_generated_question), so it leaves review sets and decks
//   - every judged question is stamped generation_meta.review, so the queue
//     does not offer it again
//   - its open student reports are closed: accepted when fatal, rejected when ok,
//     fixed is left to whoever edits the question
import path from "node:path";
import { HERE, readJson, writeJson, liveQuery } from "./common.mts";

const [file, flag] = process.argv.slice(2);
if (!file) throw new Error("usage: apply-verdicts.mts <review.json> [--apply]");
const apply = flag === "--apply";
const REVIEWER = process.env.REVIEWER ?? "owner";

const VERDICTS = ["ok", "minor", "fatal"];
const judged: { id: string; verdict: string; fault?: string; note?: string }[] = readJson(path.resolve(file)).filter(
  (r: any) => r.verdict
);
for (const r of judged) {
  if (!VERDICTS.includes(r.verdict)) throw new Error(`${r.id}: verdict must be one of ${VERDICTS.join(", ")}`);
  if (!/^[0-9a-f-]{36}$/.test(r.id)) throw new Error(`bad id ${r.id}`);
  if (r.verdict === "fatal" && !r.note?.trim()) throw new Error(`${r.id}: a fatal verdict needs a note — it is the withdrawal reason`);
}

const labelsPath = path.join(HERE, "labels.json");
const labels: any[] = readJson(labelsPath);
const known = new Set(labels.map((l) => l.id));
const added = judged.filter((r) => !known.has(r.id));
labels.push(
  ...added.map((r) => ({
    id: r.id,
    verdict: r.verdict,
    ...(r.fault ? { fault: r.fault } : {}),
    note: r.note ?? "",
    reviewer: REVIEWER,
    clinicianConfirmed: process.env.CLINICIAN === "1",
  }))
);
writeJson(labelsPath, labels);
console.log(`labels.json: +${added.length} (now ${labels.length}); run snapshot.mts to capture them`);

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const statements = judged.flatMap((r) => [
  ...(r.verdict === "fatal" ? [`select hold_generated_question(${q(r.id)}, ${q(r.note!.slice(0, 500))}, 'review');`] : []),
  `update questions set generation_meta = coalesce(generation_meta, '{}'::jsonb) || jsonb_build_object('review', jsonb_build_object('verdict', ${q(r.verdict)}, 'fault', ${q(r.fault ?? "")}, 'by', ${q(REVIEWER)}, 'at', now())) where id = ${q(r.id)};`,
  // A minor flaw leaves the report open for whoever edits the question.
  ...(r.verdict === "minor"
    ? []
    : [`update question_reports set status = ${q(r.verdict === "fatal" ? "accepted" : "rejected")}, resolved_at = now() where question_id = ${q(r.id)} and status = 'open';`]),
]);

if (!apply) {
  console.log(`\nDry run — ${judged.length} verdicts, ${judged.filter((r) => r.verdict === "fatal").length} withdrawals. Would run:\n`);
  console.log(statements.join("\n"));
  console.log("\nRe-run with --apply to write them.");
} else {
  liveQuery(`begin;\n${statements.join("\n")}\ncommit;`);
  console.log(`applied ${judged.length} verdicts on live`);
}
