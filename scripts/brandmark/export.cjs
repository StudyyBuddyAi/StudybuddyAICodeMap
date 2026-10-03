// Exports the traced geometry as a normalized TS module (0..100 box) for the app.
// Usage: node scripts/brandmark/export.cjs   (rewrites src/components/brand/brandmark-geometry.ts)
const fs = require('fs');
const g = require('./master.cjs');

const X0 = 134, Y0 = 0, SIDE = 1160, S = 100 / SIDE;
const n = (v) => Math.round(v * S * 100) / 100;
const P = ([x, y]) => [n(x - X0), n(y - Y0)];
const Pn = (pts) => pts.map(P);
const smoothN = (pts) => {
  const q = Pn(pts); let d = '';
  for (let i = 0; i < q.length - 1; i++) {
    const p0 = q[i - 1] || q[i], p1 = q[i], p2 = q[i + 1], p3 = q[i + 2] || p2;
    const r = (v) => Math.round(v * 100) / 100;
    const c1 = [r(p1[0] + (p2[0] - p0[0]) / 6), r(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [r(p2[0] - (p3[0] - p1[0]) / 6), r(p2[1] - (p3[1] - p1[1]) / 6)];
    d += `C${c1} ${c2} ${p2}`;
  }
  return d;
};
const openN = (pts) => `M${P(pts[0])}` + smoothN(pts);
const outlineN = (...runs) => runs.map((r, i) => (i ? `L${P(r[0])}` : `M${P(r[0])}`) + smoothN(r)).join('') + 'Z';
const w = (v) => Math.round(v * S * 1000) / 1000;

const tone = (id) => (id.startsWith('t') ? 'teal' : id.startsWith('c-hub') ? 'soma' : 'copper');

const strands = g.strands.map((s) => ({ tone: s.color, d: outlineN(...s.pts) }));
const h = g.soma.hole;
const [hx, hy] = P(h.c), hr = n(h.r);
const somaD = `${outlineN(g.soma.body)}M${Math.round((hx - hr) * 100) / 100},${hy}a${hr},${hr} 0 1 0 ${Math.round(2 * hr * 100) / 100},0a${hr},${hr} 0 1 0 -${Math.round(2 * hr * 100) / 100},0Z`;
const rungs = g.rungs.map((r) => {
  const [x1, y1] = P(r.a), [x2, y2] = P(r.b);
  return { x1, y1, x2, y2, w: w(r.w), tone: r.color === 'tc' ? 'mix' : r.color };
});
const branches = g.branches.map((b) => ({
  id: b.id, tone: tone(b.id), d: openN(b.pts), w: w(b.w),
  ...(b.bulb ? { bulb: { cx: P(b.bulb.c)[0], cy: P(b.bulb.c)[1], r: n(b.bulb.r) } } : {}),
}));

// Signal routes for the firing animation: up both strands, then soma -> bulb.
const ascent = {
  teal: [[150,1086],[200,1036],[256,986],[330,950],[404,938],[452,942],[502,954],[614,942],[686,912],[738,860],[768,792],[776,720],[766,640],[742,575],[726,505],[716,446]],
  copper: [[406,1130],[462,1080],[484,1016],[480,960],[460,916],[430,864],[420,792],[430,724],[462,668],[514,630],[586,610],[660,604],[704,606]],
};
const routes = {
  't-top': [[724,476],[712,420],[702,360],[690,290],[680,236],[694,186],[718,130],[745,75]],
  't-topl': [[724,476],[712,420],[702,360],[690,290],[676,238],[650,196],[618,156],[582,125]],
  't-up': [[742,474],[716,424],[690,396],[652,372],[600,334],[530,284],[452,228]],
  't-mid': [[742,474],[716,424],[690,396],[640,374],[604,368],[540,352],[476,346],[410,343]],
  't-low': [[742,474],[716,424],[690,396],[640,376],[616,376],[548,378],[484,404],[435,448]],
  'c-top': [[850,476],[850,420],[853,370],[858,320],[876,262],[896,180],[888,89]],
  'c-twig': [[850,476],[850,420],[853,370],[856,300],[828,256],[806,222],[782,189]],
  'c-ne': [[850,476],[852,400],[868,330],[930,282],[1000,238],[1059,170]],
  'c-a': [[902,500],[950,470],[988,462],[1008,412],[1018,350],[1048,300],[1090,262],[1130,248]],
  'c-b1': [[902,500],[950,470],[1000,462],[1045,460],[1080,456],[1130,432],[1178,402],[1221,377]],
  'c-b2': [[902,500],[950,470],[1000,462],[1045,462],[1082,468],[1140,480],[1186,496],[1227,510]],
  'c-c': [[905,600],[950,622],[996,640],[1060,648],[1140,664],[1233,687]],
  'c-ct': [[905,600],[950,622],[1000,636],[1052,632],[1078,602],[1100,580],[1123,560]],
  'c-d': [[905,600],[950,624],[986,648],[1006,690],[1013,740],[1018,800],[1027,863]],
  'c-dt': [[905,600],[950,624],[986,648],[1006,690],[1016,744],[1060,770],[1104,792],[1147,807]],
};

const json = (v) => JSON.stringify(v, null, 2).replace(/"([a-z][a-zA-Z0-9]*)":/g, '$1:');
const ts = `/* Generated from the traced master (scripts/brandmark/). Edit the master, not this file. */

/**
 * The StudyBuddy mark: a DNA double helix whose teal strand rises into a
 * neuron. Everything lives in one 100x100 box so every variant lines up.
 *
 * Tones: teal and copper are the two strands; "soma" blends teal into copper
 * across the cell body; "mix" rungs blend along their own length.
 */
export type MarkTone = "teal" | "copper" | "soma" | "mix";

export interface MarkBranch {
  id: string;
  tone: MarkTone;
  /** Centerline, drawn as a round-capped stroke. */
  d: string;
  /** Base stroke width, before the variant's weight. */
  w: number;
  /** The synaptic bouton at the branch's tip. */
  bulb?: { cx: number; cy: number; r: number };
}

export const MARK_STRANDS: { tone: MarkTone; d: string }[] = ${json(strands)};

/** Cell body with the nucleus cut out (even-odd). */
export const MARK_SOMA = ${JSON.stringify(somaD)};
export const MARK_NUCLEUS = { cx: ${hx}, cy: ${hy}, r: ${hr} };

export const MARK_RUNGS: { x1: number; y1: number; x2: number; y2: number; w: number; tone: MarkTone }[] = ${json(rungs)};

export const MARK_BRANCHES: MarkBranch[] = ${json(branches)};

/** Where a signal travels: up each strand into the cell body. */
export const MARK_ASCENT = ${json({ teal: openN(ascent.teal), copper: openN(ascent.copper) })};

/** From the cell body out along each branch to its bulb, keyed by branch id. */
export const MARK_ROUTES: Record<string, string> = ${json(Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, openN(v)])))};

/** Horizontal span of the soma's teal-to-copper blend. */
export const MARK_SOMA_BLEND = { x1: ${n(770 - X0)}, x2: ${n(900 - X0)} };
`;
module.exports = { strands, somaD, rungs, branches, nucleus: { cx: hx, cy: hy, r: hr }, blend: { x1: n(770 - X0), x2: n(900 - X0) } };
if (require.main === module) {
  const out = process.argv[2] || require('path').join(__dirname, '../../src/components/brand/brandmark-geometry.ts');
  fs.writeFileSync(out, ts);
  console.log('wrote', out, ts.length, 'chars');
}
