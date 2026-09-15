/**
 * Exercises the premium → Haiku fallback on a deployed medical-notes handler.
 *
 * Sends one sheet request as the eval harness's user (who may simulate a Corti
 * outage) with `x-simulate-corti-outage: 1`, then reports the model headers,
 * whether the stream carried a sheet, and timing. The user's single anonymous
 * premium-hook generation must still be unused for the request to take the
 * premium route; after that it goes to GPT-OSS and the fallback is not reached.
 *
 *   node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/fallback-check.ts [function-name]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv, getEvalSession } from "./session.ts";
import { parseSheetOutput } from "../../src/lib/parse-partial-sheet.ts";

loadDotEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
const fn = process.argv[2] ?? "medical-notes-next";
const { accessToken } = await getEvalSession();

const started = Date.now();
const res = await fetch(`${process.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "x-simulate-corti-outage": "1" },
  body: JSON.stringify({ notes: "Hypercalcemia", persona: "student", examMode: "USMLE Step 1", length: "Concise", useGrounding: false, useMemory: false }),
});

console.log("status", res.status);
console.log("X-Model-Used", res.headers.get("x-model-used"));
console.log("X-Model-Fallback", res.headers.get("x-model-fallback"));
console.log("X-Is-Premium", res.headers.get("x-is-premium"));
if (!res.ok || !res.body) {
  console.log(await res.text());
  process.exit(1);
}

let text = "";
let ttfc: number | null = null;
const decoder = new TextDecoder();
let buffer = "";
for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
  buffer += decoder.decode(chunk, { stream: true });
  const events = buffer.split("\n\n");
  buffer = events.pop() ?? "";
  for (const ev of events) {
    const line = ev.split("\n").find((l) => l.startsWith("data: "));
    if (!line || line.includes("[DONE]")) continue;
    try {
      const t = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content;
      if (typeof t === "string") {
        if (ttfc === null) ttfc = Date.now() - started;
        text += t;
      }
    } catch { /* partial */ }
  }
}
const sheet = parseSheetOutput(text);
console.log("first text ms", ttfc, "total ms", Date.now() - started);
console.log("sheet parse", sheet?.status ?? "unparseable", "topic", sheet?.sheet.topic ?? "-");
