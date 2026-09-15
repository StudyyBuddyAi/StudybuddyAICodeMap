/**
 * Re-parses every stored card deck with the app's current flashcard parser and
 * reports cards found vs requested, and any echoed prompt legend left inside an
 * answer. A regression check for src/lib/parse-flashcards.ts against real model
 * output.
 *
 *   node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/deck-check.ts [run...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlashcardsFromOutput } from "../../src/lib/parse-flashcards.ts";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const runs = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(OUT).filter((d) => d.startsWith("phase"));

let short = 0;
for (const run of runs) {
  for (const f of fs.readdirSync(path.join(OUT, run)).filter((f) => f.includes("__cards-")).sort()) {
    const r = JSON.parse(fs.readFileSync(path.join(OUT, run, f), "utf8"));
    const want = Number(r.case.body.cardCount);
    const cards = parseFlashcardsFromOutput(r.text, String(r.case.body.notes));
    const bleed = cards.some((c) => /TAGS|SOURCING|HARD RULES|sourceCoverage/i.test(c.answer));
    if (cards.length < want) short++;
    console.log(`${run}/${f.replace(".json", "")}`.padEnd(48), `${cards.length}/${want}`, bleed ? "LEGEND IN ANSWER" : "");
  }
}
console.log(`\ndecks short of the requested count: ${short}`);
