// E2E step 4: in a study session on the saved deck, flip a card and ask for
// "Explain this card" (medical-notes explainMode).
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = process.env.E2E_OUT;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: `${OUT}/state.json` });
const page = await context.newPage();

const calls = [];
page.on("request", (req) => {
  if (req.url().includes("/functions/v1/medical-notes")) {
    try {
      const b = JSON.parse(req.postData() ?? "{}");
      calls.push({ phase: "request", explainMode: !!b.explainMode, notes: String(b.notes).slice(0, 120) });
    } catch { /* ignore */ }
  }
});
page.on("response", (res) => {
  if (res.url().includes("/functions/v1/medical-notes")) {
    calls.push({ phase: "response", status: res.status(), model: res.headers()["x-model-used"] ?? null });
  }
});

await page.goto("http://localhost:8080/flashcards", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/11-flashcards-return.png` });

// The page lands on the deck overview; "Review" starts the due-card session.
await page.getByRole("button", { name: /^Review$/i }).first().click();
await page.waitForTimeout(1500);

await page.getByRole("button", { name: /Show Answer/i }).first().click({ timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/12-answer.png` });

await page.getByRole("button", { name: /Explain this card/i }).first().click({ timeout: 15000 });
const t0 = Date.now();
await page.waitForFunction(() => document.body.innerText.includes("EXAM TIP") || document.body.innerText.includes("Exam tip"), null, { timeout: 90000 });
await page.waitForTimeout(2500);
console.log("explain done in", Date.now() - t0, "ms");
await page.screenshot({ path: `${OUT}/13-explain.png` });

fs.writeFileSync(`${OUT}/calls-explain.json`, JSON.stringify(calls, null, 2));
console.log(JSON.stringify(calls, null, 2));
await browser.close();
