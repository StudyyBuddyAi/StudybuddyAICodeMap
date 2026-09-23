/**
 * Smoke test for the section plan: sends one sheet request per topic kind and
 * prints the plan the server chose, plus the section keys the model actually
 * wrote back. Confirms the archetype classifier, the plan frame and the
 * generated prompt all agree on a live deployment.
 *
 *   node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/plan-check.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv, getEvalSession } from "./session.ts";
import { parseSheetOutput } from "../../src/lib/parse-partial-sheet.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadDotEnv(ROOT);

const FN = process.env.PLAN_CHECK_FN ?? "medical-notes-next";
const URL_ = `${process.env.VITE_SUPABASE_URL}/functions/v1/${FN}`;

const CASES: { label: string; body: Record<string, unknown> }[] = [
  { label: "Warfarin (expect drug)", body: { notes: "Warfarin", examMode: "USMLE Step 1", difficulty: "Advanced", length: "Concise" } },
  { label: "Staph aureus (expect organism)", body: { notes: "Staphylococcus aureus", examMode: "USMLE Step 1", difficulty: "Intermediate", length: "Concise" } },
  { label: "Heart failure (expect condition)", body: { notes: "Heart failure with reduced ejection fraction", examMode: "General", difficulty: "Intermediate", length: "Concise" } },
  { label: "Glycolysis (expect pathway)", body: { notes: "Glycolysis", examMode: "USMLE Step 1", difficulty: "Intermediate", length: "Concise" } },
  { label: "Sensitivity/specificity (expect concept)", body: { notes: "sensitivity and specificity", examMode: "USMLE Step 1", difficulty: "Intermediate", length: "Concise" } },
];

const { accessToken } = await getEvalSession();

for (const c of CASES) {
  const started = Date.now();
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ ...c.body, useGrounding: false, useMemory: false }),
  });

  if (!res.ok || !res.body) {
    console.log(`${c.label}\n  FAILED ${res.status} ${(await res.text()).slice(0, 200)}\n`);
    continue;
  }

  let plan: { key: string }[] | null = null;
  let text = "";
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split(/\n\n/);
    buffer = events.pop() ?? "";
    for (const ev of events) {
      const line = ev.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload);
        if (Array.isArray(parsed.__meta?.plan)) plan = parsed.__meta.plan;
        const t = parsed.choices?.[0]?.delta?.content;
        if (typeof t === "string") text += t;
      } catch { /* partial frame */ }
    }
  }

  const sheet = parseSheetOutput(text)?.sheet;
  const wrote = Object.keys(sheet?.sections ?? {});
  const planned = (plan ?? []).map((s) => s.key);
  const missing = planned.filter((k) => !wrote.includes(k));
  const extra = wrote.filter((k) => !planned.includes(k));

  console.log(c.label);
  console.log(`  model used  ${res.headers.get("x-model-used")}  (${Date.now() - started}ms)`);
  console.log(`  plan        ${planned.join(", ") || "(none sent!)"}`);
  console.log(`  wrote       ${wrote.join(", ") || "(nothing parsed)"}`);
  console.log(`  match       ${missing.length === 0 && extra.length === 0 ? "OK" : `missing=[${missing}] extra=[${extra}]`}\n`);
}
