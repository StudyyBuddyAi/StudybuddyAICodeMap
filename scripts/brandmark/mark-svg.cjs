// The mark as a standalone SVG string with fixed colours, for every place that
// can't run the React component: favicons, the email logo, the share card.
const data = require('./export.cjs');

// The same palette as src/components/brand/brandmark.css (light theme).
const COLORS = {
  tealHi: '#5fd6d8', tealMid: '#41c3cb', tealLo: '#22a9b9',
  copperHi: '#f3bb85', copperMid: '#e8a46e', copperLo: '#d98a52',
  haloTeal: '#34cdd6', haloCopper: '#f5a25a', spark: '#fffdf6',
};

// Weights per variant, mirroring BrandMark.tsx; "tiny" exists only for favicons.
const VARIANTS = {
  full: { weight: 1.18, bulb: 1.04, rung: 1.25, drop: [], dropRungs: [] },
  compact: { weight: 1.75, bulb: 1.32, rung: 1.7, drop: ['t-mid', 'c-twig', 'c-ct', 'c-dt', 'c-b1'], dropRungs: [0, 4, 5, 7] },
  tiny: { weight: 2.3, bulb: 1.55, rung: 2.1, drop: ['t-mid', 'c-twig', 'c-ct', 'c-dt', 'c-b1', 't-topl', 'c-ne'], dropRungs: [0, 2, 4, 5, 7] },
};

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * @param {keyof typeof VARIANTS} variantName
 * @param {{ background?: string, glow?: string[], prefix?: string }} [options]
 *   background: paper behind the mark, with padding (for app icons).
 *   glow: bulb ids drawn mid-fire, halo bloomed and nucleus lit (for stills).
 *   prefix: gradient id prefix, for inlining more than one mark in a page.
 */
function markSvg(variantName, { background, glow = [], prefix = 'm' } = {}) {
  const v = VARIANTS[variantName];
  const id = (s) => `${prefix}${s}`;
  const fill = (tone) => (tone === 'teal' ? `url(#${id('t')})` : tone === 'soma' ? `url(#${id('s')})` : `url(#${id('c')})`);
  let defs = `<linearGradient id="${id('t')}" gradientUnits="userSpaceOnUse" x1="0" y1="5" x2="0" y2="95"><stop offset="0" stop-color="${COLORS.tealHi}"/><stop offset="1" stop-color="${COLORS.tealLo}"/></linearGradient>`
    + `<linearGradient id="${id('c')}" gradientUnits="userSpaceOnUse" x1="0" y1="7" x2="0" y2="98"><stop offset="0" stop-color="${COLORS.copperHi}"/><stop offset="1" stop-color="${COLORS.copperLo}"/></linearGradient>`
    + `<linearGradient id="${id('s')}" gradientUnits="userSpaceOnUse" x1="${data.blend.x1}" y1="0" x2="${data.blend.x2}" y2="0"><stop offset="0" stop-color="${COLORS.tealMid}"/><stop offset="1" stop-color="${COLORS.copperMid}"/></linearGradient>`;
  let body = '';
  data.rungs.forEach((r, i) => {
    if (v.dropRungs.includes(i)) return;
    let stroke = fill(r.tone);
    if (r.tone === 'mix') {
      defs += `<linearGradient id="${id('r' + i)}" gradientUnits="userSpaceOnUse" x1="${r.x1}" y1="${r.y1}" x2="${r.x2}" y2="${r.y2}"><stop offset=".35" stop-color="${COLORS.tealMid}"/><stop offset=".65" stop-color="${COLORS.copperMid}"/></linearGradient>`;
      stroke = `url(#${id('r' + i)})`;
    }
    body += `<line x1="${r.x1}" y1="${r.y1}" x2="${r.x2}" y2="${r.y2}" stroke="${stroke}" stroke-width="${r2(r.w * v.rung)}"/>`;
  });
  for (const s of data.strands) body += `<path d="${s.d}" fill="${fill(s.tone)}" stroke="none"/>`;
  body += `<path d="${data.somaD}" fill="${fill('soma')}" fill-rule="evenodd" stroke="none"/>`;
  const branches = data.branches.filter((b) => !v.drop.includes(b.id));
  for (const b of branches) body += `<path d="${b.d}" stroke="${fill(b.tone)}" stroke-width="${r2(b.w * v.weight)}"/>`;

  // A still of a fire: halos behind the chosen bulbs, which swell a little.
  let halos = '';
  if (glow.length) {
    for (const [name, color] of [['ht', COLORS.haloTeal], ['hc', COLORS.haloCopper]]) {
      defs += `<radialGradient id="${id(name)}"><stop offset="0" stop-color="${color}" stop-opacity=".85"/><stop offset=".45" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
    }
    defs += `<radialGradient id="${id('k')}"><stop offset="0" stop-color="${COLORS.spark}"/><stop offset=".55" stop-color="${COLORS.spark}" stop-opacity=".55"/><stop offset="1" stop-color="${COLORS.spark}" stop-opacity="0"/></radialGradient>`;
    for (const b of branches) {
      if (!b.bulb || !glow.includes(b.id)) continue;
      halos += `<circle cx="${b.bulb.cx}" cy="${b.bulb.cy}" r="${r2(b.bulb.r * v.bulb * 2.5)}" fill="url(#${id(b.tone === 'teal' ? 'ht' : 'hc')})" opacity=".8"/>`;
    }
    const n = data.nucleus;
    halos += `<circle cx="${n.cx}" cy="${n.cy}" r="${r2(n.r * 1.15)}" fill="url(#${id('k')})"/>`;
  }
  for (const b of branches) {
    if (!b.bulb) continue;
    const swell = glow.includes(b.id) ? 1.14 : 1;
    body += `<circle cx="${b.bulb.cx}" cy="${b.bulb.cy}" r="${r2(b.bulb.r * v.bulb * swell)}" fill="${fill(b.tone)}" stroke="none"/>`;
  }

  const bg = background ? `<rect x="-14" y="-14" width="128" height="128" fill="${background}"/>` : '';
  const box = background ? '-14 -14 128 128' : '0 0 100 100';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}"><defs>${defs}</defs>${bg}<g fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</g>${halos}</svg>\n`;
}

module.exports = { markSvg, COLORS, VARIANTS };
