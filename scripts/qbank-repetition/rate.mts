// Blind relevance + yield rating per item. Input: exp-groups-arm.json.
// Output: out/rate/<id>.json = { ratings: { uid: { relevance, yield } } }
import fs from "node:fs";
import path from "node:path";
import { cortiJson, readJson, writeJson, pool } from "./common.mts";

const groups: any[] = readJson(process.argv[2]);
const outDir = process.argv[3];

await pool(groups, Number(process.env.CONCURRENCY ?? 3), async (g) => {
  const file = path.join(outDir, `${g.id}.json`);
  if (fs.existsSync(file)) return;
  const alias = new Map<string, string>();
  const rendered = g.items
    .map((it: any, i: number) => {
      const qid = `q${String(i + 1).padStart(2, "0")}`;
      alias.set(qid, it.uid);
      return `${qid}. ${it.leadIn}\n    Correct answer: ${it.keyText}\n    Teaching point: ${String(it.teachingPoint ?? "").slice(0, 300)}`;
    })
    .join("\n\n");
  try {
    const out = await cortiJson(
      [
        { role: "system", content: "You review USMLE-style items for a student who asked for questions on one topic." },
        {
          role: "user",
          content: `The student asked for questions on: ${g.topic}

Rate each item below on two scales.
relevance: "on" — squarely about the requested topic; "adjacent" — related material (the underlying physiology, a neighbouring disease or drug) that the student would not expect under this topic; "off" — not about the topic.
yield: "high" — commonly tested on the exam; "medium" — fair but less common; "low" — obscure or rarely tested.

Return {"ratings":[{"id":"q01","relevance":"on","yield":"high"}]} and nothing else.

${rendered}`,
        },
      ],
      { model: "corti-s1", json: false, temperature: 0, maxTokens: 20000 }
    );
    const ratings: Record<string, unknown> = {};
    for (const r of out.ratings ?? []) if (alias.has(r.id)) ratings[alias.get(r.id)!] = { relevance: r.relevance, yield: r.yield };
    writeJson(file, { id: g.id, ratings });
    console.log(`${g.id}: ${Object.keys(ratings).length}/${g.items.length} rated`);
  } catch (err) {
    console.log(`FAIL ${g.id}: ${err instanceof Error ? err.message : err}`);
  }
});
