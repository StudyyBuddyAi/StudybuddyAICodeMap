/**
 * What the premium writer actually builds, per topic kind.
 *
 * Sends one sheet per topic through the deployed function and reports the
 * structure that came back against the plan the server chose: which sections,
 * how many items each, whether the prose sections carry the labelled lines
 * their brief asked for. This is the check the archetype work needs — the unit
 * tests prove the plan resolves correctly, but only a live run shows whether
 * the writer fills a plan it has never seen before.
 *
 * Each case signs in as a brand-new anonymous user, because the premium hook
 * grants one premium generation per anon user: that routes every case to Corti
 * rather than only the first.
 *
 *   node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/corti-structure.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadDotEnv } from "./session.ts";
import { parseSheetOutput } from "../../src/lib/parse-partial-sheet.ts";
import { ARCHETYPES, ARCHETYPE_IDS, SECTIONS, listItems, type LengthSetting } from "../../supabase/functions/_shared/sheet-sections.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadDotEnv(ROOT);

const FN = process.env.PLAN_CHECK_FN ?? "medical-notes-next";
const URL_ = `${process.env.VITE_SUPABASE_URL}/functions/v1/${FN}`;

interface Case { notes: string; examMode: string; difficulty: string; length: LengthSetting }
const CASES: Case[] = [
  { notes: "Warfarin", examMode: "USMLE Step 1", difficulty: "Advanced", length: "Moderate" },
  { notes: "Staphylococcus aureus", examMode: "USMLE Step 1", difficulty: "Intermediate", length: "Concise" },
  { notes: "Glycolysis", examMode: "USMLE Step 1", difficulty: "Advanced", length: "Detailed" },
  { notes: "Diabetic ketoacidosis", examMode: "USMLE Step 2", difficulty: "Intermediate", length: "Moderate" },
  { notes: "Lumbar puncture", examMode: "USMLE Step 2", difficulty: "Basic", length: "Concise" },
  { notes: "sensitivity and specificity", examMode: "USMLE Step 1", difficulty: "Intermediate", length: "Concise" },
];

async function freshAnonToken(): Promise<string> {
  const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session) throw new Error(`anon sign-in failed: ${error?.message}`);
  return data.session.access_token;
}

/** Which archetype's spine the returned plan satisfies. */
function inferArchetype(planKeys: string[]): string {
  const hit = ARCHETYPE_IDS.find((id) => ARCHETYPES[id].spine.every((k) => planKeys.includes(k)));
  return hit ?? "(unrecognised)";
}

/** The labelled sub-headings a prose section's brief specified. */
const expectedLabels = (key: string): string[] =>
  [...(SECTIONS[key]?.brief ?? "").matchAll(/^([A-Z][A-Za-z ,/&-]{0,30}?):[ \t]+\S/gm)].map((m) => m[1]);

const sentences = (s: string) =>
  (s.replace(/\b(e\.g|i\.e|vs|approx|etc|Dr|mg|mEq)\./gi, "$1").replace(/(\d)\.(\d)/g, "$1$2").match(/[.!?](?=\s|$)/g) ?? []).length;

let violations = 0;

for (const c of CASES) {
  const token = await freshAnonToken();
  const started = Date.now();
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...c, useGrounding: false, useMemory: false }),
  });

  console.log(`\n${"=".repeat(78)}\n${c.notes}  ·  ${c.examMode} · ${c.difficulty} · ${c.length}`);
  if (!res.ok || !res.body) {
    console.log(`  REQUEST FAILED ${res.status} ${(await res.text()).slice(0, 300)}`);
    violations++;
    continue;
  }

  let plan: { key: string; title: string; kind: string }[] = [];
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

  const model = res.headers.get("x-model-used") ?? "?";
  const parsed = parseSheetOutput(text);
  console.log(`  model     ${model}${model.startsWith("corti/") ? "" : "   <-- NOT CORTI"}`);
  console.log(`  time      ${Date.now() - started}ms`);
  console.log(`  archetype ${inferArchetype(plan.map((s) => s.key))}`);
  console.log(`  parse     ${parsed?.status ?? "UNPARSEABLE"}`);
  if (!model.startsWith("corti/")) violations++;
  if (!parsed || parsed.status !== "ok") {
    // Dump enough of the raw response to see what the writer actually emitted.
    console.log(`  raw head  ${JSON.stringify(text.slice(0, 400))}`);
    console.log(`  raw tail  ${JSON.stringify(text.slice(-300))}`);
    console.log(`  length    ${text.length} chars`);
  }
  if (!parsed) { violations++; continue; }

  const s = parsed.sheet;
  const sections = s.sections ?? {};
  console.log(`  topic     ${s.topicEmoji ?? "?"} ${s.topic ?? "(none)"}`);
  console.log(`  sections:`);

  for (const spec of plan) {
    const body = sections[spec.key];
    const tmpl = SECTIONS[spec.key];
    if (body === undefined) { console.log(`    MISSING   ${spec.key}`); violations++; continue; }

    if (Array.isArray(body)) {
      const [lo, hi] = tmpl ? listItems(tmpl, c.length) : [0, 99];
      const ok = body.length >= lo && body.length <= hi;
      if (!ok) violations++;
      console.log(`    ${ok ? "ok " : "GATE"}      ${spec.title.padEnd(30)} ${String(body.length).padStart(2)} items (want ${lo === hi ? lo : `${lo}-${hi}`})`);
    } else {
      const want = expectedLabels(spec.key);
      const found = want.filter((l) => new RegExp(`(^|\n)\s*${l}\s*:`).test(body));
      const ok = found.length === want.length;
      if (!ok) violations++;
      const missing = want.filter((l) => !found.includes(l));
      console.log(`    ${ok ? "ok " : "STRU"}      ${spec.title.padEnd(30)} ${sentences(body)} sentences, labels ${found.length}/${want.length}${missing.length ? ` missing: ${missing.join("/")}` : ""}`);
    }
  }

  const extra = Object.keys(sections).filter((k) => !plan.some((p) => p.key === k));
  if (extra.length) { console.log(`    EXTRA     unplanned sections: ${extra.join(", ")}`); violations++; }
  console.log(`    --        flashcards ${s.flashcards.length}, coverage ${s.sourceCoverage?.level ?? "(none)"}`);
  const leak = /<Choose|Structure it as:|One item per element|<one emoji/.test(text);
  if (leak) { console.log(`    LEAK      template placeholder text in output`); violations++; }
}

console.log(`\n${"=".repeat(78)}\n${violations === 0 ? "No contract violations." : `${violations} contract violation(s).`}`);
