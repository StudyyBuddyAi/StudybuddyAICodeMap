/**
 * Extract interactive regions from an anatomical SVG, automatically.
 *
 * Published illustrations put their labels in the margin and run a leader line
 * to the structure. So the label tells us *what*, and the far end of its leader
 * tells us *where*. Both are geometry, so this runs at ingest for any file with
 * no per-image work — which is the only thing that scales past a handful.
 *
 * Nothing here trusts the file's ids: in real exports they are authoring-tool
 * noise ("path4231", "XMLID_8_"), never anatomy.
 */

const NUM = "-?\\d*\\.?\\d+(?:e[-+]?\\d+)?";

/* ── transforms ─────────────────────────────────────────────────────────── */

const IDENTITY = [1, 0, 0, 1, 0, 0];

export function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function parseTransform(value) {
  let m = IDENTITY;
  const re = /(\w+)\s*\(([^)]*)\)/g;
  let hit;
  while ((hit = re.exec(value || ""))) {
    const v = hit[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const name = hit[1];
    let n = null;
    if (name === "matrix" && v.length === 6) n = v;
    else if (name === "translate") n = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
    else if (name === "scale") n = [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0];
    else if (name === "rotate" && v.length) {
      const a = (v[0] * Math.PI) / 180;
      const c = Math.cos(a), s = Math.sin(a);
      n = [c, s, -s, c, 0, 0];
      if (v.length === 3) {
        n = multiply([1, 0, 0, 1, v[1], v[2]], multiply(n, [1, 0, 0, 1, -v[1], -v[2]]));
      }
    }
    if (n) m = multiply(m, n);
  }
  return m;
}

const applyMatrix = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/* ── path geometry ──────────────────────────────────────────────────────── */

/**
 * End points of every segment in a `d` attribute, with relative commands
 * accumulated. Control points are skipped: for anchoring we need where the
 * stroke goes, not the exact curve.
 */
export function pathPoints(d) {
  const tokens = String(d || "").match(new RegExp(`[MmLlHhVvCcSsQqTtAaZz]|${NUM}`, "g")) || [];
  const arity = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7 };
  const points = [];
  let cmd = null, x = 0, y = 0, i = 0;

  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) { cmd = tokens[i++]; continue; }
    if (!cmd) { i++; continue; }
    const upper = cmd.toUpperCase();
    const need = arity[upper] ?? 0;
    if (!need) { i++; continue; }

    const args = [];
    while (args.length < need && i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
      args.push(Number(tokens[i++]));
    }
    if (args.length < need) break;

    const rel = cmd === cmd.toLowerCase();
    if (upper === "H") x = rel ? x + args[0] : args[0];
    else if (upper === "V") y = rel ? y + args[0] : args[0];
    else if (upper === "A") { x = rel ? x + args[5] : args[5]; y = rel ? y + args[6] : args[6]; }
    else {
      const ex = args[args.length - 2], ey = args[args.length - 1];
      x = rel ? x + ex : ex;
      y = rel ? y + ey : ey;
    }
    // After an implicit-repeat moveto the command becomes lineto, per SVG spec.
    if (upper === "M") cmd = rel ? "l" : "L";
    points.push([x, y]);
  }
  return points;
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export { applyMatrix };

/* ── region extraction ──────────────────────────────────────────────────── */

const SVG_NS = "http://www.w3.org/2000/svg";

function composedMatrix(el) {
  const chain = [];
  for (let n = el; n && n.getAttribute; n = n.parentElement) chain.push(n.getAttribute("transform"));
  let m = IDENTITY;
  for (let i = chain.length - 1; i >= 0; i--) if (chain[i]) m = multiply(m, parseTransform(chain[i]));
  return m;
}

/** Endpoints of a line-like element, already in the drawing's coordinate space. */
function leaderEnds(el) {
  const tag = el.localName;
  let pts;
  if (tag === "line") {
    pts = [
      [Number(el.getAttribute("x1")), Number(el.getAttribute("y1"))],
      [Number(el.getAttribute("x2")), Number(el.getAttribute("y2"))],
    ];
  } else if (tag === "polyline" || tag === "polygon") {
    const nums = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
    pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  } else if (tag === "path") {
    pts = pathPoints(el.getAttribute("d"));
  } else return null;

  if (!pts || pts.length < 2 || pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
    return null;
  }
  // Leaders are short polylines, not outlines. A filled shape or a long
  // many-segment path is the structure itself, not a pointer at one.
  if (pts.length > 8) return null;
  const fill = (el.getAttribute("fill") || "") + (el.getAttribute("style") || "");
  if (/fill\s*:\s*(?!none)[^;]+/.test(fill) && !/fill\s*:\s*none/.test(fill)) return null;

  const m = composedMatrix(el);
  const abs = pts.map(([x, y]) => applyMatrix(m, x, y));
  return [abs[0], abs[abs.length - 1]];
}

/** A legend entry ("A. = artery"), not a structure on the drawing. */
const isLegend = (text) => /=/.test(text);

/**
 * Words that are never a structure on their own — they are always the other
 * half of a two-line label. Kept deliberately short: anything ambiguous is
 * better left in than silently dropped.
 */
