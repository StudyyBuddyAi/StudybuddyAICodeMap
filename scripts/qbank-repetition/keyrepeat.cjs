// Judge-free cross-check: a later-session item "repeats" when its answer key
// matches an earlier session's key (normalised; token Jaccard >= 0.6).
const fs = require("fs"), path = require("path");
const OUT = process.env.REPETITION_OUT ?? path.join(__dirname, "out");
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9+ ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["the","and","with","for","from","that","which","its","due"].includes(w));
const jac = (a, b) => { const A = new Set(a), B = new Set(b); const i = [...A].filter((x) => B.has(x)).length; return i / (A.size + B.size - i || 1); };
const rows = {};
for (const arm of ["A", "B1", "B2", "C", "D"]) {
  let later = 0, rep = 0;
  for (const topic of fs.readdirSync(path.join(OUT, "A"))) {
    const seen = [];
    for (let k = 1; k <= 4; k++) {
      const items = JSON.parse(fs.readFileSync(path.join(OUT, arm, topic, `s${k}.json`), "utf8")).items.filter((x) => x.playable);
      for (const x of items) if (k > 1) { later++; if (seen.some((s) => jac(norm(x.keyText), s) >= 0.6)) rep++; }
      for (const x of items) seen.push(norm(x.keyText));
    }
  }
  console.log(arm.padEnd(3), `key-text repeats ${rep}/${later} = ${(100 * rep / later).toFixed(0)}%`);
}
