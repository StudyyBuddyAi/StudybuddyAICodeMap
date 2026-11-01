const fs = require("fs");
// Input: the raw output of
//   npx --no-install supabase db query --linked -f scripts/qbank-repetition/live-repeat-items.sql > scripts/qbank-repetition/out/live-repeat-items.raw
const raw = fs.readFileSync(__dirname + "/out/live-repeat-items.raw", "utf8");
const rows = JSON.parse(raw.slice(raw.indexOf("{"))).rows;
fs.writeFileSync(__dirname + "/out/live-repeat-items.json", JSON.stringify(rows, null, 1));
const JUNK = [/xss/, /^u+$/, /<img/, /^ىيتتي$/];
const groups = {};
rows.forEach((r, i) => {
  if (JUNK.some((re) => re.test(r.t))) return;
  if (r.blocked || r.agreed === false) return; // never shown to the student
  const id = "live-" + r.author.slice(0, 8) + "-" + r.t.replace(/[^a-z0-9\u0600-\u06ff]+/gi, "-").slice(0, 40);
  (groups[id] ??= { id, topic: r.t, author: r.author, items: [] }).items.push({
    uid: "r" + i, gid: r.gid, sessAt: r.sess_at, leadIn: r.lead_in, keyText: r.key_text,
    teachingPoint: r.teaching_point, subtopic: r.subtopic, attempts: Number(r.author_attempts), correct: r.author_correct,
  });
});
const out = Object.values(groups).filter((g) => new Set(g.items.map((x) => x.gid)).size >= 2);
fs.writeFileSync(__dirname + "/out/live-groups.json", JSON.stringify(out, null, 1));
for (const g of out) console.log(g.id, g.items.length, "items", new Set(g.items.map((x) => x.gid)).size, "sessions");