const FRAGMENT = new Set([
  "small", "large", "glands", "gland", "duct", "ducts", "sacs", "sac", "lining",
  "connective", "tissue", "rings", "cavity", "intestine", "colon", "salivary",
  "mucous", "mucosal", "alveolar", "bed", "beds",
]);

/**
 * Rejoin labels the illustrator split across two text nodes.
 *
 * The giveaway is geometry: the halves sit at nearly the same x, one line
 * apart. The guard is the leader line — a genuine stack of separate labels
 * ("Superior" / "Middle" / "Inferior", each pointing at its own lobe) has a
 * leader on every line, so merging is only allowed when at most one of the two
 * has one.
 */
function mergeFragments(labels, leaders, diagonal) {
  const reach = diagonal * 0.06;

  /**
   * Index of the leader this label points along, or -1.
   *
   * Identity matters more than presence: two lines of one wrapped label share
   * a single leader, whereas a stack of separate structures has one each. An
   * earlier version asked only whether a leader was nearby, which refused to
   * merge whenever the two lines sat close enough to both be near the same one.
   */
  const leaderOf = (at) => {
    let best = -1;
    let bestDistance = reach;
    leaders.forEach(([a, b], i) => {
      const d = Math.min(distance(a, at), distance(b, at));
      if (d <= bestDistance) { bestDistance = d; best = i; }
    });
    return best;
  };

  const nearLeader = (at) => leaderOf(at) !== -1;

  const sameColumn = diagonal * 0.02;
  const oneLine = diagonal * 0.035;
  const used = new Set();
  const out = [];

  const sorted = [...labels].sort((p, q) => p.at[1] - q.at[1]);
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    let { text, at } = sorted[i];

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const other = sorted[j];
      const dx = Math.abs(other.at[0] - at[0]);
      const dy = other.at[1] - at[1];
      if (dy > oneLine) break;
      if (dx > sameColumn) continue;
      // Two *different* leaders means two structures stacked, not one label
      // wrapped: "Superior" / "Middle" / "Inferior" each point at their own lobe.
      const mine = leaderOf(at);
      const theirs = leaderOf(other.at);
      if (mine !== -1 && theirs !== -1 && mine !== theirs) continue;
      const pair = [text, other.text];
      if (!pair.some((t) => FRAGMENT.has(t.toLowerCase()))) continue;
      text = `${text} ${other.text}`;
      if (!nearLeader(at)) at = other.at;
      used.add(j);
      break;
    }
    out.push({ text, at });
  }

  return out.filter(
    (l) => !isLegend(l.text) && !FRAGMENT.has(l.text.toLowerCase())
  );
}

/**
 * Structure anchors for every English label in an SVG.
 *
 * Coordinates come back normalised to 0-1 of the viewBox, so they survive any
 * rendered size. `confidence` is "leader" when a pointer line was followed to
 * the structure, "label" when the label's own position is all we have — the
 * caller decides whether a low-confidence anchor is worth drawing.
 */
export function extractRegions(svgText, JSDOM) {
  const doc = new JSDOM(svgText, { contentType: "image/svg+xml" }).window.document;
  const svg = doc.documentElement;
  const vb = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || !vb[2] || !vb[3]) return [];
  const [minX, minY, width, height] = vb;
  const near = Math.hypot(width, height) * 0.06;

  const labels = [];
  for (const el of doc.getElementsByTagNameNS(SVG_NS, "text")) {
    const lang = el.getAttribute("systemLanguage");
    if (lang && !/(^|,)\s*en\b/i.test(lang)) continue;
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length < 2 || text.length > 60) continue;
    const x = Number(el.getAttribute("x"));
    const y = Number(el.getAttribute("y"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    labels.push({ text, at: applyMatrix(composedMatrix(el), x, y) });
  }

  const leaders = [];
  for (const tag of ["path", "line", "polyline"]) {
    for (const el of doc.getElementsByTagNameNS(SVG_NS, tag)) {
      const ends = leaderEnds(el);
      if (ends) leaders.push(ends);
    }
  }

  // ── clean up what the drawing actually encodes ────────────────────────────
  // Illustrators break a long label across two text nodes ("Small" / "intestine")
  // and put legends in the same <text> markup as structures. Both arrive here
  // looking like structures, so they are repaired geometrically before anything
  // downstream sees them.
  const merged = mergeFragments(labels, leaders, Math.hypot(width, height));

  const seen = new Set();
  const regions = [];
  for (const { text, at } of merged) {
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let best = null;
    for (const [a, b] of leaders) {
      const da = distance(a, at);
      const db = distance(b, at);
      const [close, far] = da <= db ? [da, b] : [db, a];
      if (close > near) continue;
      // The leader that starts closest to the label is the one pointing from it.
      if (!best || close < best.close) best = { close, far };
    }

    const anchor = best ? best.far : at;
    regions.push({
      label: text,
      x: (anchor[0] - minX) / width,
      y: (anchor[1] - minY) / height,
      labelX: (at[0] - minX) / width,
      labelY: (at[1] - minY) / height,
      confidence: best ? "leader" : "label",
    });
  }
  return regions;
}
