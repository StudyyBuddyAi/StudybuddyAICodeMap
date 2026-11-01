// Repetition metrics from judge clusters.
//   node metrics.cjs live            -> live groups
//   node metrics.cjs exp <judgeDir>  -> experiment (pooled or per-arm judge)
const fs = require("fs");
const path = require("path");
const OUT = process.env.REPETITION_OUT ?? path.join(__dirname, "out");
const mode = process.argv[2];

/** sessions: [[{uid, ...}], ...] in order; conceptOf: uid -> concept index. */
function repeatStats(sessions, conceptOf, isCorrect = () => null) {
  const before = new Map(); // concept -> [{correct}]
  let later = 0, repeats = 0, repeatsAfterCorrect = 0, withinDup = 0, total = 0;
  const perSession = [];
  for (const [k, items] of sessions.entries()) {
    const here = new Set();
    let sRep = 0;
    for (const it of items) {
      total++;
      const c = conceptOf.get(it.uid);
      if (here.has(c)) withinDup++;
      here.add(c);
      if (k > 0) {
        later++;
        if (before.has(c)) {
          repeats++; sRep++;
          if (before.get(c).some((x) => x === true)) repeatsAfterCorrect++;
        }
      }
    }
    if (k > 0) perSession.push(items.length ? sRep / items.length : null);
    for (const it of items) {
      const c = conceptOf.get(it.uid);
      if (!before.has(c)) before.set(c, []);
      before.get(c).push(isCorrect(it));
    }
  }
  const distinct = new Set(sessions.flat().map((it) => conceptOf.get(it.uid))).size;
  return { total, later, repeats, repeatRate: later ? repeats / later : null, repeatsAfterCorrect, withinDup, distinct, perSession };
}

const pct = (x) => (x == null ? "  -  " : `${(100 * x).toFixed(0).padStart(3)}%`);

if (mode === "live") {
  const groups = JSON.parse(fs.readFileSync(path.join(OUT, "live-groups.json"), "utf8"));
  const dir = path.join(OUT, "judge-live");
  let T = { later: 0, repeats: 0, after: 0, total: 0, within: 0, distinct: 0 };
  const rows = [];
  for (const g of groups) {
    const f = path.join(dir, g.id + ".json");
    if (!fs.existsSync(f)) { console.log("missing", g.id); continue; }
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    const conceptOf = new Map();
    j.concepts.forEach((c, i) => c.uids.forEach((u) => conceptOf.set(u, i)));
    const gids = [...new Set(g.items.slice().sort((a, b) => a.sessAt.localeCompare(b.sessAt)).map((x) => x.gid))];
    const sessions = gids.map((gid) => g.items.filter((x) => x.gid === gid));
    const s = repeatStats(sessions, conceptOf, (it) => (it.attempts > 0 ? it.correct === true : null));
    rows.push({ g, s, sessions: sessions.length });
    T.later += s.later; T.repeats += s.repeats; T.after += s.repeatsAfterCorrect; T.total += s.total; T.within += s.withinDup; T.distinct += s.distinct;
  }
  rows.sort((a, b) => b.s.later - a.s.later);
  console.log("group".padEnd(52), "sess items later rep  rate  afterCorrect withinDup distinct  per-session");
  for (const { g, s, sessions } of rows)
    console.log(g.id.slice(5, 57).padEnd(52), String(sessions).padStart(4), String(s.total).padStart(5), String(s.later).padStart(5), String(s.repeats).padStart(3), pct(s.repeatRate), String(s.repeatsAfterCorrect).padStart(8), String(s.withinDup).padStart(9), String(s.distinct).padStart(8), "  ", s.perSession.map(pct).join(" "));
  console.log(`\nALL: ${T.repeats}/${T.later} later-session items repeat an earlier session's concept = ${pct(T.repeats / T.later)}; ` +
    `${T.after} of those repeat a concept the student had already answered correctly; ${T.within} within-session duplicates across ${T.total} items; ${T.distinct} distinct concepts in ${T.total} items.`);
  fs.writeFileSync(path.join(OUT, "metrics-live.json"), JSON.stringify(rows.map(({ g, s, sessions }) => ({ id: g.id, topic: g.topic, sessions, ...s })), null, 1));
}

if (mode === "exp") {
  const jdir = process.argv[3];
  const pooled = !jdir.includes("arm");
  const ARMS = ["A", "B1", "B2", "C", "D"];
  const topics = fs.readdirSync(path.join(OUT, "A"));
  const result = [];
  for (const topic of topics) {
    for (const arm of ARMS) {
      const sessions = [];
      for (let k = 1; k <= 4; k++) {
        const f = path.join(OUT, arm, topic, `s${k}.json`);
        if (!fs.existsSync(f)) continue;
        const rec = JSON.parse(fs.readFileSync(f, "utf8"));
        sessions.push(rec.items.map((x) => ({ ...x, uid: `${arm}|${topic}|s${k}|${x.index}` })));
      }
      const jf = path.join(OUT, jdir, (pooled ? topic : `${arm}-${topic}`) + ".json");
      if (!fs.existsSync(jf)) { console.log("missing judge", jf); continue; }
      const j = JSON.parse(fs.readFileSync(jf, "utf8"));
      const conceptOf = new Map();
      j.concepts.forEach((c, i) => c.uids.forEach((u) => conceptOf.set(u, i)));
      const played = sessions.map((s) => s.filter((x) => x.playable));
      const all = sessions.flat();
      const s = repeatStats(played, conceptOf);
      result.push({ topic, arm, sessions: sessions.length, generated: all.length, playable: played.flat().length,
        blocked: all.filter((x) => x.blocked).length, disputed: all.filter((x) => !x.agreed).length, ...s });
    }
  }
  console.log(`judge: ${jdir}`);
  console.log("topic".padEnd(24), "arm  gen play blk dis | later rep  rate  within distinct | per-session(s2 s3 s4)");
  for (const r of result)
    console.log(r.topic.padEnd(24), r.arm.padEnd(3), String(r.generated).padStart(4), String(r.playable).padStart(4), String(r.blocked).padStart(3), String(r.disputed).padStart(3), "|",
      String(r.later).padStart(5), String(r.repeats).padStart(3), pct(r.repeatRate), String(r.withinDup).padStart(6), String(r.distinct).padStart(8), " |", r.perSession.map(pct).join(" "));
  console.log("\nPer arm, all topics:");
  for (const arm of ARMS) {
    const rs = result.filter((r) => r.arm === arm);
    const sum = (k) => rs.reduce((a, r) => a + r[k], 0);
    console.log(arm.padEnd(3), `repeat ${sum("repeats")}/${sum("later")} = ${pct(sum("repeats") / sum("later"))}`,
      `| within-session dup ${sum("withinDup")}`, `| distinct ${sum("distinct")} of ${sum("playable")} playable`,
      `| playable ${sum("playable")}/${sum("generated")} = ${pct(sum("playable") / sum("generated"))} (blocked ${sum("blocked")}, disputed ${sum("disputed")})`);
  }
  fs.writeFileSync(path.join(OUT, `metrics-exp-${path.basename(jdir)}.json`), JSON.stringify(result, null, 1));
}
