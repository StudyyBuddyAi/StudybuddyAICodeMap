// labels.json (reviewer verdicts by question id) → gold.json (the items as
// they were judged). Read-only. Run again after adding labels:
//   node scripts/qbank-accuracy/snapshot.mts
// Items already in gold.json keep their snapshot, so a live edit made after a
// review (the ammonia unit fix, say) never changes what the verdict was about.
import fs from "node:fs";
import path from "node:path";
import { HERE, readJson, writeJson, liveQuery, type GoldItem, type Letter } from "./common.mts";

const labels: { id: string; verdict: GoldItem["verdict"]; fault?: string; note: string }[] = readJson(path.join(HERE, "labels.json"));
const goldPath = path.join(HERE, "gold.json");
const existing: GoldItem[] = fs.existsSync(goldPath) ? readJson(goldPath) : [];
const have = new Map(existing.map((g) => [g.id, g]));

const missing = labels.filter((l) => !have.has(l.id)).map((l) => l.id);
const rows = missing.length
  ? liveQuery(`select id, exam_mode, topic, question_text, option_a, option_b, option_c, option_d, option_e,
       correct_option, explanation, distractor_explanations, teaching_point, generation_meta->>'reviewerFlag' as reviewer_flag
     from questions where id in (${missing.map((id) => `'${id.replace(/[^0-9a-f-]/g, "")}'`).join(",")})`)
  : [];
const byId = new Map(rows.map((r: any) => [r.id, r]));

const gold: GoldItem[] = labels.map((label, i) => {
  const kept = have.get(label.id);
  if (kept) return { ...kept, verdict: label.verdict, fault: label.fault, note: label.note };
  const r: any = byId.get(label.id);
  if (!r) throw new Error(`question ${label.id} not found`);
  // The stem and lead-in are stored joined by a blank line (qbank-persist buildRow).
  const cut = r.question_text.lastIndexOf("\n\n");
  return {
    id: r.id,
    index: i + 1,
    examTrack: r.exam_mode === "step2ck" ? "step2ck" : "step1",
    subtopic: r.topic ?? "",
    vignette: cut > 0 ? r.question_text.slice(0, cut) : r.question_text,
    leadIn: cut > 0 ? r.question_text.slice(cut + 2) : "",
    options: { a: r.option_a, b: r.option_b, c: r.option_c, d: r.option_d, e: r.option_e },
    correctOption: r.correct_option as Letter,
    explanation: r.explanation ?? "",
    distractorExplanations: r.distractor_explanations ?? {},
    teachingPoint: r.teaching_point ?? "",
    reviewerFlag: r.reviewer_flag ?? "None.",
    verdict: label.verdict,
    ...(label.fault ? { fault: label.fault } : {}),
    note: label.note,
  };
});

writeJson(goldPath, gold);
const count = (v: string) => gold.filter((g) => g.verdict === v).length;
console.log(`gold.json: ${gold.length} items — ${count("ok")} ok, ${count("minor")} minor, ${count("fatal")} fatal (${missing.length} fetched)`);
