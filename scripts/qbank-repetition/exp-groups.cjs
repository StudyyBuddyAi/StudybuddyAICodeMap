// Judge inputs for the experiment: pooled per topic (one granularity across all
// arms) and per arm-topic (robustness check). Playable items only.
const fs = require("fs");
const path = require("path");
const OUT = process.env.REPETITION_OUT ?? path.join(__dirname, "out");
const ARMS = ["A", "B1", "B2", "C", "D"];
const topics = fs.readdirSync(path.join(OUT, "A"));
const pooled = [], perArm = [];
for (const topic of topics) {
  const pool = { id: topic, topic: topic.replace(/-/g, " "), items: [] };
  for (const arm of ARMS) {
    const g = { id: `${arm}-${topic}`, topic: topic.replace(/-/g, " "), items: [] };
    for (let k = 1; k <= 4; k++) {
      const f = path.join(OUT, arm, topic, `s${k}.json`);
      if (!fs.existsSync(f)) continue;
      for (const x of JSON.parse(fs.readFileSync(f, "utf8")).items) {
        if (!x.playable) continue;
        const it = { uid: `${arm}|${topic}|s${k}|${x.index}`, leadIn: x.leadIn, keyText: x.keyText, teachingPoint: x.teachingPoint };
        g.items.push(it); pool.items.push(it);
      }
    }
    perArm.push(g);
  }
  pooled.push(pool);
}
fs.writeFileSync(path.join(OUT, "exp-groups-pooled.json"), JSON.stringify(pooled, null, 1));
fs.writeFileSync(path.join(OUT, "exp-groups-arm.json"), JSON.stringify(perArm, null, 1));
console.log(pooled.map((p) => `${p.id}: ${p.items.length}`).join("\n"));
