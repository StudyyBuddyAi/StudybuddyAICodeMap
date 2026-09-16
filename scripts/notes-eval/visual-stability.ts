/**
 * How predictable is each sheet's visual?
 *
 * Against a running dev server with VITE_LOCAL_FUNCTIONS=1, for each topic:
 *   1. sheets — writes a fresh sheet with each writer RUNS times and plans its
 *      visual. Variation here mixes sheet wording with the planner.
 *   2. replans — plans ONE fixed sheet RUNS times. Variation here is the
 *      planner alone and should be zero.
 * Agreement is scored on what a student sees — which diagram and which
 * illustration view the sheet offers; the planner's reasons are printed
 * alongside for diagnosis.
 *
 *   node scripts/notes-eval/visual-stability.ts
 *   BASE=http://localhost:8083 RUNS=3 WRITERS=corti,gpt-oss TOPICS="DKA management|Brachial plexus anatomy" node scripts/notes-eval/visual-stability.ts
 *
 * Costs a few cents of OpenRouter/Corti credit per run of the default set.
 */

const BASE = process.env.BASE ?? "http://localhost:8083";
const RUNS = Number(process.env.RUNS ?? 3);
const WRITERS = (process.env.WRITERS ?? "corti,gpt-oss").split(",").map((w) => w.trim()).filter(Boolean);
const TOPICS = (
  process.env.TOPICS ??
  "Diabetic ketoacidosis management|Pulmonary embolism workup|Brachial plexus anatomy|Renal corpuscle and nephron histology|Hyperkalemia management"
).split("|");

type Sheet = { topic?: string; overview?: string; clinicalApproach?: string; keyPoints?: string[] };

async function writeSheet(topic: string, writer: string): Promise<Sheet | null> {
  const res = await fetch(`${BASE}/__local-fns/medical-notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-local-writer": writer },
    body: JSON.stringify({ notes: topic, length: "Concise", persona: "student" }),
  });
  if (!res.ok) return null;
  let text = "";
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
    try {
      text += JSON.parse(line.slice(6))?.choices?.[0]?.delta?.content ?? "";
    } catch {
      // not a content frame
    }
  }
  try {
    return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
}

/** Returns [scored outcome, printed detail]. */
async function plan(sheet: Sheet, fallbackTopic: string): Promise<[string, string]> {
  const res = await fetch(`${BASE}/__local-fns/sheet-visual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: sheet.topic || fallbackTopic,
      overview: sheet.overview ?? "",
      clinicalApproach: sheet.clinicalApproach ?? "",
      keyPoints: sheet.keyPoints ?? [],
    }),
  });
  if (!res.ok) return [`planner_error_${res.status}`, `planner_error_${res.status}`];
  const r = await res.json();
  const seen = `diagram: ${r.diagram?.kind ?? "none"} · illustration: ${r.illustration?.view ?? "none"}`;
  return [seen, `${seen}   (${r.reason?.diagram}, ${r.reason?.illustration})`];
}

function agreement(outcomes: string[]): string {
  const counts = new Map<string, number>();
  for (const o of outcomes) counts.set(o, (counts.get(o) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const detail = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([o, n]) => `${n}× ${o}`).join("; ");
  return `${Math.round((top / outcomes.length) * 100)}% agree — ${detail}`;
}

let sheetAgree = 0;
let replanAgree = 0;
for (const topic of TOPICS) {
  console.log(`\n■ ${topic}`);
  const outcomes: string[] = [];
  let fixedSheet: Sheet | null = null;
  for (const writer of WRITERS) {
    for (let i = 0; i < RUNS; i++) {
      const sheet = await writeSheet(topic, writer);
      if (!sheet) {
        outcomes.push("sheet_failed");
        console.log(`  ${writer} #${i + 1}: sheet failed`);
        continue;
      }
      fixedSheet ??= sheet;
      const [outcome, detail] = await plan(sheet, topic);
      outcomes.push(outcome);
      console.log(`  ${writer} #${i + 1}: ${detail}`);
    }
  }
  // A sheet that failed to generate says nothing about the visual, so it is reported but not scored.
  const scored = outcomes.filter((o) => o !== "sheet_failed");
  const failed = outcomes.length - scored.length;
  console.log(`  sheets:  ${scored.length ? agreement(scored) : "no sheets"}${failed ? ` · ${failed} sheet(s) failed, not scored` : ""}`);
  if (scored.length && new Set(scored).size === 1) sheetAgree++;

  if (fixedSheet) {
    const replans: string[] = [];
    for (let i = 0; i < RUNS; i++) replans.push((await plan(fixedSheet, topic))[0]);
    console.log(`  replans: ${agreement(replans)}`);
    if (new Set(replans).size === 1) replanAgree++;
  }
}

console.log(`\nFully consistent topics — across sheets and writers: ${sheetAgree}/${TOPICS.length}; replanning one sheet: ${replanAgree}/${TOPICS.length}`);
