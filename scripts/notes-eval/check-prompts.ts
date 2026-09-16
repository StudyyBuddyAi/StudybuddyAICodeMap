/**
 * Fails if _shared/medical-notes-prompts.ts has drifted from the original
 * prompt code — the inline prompts medical-notes/index.ts carried before they
 * moved into the shared module. The GPT-OSS tier and the Haiku fallback run
 * these prompts unchanged, and the provider comparison's "same prompts" arms
 * measured them, so any edit should be deliberate.
 *
 * The reference is medical-notes/index.ts at a git revision (default `main`,
 * override with PROMPT_REF). Each block is located by the marker lines it
 * starts and ends with, and must appear byte-identical in both.
 *
 *   node scripts/notes-eval/check-prompts.ts
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const ref = process.env.PROMPT_REF ?? "main";
const prod = execFileSync("git", ["show", `${ref}:supabase/functions/medical-notes/index.ts`], { cwd: ROOT, encoding: "utf8" })
  .replace(/\r\n/g, "\n");
const lifted = read("supabase/functions/_shared/medical-notes-prompts.ts");

const BLOCKS: [start: string, end: string][] = [
  ["function personaPreamble(", "Dense is fine — this reader wants substance, not scaffolding.`;\n}"],
  ["const groundingContextBlock = !groundingAttempted", "Verify before exam or clinical use.\";"],
  ["const gptOssExplainPrompt = `", "${sheetSchemaBlock}`;\n\n    const userContent"],
  ["const userContent = enhanceMode", ": notes;"],
  ["if (enhanceMode === \"expand\") {", "systemPrompt = isHaiku ? haikuSheetPrompt : gptOssSheetPrompt;\n    }"],
  // The memory condition is spelled differently (memoryTurns.length > 0 vs
  // input.hasMemory); the appended instruction itself is shared from memory.ts.
];

function slice(text: string, [start, end]: [string, string], name: string): string {
  const a = text.indexOf(start);
  const b = a === -1 ? -1 : text.indexOf(end, a);
  if (a === -1 || b === -1) throw new Error(`${name}: block "${start.slice(0, 40)}" not found`);
  return text.slice(a, b + end.length);
}

let failed = 0;
for (const block of BLOCKS) {
  const p = slice(prod, block, "medical-notes/index.ts");
  const l = slice(lifted, block, "medical-notes-prompts.ts");
  if (p === l) {
    console.log(`ok    ${block[0].slice(0, 50)} (${p.length} chars)`);
  } else {
    failed++;
    const i = [...p].findIndex((ch, k) => ch !== l[k]);
    console.log(`DRIFT ${block[0].slice(0, 50)} — first difference at char ${i}:\n  prod:   ${JSON.stringify(p.slice(i, i + 80))}\n  lifted: ${JSON.stringify(l.slice(i, i + 80))}`);
  }
}
if (failed) {
  console.error(`${failed} block(s) drifted — regenerate the lifted prompts before trusting an eval.`);
  process.exit(1);
}
