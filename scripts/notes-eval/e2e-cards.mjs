// E2E step 3: generate a flashcard deck, then open study mode and ask for an
// explanation of a card. Selectors past the generate button are discovered
// from the page, so each stage screenshots before it acts.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = process.env.E2E_OUT;
const TOPIC = process.env.E2E_TOPIC ?? "Beta blockers pharmacology";
const GENERATING = "Generating…";

const browser = await chromium.launch();
// E2E_FRESH=1 starts a new anonymous visitor (fresh daily quota and premium hook).
fs.mkdirSync(OUT, { recursive: true });
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
      calls.push({ phase: "request", cardsOnly: !!b.cardsOnly, cardCount: b.cardCount ?? null, explainMode: !!b.explainMode, notes: String(b.notes).slice(0, 80) });
    } catch { /* ignore */ }
  }
});
page.on("response", (res) => {
  if (res.url().includes("/functions/v1/medical-notes")) {
    calls.push({ phase: "response", status: res.status(), model: res.headers()["x-model-used"] ?? null, premium: res.headers()["x-is-premium"] ?? null });
  }
});

await page.goto("http://localhost:8080/flashcards", { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/09-flashcards-page.png` });
await page.getByPlaceholder("Search or type a medical topic", { exact: false }).first().fill(TOPIC);
await page.getByRole("button", { name: /Generate Flashcards/i }).first().click();
const t0 = Date.now();
await page.waitForFunction((g) => document.body.innerText.includes(g), GENERATING, { timeout: 15000 }).catch(() => {});
await page.waitForFunction((g) => !document.body.innerText.includes(g), GENERATING, { timeout: 180000 });
await page.waitForTimeout(3000);
console.log("deck done in", Date.now() - t0, "ms");
await page.screenshot({ path: `${OUT}/10-deck.png` });
fs.writeFileSync(`${OUT}/deck-page-text.txt`, await page.locator("body").innerText());

const buttons = await page.getByRole("button").allInnerTexts();
console.log("buttons after deck:", JSON.stringify(buttons.map((b) => b.trim()).filter(Boolean).slice(0, 60)));

fs.writeFileSync(`${OUT}/calls-cards.json`, JSON.stringify(calls, null, 2));
console.log(JSON.stringify(calls, null, 2));
await context.storageState({ path: `${OUT}/state.json` });
await browser.close();
