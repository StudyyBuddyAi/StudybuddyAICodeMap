const fs = require("fs");
const [jf, gf, gid] = process.argv.slice(2);
const j = JSON.parse(fs.readFileSync(jf, "utf8"));
const groups = JSON.parse(fs.readFileSync(gf, "utf8"));
const g = groups.find((x) => x.id === (gid ?? j.id));
const byUid = new Map(g.items.map((x) => [x.uid, x]));
const sessOrder = g.items[0].gid ? [...new Set(g.items.slice().sort((a, b) => a.sessAt.localeCompare(b.sessAt)).map((x) => x.gid))] : null;
const sessOf = (it) => (sessOrder ? "S" + (sessOrder.indexOf(it.gid) + 1) : it.uid.split("|").slice(0, 3).join("/"));
for (const c of j.concepts.slice().sort((a, b) => b.uids.length - a.uids.length)) {
  const its = c.uids.map((u) => byUid.get(u));
  console.log(`[${c.uids.length}] ${c.label}`);
  if (c.uids.length > 1 || process.env.ALL) for (const it of its) console.log(`     ${sessOf(it).padEnd(10)} ${String(it.keyText).slice(0, 70)}${it.attempts ? (it.correct ? " ✓" : " ✗") : ""}`);
}
