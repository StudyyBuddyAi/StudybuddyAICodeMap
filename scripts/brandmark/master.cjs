// Geometry of the StudyBuddy mark, traced over the designer's PNG (image px space).
const T = 'teal', C = 'copper';
const r1 = (n) => Math.round(n * 10) / 10;
const smooth = (pts) => {
  // Catmull-Rom through pts, as cubic bezier commands (no leading M)
  let d = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [r1(p1[0] + (p2[0] - p0[0]) / 6), r1(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [r1(p2[0] - (p3[0] - p1[0]) / 6), r1(p2[1] - (p3[1] - p1[1]) / 6)];
    d += `C${c1} ${c2} ${p2} `;
  }
  return d;
};
const open = (pts) => `M${pts[0]} ` + smooth(pts);
// closed outline from runs of smooth points joined by straight lines
const outline = (...runs) => runs.map((r, i) => (i ? `L${r[0]} ` : `M${r[0]} `) + smooth(r)).join('') + 'Z';

const strands = [
  // teal tail ribbon (cut end at the copper crossing)
  { color: T, pts: [[[400,906],[352,910],[314,924],[250,960],[194,1024],[142,1092]], [[142,1092],[194,1056],[250,1008],[330,976],[404,970]]] },
  // teal loop -> axon
  { color: T, pts: [[[498,924],[578,912],[650,888],[706,840],[738,784],[746,720],[738,640],[712,575]], [[768,575],[794,640],[806,720],[798,800],[770,880],[722,936],[650,972],[506,984]]] },
  // copper strand (pointed tail, cut top end)
  { color: C, pts: [[[402,1136],[450,1088],[474,1024],[470,960],[446,912],[402,848],[390,768],[406,688],[450,632],[514,596],[594,580],[700,576]], [[702,636],[650,632],[578,640],[514,664],[474,704],[454,760],[450,816],[458,880],[474,920],[490,960],[494,1008],[474,1072],[426,1120],[402,1136]]] },
];
const rungs = [
  { a: [656,670], b: [720,732], color: C, w: 24 },
  { a: [588,682], b: [708,798], color: T, w: 26 },
  { a: [528,718], b: [672,854], color: 'tc', w: 26 },
  { a: [488,774], b: [612,886], color: 'tc', w: 26 },
  { a: [484,850], b: [544,906], color: C, w: 24 },
  { a: [256,1042], b: [324,1106], color: C, w: 24 },
  { a: [304,1014], b: [392,1098], color: T, w: 26 },
  { a: [356,998], b: [412,1050], color: C, w: 24 },
];
// soma: thick ring around the nucleus, teal->copper
const soma = {
  // organic cell body around the nucleus (hole), closed smooth outline
  body: [[700,422],[748,418],[792,432],[846,446],[900,470],[946,472],[980,478],[968,512],[934,546],[946,584],[984,620],[968,646],[912,650],[850,656],[792,654],[762,612],[742,560],[712,490],[700,422]],
  hole: { c: [822, 522], r: 47 },
};
// branches: centerlines with a width; `bulb` is the synaptic bouton at the end
const branches = [
  // teal
  { id: 't-trunk', color: T, w: 58, pts: [[714,428],[702,360],[690,290],[680,234]] },
  { id: 't-top', color: T, w: 28, pts: [[676,240],[692,190],[718,130],[745,75]], bulb: { c: [745,75], r: 33 } },
  { id: 't-topl', color: T, w: 26, pts: [[674,236],[650,196],[618,156],[582,125]], bulb: { c: [582,125], r: 31 } },
  { id: 't-limb', color: T, w: 52, pts: [[716,424],[690,396],[656,378],[616,370]] },
  { id: 't-up', color: T, w: 30, pts: [[652,372],[600,334],[530,284],[452,228]], bulb: { c: [452,228], r: 30 } },
  { id: 't-mid', color: T, w: 25, pts: [[604,368],[540,352],[476,346],[410,343]], bulb: { c: [410,343], r: 30 } },
  { id: 't-low', color: T, w: 30, pts: [[616,374],[548,378],[484,404],[435,448]], bulb: { c: [435,448], r: 30 } },
  // copper, upper cluster
  { id: 'c-trunk', color: C, w: 46, pts: [[848,452],[852,384],[856,330],[860,298]] },
  { id: 'c-top', color: C, w: 28, pts: [[860,304],[880,250],[896,180],[888,89]], bulb: { c: [888,89], r: 32 } },
  { id: 'c-twig', color: C, w: 22, pts: [[854,298],[828,256],[806,222],[782,189]], bulb: { c: [782,189], r: 25 } },
  { id: 'c-ne', color: C, w: 34, pts: [[868,330],[930,282],[1000,238],[1059,170]], bulb: { c: [1059,170], r: 30 } },
  // copper, right fan
  { id: 'c-hubu', color: C, w: 46, pts: [[910,482],[950,466],[990,460],[1010,460]] },
  { id: 'c-a', color: C, w: 28, pts: [[988,466],[1008,412],[1018,350],[1048,300],[1090,262],[1130,248]], bulb: { c: [1130,248], r: 31 } },
  { id: 'c-b', color: C, w: 40, pts: [[1000,462],[1045,460],[1085,462]] },
  { id: 'c-b1', color: C, w: 24, pts: [[1078,458],[1130,432],[1178,402],[1221,377]], bulb: { c: [1221,377], r: 32 } },
  { id: 'c-b2', color: C, w: 24, pts: [[1080,468],[1140,480],[1186,496],[1227,510]], bulb: { c: [1227,510], r: 30 } },
  { id: 'c-hubd', color: C, w: 50, pts: [[908,592],[950,620],[985,632],[1008,640]] },
  { id: 'c-c', color: C, w: 34, pts: [[996,642],[1060,648],[1140,664],[1233,687]], bulb: { c: [1233,687], r: 35 } },
  { id: 'c-ct', color: C, w: 20, pts: [[1052,632],[1078,602],[1100,580],[1123,560]], bulb: { c: [1123,560], r: 21 } },
  { id: 'c-d', color: C, w: 28, pts: [[986,648],[1006,690],[1013,740],[1018,800],[1027,863]], bulb: { c: [1027,863], r: 23 } },
  { id: 'c-dt', color: C, w: 20, pts: [[1016,744],[1060,770],[1104,792],[1147,807]], bulb: { c: [1147,807], r: 23 } },
];
module.exports = { strands, rungs, soma, branches, open, outline, smooth };
