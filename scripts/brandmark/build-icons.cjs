// Builds every static copy of the mark from the traced master:
//   public/favicon.svg, public/favicon.ico (16/32/48), public/apple-touch-icon.png,
//   public/email-mark.png (the auth emails' logo), public/og-preview.png (share card)
// Usage: node scripts/brandmark/build-icons.cjs   (needs Playwright's Chromium;
// the share card loads its fonts from Google Fonts)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { markSvg } = require('./mark-svg.cjs');

const PUBLIC = path.join(__dirname, '../../public');

/** An .ico holding PNGs (supported by every browser that still asks for one). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

async function render(page, svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img src="${dataUri(svg)}" width="${size}" height="${size}" style="display:block"></body></html>`,
  );
  await page.waitForTimeout(50);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** The link preview: the landing's paper, type and promise, with the mark mid-fire. */
function shareCard() {
  const big = markSvg('full', { glow: ['t-top', 't-up', 'c-top', 'c-a', 'c-c', 'c-d'], prefix: 'b' });
  const small = markSvg('compact', { prefix: 's' });
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Fraunces:ital,opsz,wght@0,9..144,500;1,9..144,500&family=IBM+Plex+Mono:wght@500&display=block" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; position: relative; background: #f7f4ee; color: #15283b; font-family: "DM Sans", sans-serif; }
  .glow { position: absolute; border-radius: 50%; }
  .copy { position: absolute; left: 84px; top: 70px; width: 640px; }
  .brand { display: flex; align-items: center; gap: 14px; font-weight: 700; font-size: 30px; letter-spacing: -0.03em; }
  .brand img { width: 58px; height: 58px; }
  .brand b { color: #0aafa9; }
  .eyebrow { display: inline-flex; margin-top: 44px; padding: 9px 15px; border: 1px solid #dedbd1; border-radius: 100px; background: rgba(238,234,225,.7); color: #68727b; font: 500 14px "IBM Plex Mono", monospace; letter-spacing: .055em; text-transform: uppercase; }
  h1 { margin-top: 26px; font: 500 86px/0.98 "Fraunces", Georgia, serif; letter-spacing: -0.055em; }
  h1 em { font-style: italic; color: #0aafa9; position: relative; z-index: 0; }
  h1 em::after { content: ""; position: absolute; height: 12px; left: 2px; right: 4px; bottom: 2px; z-index: -1; opacity: .2; background: #ec9f5a; transform: rotate(-2deg); }
  .lede { margin-top: 26px; max-width: 560px; color: #68727b; font-size: 23px; line-height: 1.5; }
  .mark { position: absolute; right: 64px; top: 92px; width: 452px; height: 452px; }
  .url { position: absolute; left: 84px; bottom: 44px; font: 500 15px "IBM Plex Mono", monospace; letter-spacing: .04em; color: #8a9299; }
</style></head><body>
  <div class="glow" style="right:40px;top:60px;width:520px;height:520px;background:radial-gradient(closest-side,rgba(10,175,169,.15),rgba(10,175,169,.05) 55%,rgba(10,175,169,0))"></div>
  <div class="glow" style="right:220px;bottom:-120px;width:360px;height:300px;background:radial-gradient(closest-side,rgba(236,159,90,.14),rgba(236,159,90,0))"></div>
  <div class="copy">
    <div class="brand"><img src="${dataUri(small)}" alt=""><span>StudyBuddy <b>AI</b></span></div>
    <div class="eyebrow">Built for medical students · MENA</div>
    <h1>Study smarter.<br>Score <em>higher.</em> Pass.</h1>
    <p class="lede">Study sheets, QBank and flashcards on any topic, built by an MD. Free to start.</p>
  </div>
  <img class="mark" src="${dataUri(big)}" alt="">
  <div class="url">studyybuddyai.com</div>
</body></html>`;
}

(async () => {
  const favicon = markSvg('tiny');
  fs.writeFileSync(path.join(PUBLIC, 'favicon.svg'), favicon);

  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const pngs = [];
  for (const size of [16, 32, 48]) pngs.push({ size, buf: await render(page, size >= 48 ? markSvg('compact') : favicon, size) });
  fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), ico(pngs));

  // iOS rounds the corners itself and fills transparency with black: give it paper.
  fs.writeFileSync(path.join(PUBLIC, 'apple-touch-icon.png'), await render(page, markSvg('full', { background: '#F7F4EC' }), 180));

  // Shown at 44px in the emails; drawn at 3x for sharp phones. Mail clients
  // don't render SVG, so it is a hosted PNG.
  fs.writeFileSync(path.join(PUBLIC, 'email-mark.png'), await render(page, markSvg('compact'), 132));

  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(shareCard(), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  fs.writeFileSync(path.join(PUBLIC, 'og-preview.png'), await page.screenshot({ type: 'png' }));
  await browser.close();

  console.log('wrote favicon.svg, favicon.ico (16/32/48), apple-touch-icon.png, email-mark.png, og-preview.png');
})();
