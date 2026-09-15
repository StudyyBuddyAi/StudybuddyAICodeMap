// E2E step 2: a second sheet (the anonymous user's single premium hook is spent,
// so this exercises the standard route), then the two enhance actions through
// the highlight-to-enhance bubble.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = process.env.E2E_OUT;
const TOPIC = process.env.E2E_TOPIC ?? "Iron deficiency anemia";
const GENERATING = "Generating…";

const browser = await chromium.launch();
// E2E_FRESH=1 starts a new anonymous visitor (fresh daily quota and premium hook).
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  ...(process.env.E2E_FRESH ? {} : { storageState: `${OUT}/state.json` }),
});
const page = await context.newPage();

const calls = [];
page.on("request", (req) => {
  if (req.url().includes("/functions/v1/medical-notes")) {
    try {
      const b = JSON.parse(req.postData() ?? "{}");
      calls.push({ phase: "request", enhanceMode: b.enhanceMode ?? null, cardsOnly: !!b.cardsOnly, explainMode: !!b.explainMode, notes: String(b.notes).slice(0, 60) });
    } catch { /* ignore */ }
  }
});
page.on("response", (res) => {
  if (res.url().includes("/functions/v1/")) {
    calls.push({ phase: "response", url: res.url().split("/functions/v1/")[1], status: res.status(), model: res.headers()["x-model-used"] ?? null, premium: res.headers()["x-is-premium"] ?? null });
  }
});

await page.goto("http://localhost:8080/sheets", { waitUntil: "networkidle" });
await page.getByPlaceholder("Search or type a medical topic", { exact: false }).first().fill(TOPIC);
await page.getByRole("button", { name: /Student/i }).first().click();
const t0 = Date.now();
await page.waitForFunction((g) => document.body.innerText.includes(g), GENERATING, { timeout: 15000 });
await page.waitForFunction((g) => !document.body.innerText.includes(g), GENERATING, { timeout: 180000 });
await page.waitForTimeout(2500);
console.log("sheet done in", Date.now() - t0, "ms");
await page.screenshot({ path: `${OUT}/06-sheet2-top.png` });

/** Drag-selects across a visible line of sheet text, then clicks a bubble action. */
async function enhance(label, anchorText, shot) {
  // The anchor is usually a bold label; its parent is the full line, and the
  // app ignores selections shorter than three words.
  const item = page.getByText(anchorText).first().locator("xpath=..");
  await item.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const box = await item.boundingBox();
  await page.mouse.move(box.x + 2, box.y + Math.min(box.height / 2, 10));
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(box.width - 4, 460), box.y + Math.min(box.height / 2, 10), { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${shot}-bubble.png` });
  await page.getByRole("button", { name: label }).first().click({ timeout: 8000 });
  const t = Date.now();
  await page.waitForTimeout(7000);
  console.log(`${label} result captured after`, Date.now() - t, "ms");
  await page.screenshot({ path: `${OUT}/${shot}-result.png` });
}

await enhance(/Expand/, /^Pathophysiology:/, "07-expand");
await page.mouse.click(1400, 90);
await page.waitForTimeout(500);
await enhance(/Clinical/, /^Diagnosis:/, "08-clinical");

fs.writeFileSync(`${OUT}/calls-enhance.json`, JSON.stringify(calls, null, 2));
console.log(JSON.stringify(calls, null, 2));
fs.writeFileSync(`${OUT}/sheet2-page-text.txt`, await page.locator("body").innerText());
await context.storageState({ path: `${OUT}/state.json` });
await browser.close();
