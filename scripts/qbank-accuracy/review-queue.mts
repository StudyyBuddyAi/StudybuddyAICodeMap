// The human review queue: live questions a person should read, in priority
// order, as a page to read and a JSON file to fill in. Read-only.
//   node scripts/qbank-accuracy/review-queue.mts            → out/review-<date>.md / .json
//   SAMPLE=20 node scripts/qbank-accuracy/review-queue.mts  (more random spot checks)
//
// 1. Reported by a student (question_reports, open).
// 2. Withdrawn automatically and not yet reviewed (generation_meta.held, e.g.
//    the full-explanation writer disputing the key).
// 3. Served while carrying a signal the current gate would hold: a probe
//    objection, or a writer flag naming the "real" key.
// 4. A random sample of served questions: the unbiased part of the gold set.
//
// Questions already in labels.json are skipped. Fill in `verdict` (ok | minor |
// fatal), `fault` and `note` per item, then run apply-verdicts.mts.
import fs from "node:fs";
import path from "node:path";
import { HERE, OUT, readJson, writeJson, liveQuery, LETTERS } from "./common.mts";

const SAMPLE = Number(process.env.SAMPLE ?? 10);
const labelled = new Set((readJson(path.join(HERE, "labels.json")) as { id: string }[]).map((l) => l.id));
const skip = labelled.size ? `and q.id not in (${[...labelled].map((id) => `'${id}'`).join(",")})` : "";
const reviewed = `not (coalesce(q.generation_meta, '{}'::jsonb) ? 'review')`;
const served = `q.id in (select unnest(question_ids) from qbank_sessions union select question_id from user_attempts)`;

const COLUMNS = `q.id, q.exam_mode, q.topic, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.option_e,
  q.correct_option, q.explanation, q.teaching_point, q.generation_meta->>'reviewerFlag' as writer_flag,
  q.generation_meta->'verification' as probe, q.generation_meta->'held' as held`;

const sections: { why: string; sql: string }[] = [
  {
    why: "reported by a student",
    sql: `select ${COLUMNS}, string_agg(r.reason || coalesce(': ' || r.note, ''), ' | ') as signal
          from questions q join question_reports r on r.question_id = q.id
          where r.status = 'open' ${skip} group by q.id`,
  },
  {
    why: "withdrawn automatically, not yet reviewed",
    sql: `select ${COLUMNS}, (q.generation_meta->'held'->>'source') || ': ' || (q.generation_meta->'held'->>'reason') as signal
          from questions q where q.generation_meta ? 'held' and ${reviewed} ${skip}`,
  },
  {
    why: "served with a signal the gate now holds",
    sql: `select ${COLUMNS}, coalesce(nullif(q.generation_meta->'verification'->>'issue', ''), q.generation_meta->>'reviewerFlag') as signal
          from questions q
          where q.origin = 'generated' and ${served} and ${reviewed} and not (q.generation_meta ? 'held') ${skip}
            and (
              (coalesce((q.generation_meta->'verification'->>'agreed')::boolean, true)
                and (nullif(q.generation_meta->'verification'->>'issue', '') is not null
                     or q.generation_meta->'verification'->>'solvable' = 'false'))
              or q.generation_meta->>'reviewerFlag' ~* 'correct(ed)?\\s+(answer|key|option|choice)\\s+(is|to|should be|was)\\s+(option\\s+)?\\(?[a-e]\\)?'
            )`,
  },
  {
    why: "random spot check of a served question",
    sql: `select ${COLUMNS}, null as signal from questions q
          where q.origin = 'generated' and ${served} and ${reviewed} and not (q.generation_meta ? 'held') ${skip}
          order by md5(q.id::text || current_date::text) limit ${SAMPLE}`,
  },
];

const seen = new Set<string>();
const items: any[] = [];
for (const s of sections) {
  for (const r of liveQuery(s.sql)) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    items.push({ ...r, why: s.why });
  }
}

const date = new Date().toISOString().slice(0, 10);
let md = `# QBank review queue — ${date}\n\n${items.length} questions. Fill in out/review-${date}.json, then run apply-verdicts.mts.\n`;
items.forEach((r, i) => {
  md += `\n## ${i + 1}. ${r.topic ?? ""} — ${r.why}\n\`${r.id}\` · ${r.exam_mode ?? "step1"}${r.signal ? `\n\n> ${String(r.signal).replace(/\n/g, " ")}` : ""}\n\n${r.question_text}\n\n`;
  for (const l of LETTERS) md += `${l === r.correct_option ? "**" : ""}${l.toUpperCase()}. ${r[`option_${l}`]}${l === r.correct_option ? "** (key)" : ""}  \n`;
  if (r.probe?.answer && r.probe.answer !== r.correct_option) md += `\nBlind probe chose ${String(r.probe.answer).toUpperCase()}.\n`;
  md += `\n**Explanation.** ${r.explanation ?? ""}\n`;
  if (r.writer_flag && !/^none\.?$/i.test(r.writer_flag.trim())) md += `\n**Writer flag.** ${r.writer_flag}\n`;
});

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `review-${date}.md`), md);
writeJson(
  path.join(OUT, `review-${date}.json`),
  items.map((r) => ({ id: r.id, why: r.why, topic: r.topic, verdict: "", fault: "", note: "" }))
);
console.log(`${items.length} questions → out/review-${date}.md (read) and out/review-${date}.json (fill in)`);
