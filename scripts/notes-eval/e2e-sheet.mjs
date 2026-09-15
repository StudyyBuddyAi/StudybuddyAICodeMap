// E2E step 1: generate a study sheet through the real UI and record what the
// browser sent to / received from the edge function.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = process.env.E2E_OUT;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const calls = [];
page.on("response", async (res) => {
  const url = res.url();
  if (url.includes("/functions/v1/")) {
    calls.push({ url, status: res.status(), model: res.headers()["x-model-used"] ?? null, premium: res.headers()["x-is-premium"] ?? null, chunks: res.headers()["x-retrieved-chunks"] ?? null });
  }
});
page.on("console", (m) => { if (m.type() === "error") console.log("[console error]", m.text().slice(0, 200)); });

await page.goto("http://localhost:8080/sheets", { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/01-sheets-page.png` });

const input = page.getByPlaceholder("Search or type a medical topic", { exact: false }).first();
await input.fill("Diabetic ketoacidosis");
await page.screenshot({ path: `${OUT}/02-topic-entered.png` });

// Generation is triggered by clicking a persona card.
const persona = page.getByRole("button", { name: /Clinician/i }).first();
await persona.click();
const started = Date.now();

// Wait until the generating label clears.
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/03-streaming.png` });
await page.waitForFunction(() => !document.body.innerText.includes("Generating…"), null, { timeout: 180000 });
await page.waitForTimeout(2500);
console.log("sheet done in", Date.now() - started, "ms");
await page.screenshot({ path: `${OUT}/04-sheet-top.png` });
await page.screenshot({ path: `${OUT}/05-sheet-full.png`, fullPage: true });

const text = await page.locator("body").innerText();
fs.writeFileSync(`${OUT}/sheet-page-text.txt`, text);
fs.writeFileSync(`${OUT}/calls.json`, JSON.stringify(calls, null, 2));
console.log(JSON.stringify(calls, null, 2));
await context.storageState({ path: `${OUT}/state.json` });
await browser.close();
