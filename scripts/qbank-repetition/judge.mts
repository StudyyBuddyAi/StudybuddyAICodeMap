// Concept-clustering judge. Input: a JSON file of groups
//   [{ id, topic, items: [{ uid, leadIn, keyText, teachingPoint }] }]
// Output: <out>/<id>.json = { concepts: [{ label, uids: [...] }] }
// Items are shuffled and given opaque ids, so the judge cannot see arm,
// session or order. Resumable per group.
import fs from "node:fs";
import path from "node:path";
import { cortiJson, readJson, writeJson, pool } from "./common.mts";

const [inFile, outDir, tag = ""] = process.argv.slice(2);
const groups: any[] = readJson(inFile);

function shuffle<T>(xs: T[], seed: number) {
  const a = [...xs];
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const PROMPT = (topic: string, rendered: string, n: number) => `Topic: ${topic}

Below are ${n} multiple-choice items from a medical question bank, each shown as its question, its correct answer and its teaching point. Group them by the concept each item tests.

Two items test the SAME concept when the fact, mechanism or decision their correct answer turns on is the same: a student who learned the explanation of one would answer the other with no new knowledge, even though the patient, the vignette, the exam style or the direction of the question differ. For example, "which enzyme does warfarin inhibit" and "warfarin's effect results from blocking which step of the vitamin K cycle" are one concept; "which ketone predominates in DKA" asked through a urine dipstick and asked directly are one concept.

Two items that share a subject but turn on different facts are DIFFERENT concepts: digoxin's mechanism, hypokalemia potentiating digoxin toxicity, and the antidote for digoxin toxicity are three concepts.

Every item belongs to exactly one concept; a concept may hold one item. Label each concept with the fact it tests, in at most 15 words.

Return {"concepts":[{"label":"...","items":["q07","q21"]}]} and nothing else.

${rendered}`;

const SYSTEM = "You audit a medical question bank for repetition. You group items by the specific concept each one tests, judging as an expert USMLE item writer would.";

await pool(groups, Number(process.env.CONCURRENCY ?? 4), async (g) => {
  const file = path.join(outDir, `${g.id}${tag}.json`);
  if (fs.existsSync(file)) return;
  const order = shuffle(g.items, (Number(process.env.SEED ?? 1) * 7919 + g.items.length) | 0);
  const alias = new Map<string, string>();
  const rendered = order
    .map((it: any, i: number) => {
      const qid = `q${String(i + 1).padStart(2, "0")}`;
      alias.set(qid, it.uid);
      return `${qid}. ${it.leadIn}\n    Correct answer: ${it.keyText}\n    Teaching point: ${String(it.teachingPoint ?? "").slice(0, 400)}`;
    })
    .join("\n\n");
  const t0 = Date.now();
  try {
    const out = await cortiJson(
      [{ role: "system", content: SYSTEM }, { role: "user", content: PROMPT(g.topic, rendered, order.length) }],
      { model: process.env.JUDGE_MODEL ?? "corti-s1", json: false, temperature: 0, maxTokens: 30000 }
    );
    const seen = new Set<string>();
    const concepts = (out.concepts ?? []).map((c: any) => ({
      label: c.label,
      uids: (c.items ?? []).map((q: string) => alias.get(q)).filter((u: string | undefined) => u && !seen.has(u) && seen.add(u)),
    }));
    const missing = g.items.map((it: any) => it.uid).filter((u: string) => !seen.has(u));
    for (const u of missing) concepts.push({ label: "(unassigned by judge)", uids: [u] });
    writeJson(file, { id: g.id, topic: g.topic, n: g.items.length, missing: missing.length, ms: Date.now() - t0, concepts });
    console.log(`${g.id}: ${g.items.length} items → ${concepts.length} concepts, ${missing.length} unassigned, ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (err) {
    console.log(`FAIL ${g.id}: ${err instanceof Error ? err.message : err}`);
  }
});
