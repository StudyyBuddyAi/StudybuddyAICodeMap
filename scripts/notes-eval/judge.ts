/**
 * medical-notes provider comparison — blinded judging packets.
 *
 * For each (tier, case), writes one markdown packet with that tier's outputs
 * under shuffled letters, and a separate key. Sheets are rendered as readable
 * sections from the app's own parse, so the judge reads content; formatting
 * and contract compliance are already measured by score.ts.
 *
 * Judgments go in out/<run>/judge/judgments.json as
 *   { "<tier>__<caseId>": { "X": {accuracy, teaching, fit, notes}, ... } }
 * with 1–5 scores, and `reveal` joins them back to arms.
 *
 *   node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/judge.ts packets <run> [armIds]
 *   node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/judge.ts reveal <run>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSheetOutput } from "../../src/lib/parse-partial-sheet.ts";
import { loadRun } from "./score.ts";
import type { RunRecord } from "./run.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [mode, run, armFilter] = process.argv.slice(2);
if (!mode || !run) throw new Error("usage: judge.ts packets|reveal <run>[,<run>…] [armIds]");
// Several runs can share one packet set (e.g. original vs tuned prompts); the
// packets and key live under the last run named.
const runs = run.split(",");
// JUDGE_SET names a separate packet folder (judge-<set>), so several packet sets
// with different arms can live in one run. JUDGE_KINDS limits the modes
// (e.g. "sheet,cards"). Only sample 1 of each case is packeted.
const JUDGE_SET = process.env.JUDGE_SET;
const JUDGE_KINDS = process.env.JUDGE_KINDS?.split(",");
const DIR = path.join(HERE, "out", runs[runs.length - 1], JUDGE_SET ? `judge-${JUDGE_SET}` : "judge");

/** Deterministic shuffle so regenerating packets keeps the same letters. */
function seededShuffle<T>(xs: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 2246822507) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function render(r: RunRecord): string {
  if (!r.ok) return `_(request failed: ${r.error})_`;
  if (r.case.kind !== "sheet") return r.text.trim();
  const parsed = parseSheetOutput(r.text);
  if (!parsed) return "_(unparseable — raw output)_\n\n" + r.text.slice(0, 4000);
  const s = parsed.sheet;
  const list = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  return [
    `**${s.topicEmoji ?? ""} ${s.topic ?? ""}** _(parse: ${parsed.status})_`,
    `OVERVIEW\n${s.overview}`,
    `MEMORY HOOKS\n${list(s.memoryHooks)}`,
    `CLINICAL APPROACH\n${s.clinicalApproach}`,
    `KEY POINTS\n${list(s.keyPoints)}`,
    `EXAM TRAPS\n${list(s.examTraps)}`,
    `FLASHCARDS\n${s.flashcards.map((c) => `- [${c.tag}] ${c.question}\n  → ${c.answer}`).join("\n")}`,
    `REFERENCE NOTE: ${s.referenceNote}`,
    `COVERAGE: ${JSON.stringify(s.sourceCoverage ?? null)}`,
  ].join("\n\n");
}

if (mode === "packets") {
  const allow = armFilter ? armFilter.split(",") : null;
  const records = runs
    .flatMap(loadRun)
    .filter((r) => !allow || allow.includes(r.arm.id))
    .filter((r) => (r.sample ?? 1) === 1)
    .filter((r) => !JUDGE_KINDS || JUDGE_KINDS.includes(r.case.kind));
  fs.mkdirSync(DIR, { recursive: true });
  const groups = new Map<string, RunRecord[]>();
  for (const r of records) {
    const k = `${r.arm.tier}__${r.case.id}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const key: Record<string, Record<string, string>> = {};
  for (const [k, rs] of [...groups].sort()) {
    const shuffled = seededShuffle(rs.sort((a, b) => a.arm.id.localeCompare(b.arm.id)), k);
    key[k] = {};
    const c = shuffled[0].case;
    const input = c.kind === "sheet" || c.kind === "cards"
      ? `notes: ${c.body.notes}\npersona: ${c.body.persona ?? "-"} · exam: ${c.body.examMode} · difficulty: ${c.body.difficulty} · focus: ${c.body.focus} · length: ${c.body.length}${c.body.cardCount ? ` · cards: ${c.body.cardCount}` : ""}\nretrieved chunks: ${shuffled[0].retrievedChunks ?? "-"}`
      : c.kind === "explain" ? String(c.body.notes)
      : `topic: ${c.body.enhanceTopic} · section: ${c.body.sectionKey}\nitem: ${c.body.itemText}`;
    const body = shuffled.map((r, i) => {
      const letter = "XYZWVU"[i];
      key[k][letter] = r.arm.id;
      return `## ${letter}\n\n${render(r)}`;
    });
    fs.writeFileSync(path.join(DIR, `${k}.md`), `# ${k}  (${c.kind})\n\n\`\`\`\n${input}\n\`\`\`\n\n${body.join("\n\n---\n\n")}\n`);
  }
  fs.writeFileSync(path.join(DIR, "key.json"), JSON.stringify(key, null, 2));
  console.log(`${groups.size} packets → ${DIR} (key.json is the unblinding key — don't open it before judging)`);
}

if (mode === "reveal") {
  const key = JSON.parse(fs.readFileSync(path.join(DIR, "key.json"), "utf8"));
  const judgments = JSON.parse(fs.readFileSync(path.join(DIR, "judgments.json"), "utf8"));
  type Agg = { n: number; accuracy: number; teaching: number; fit: number; wins: number };
  const agg = new Map<string, Agg>();
  const perKind = new Map<string, Agg>();
  for (const [k, letters] of Object.entries(judgments) as [string, Record<string, { accuracy: number; teaching: number; fit: number }>][]) {
    const kind = k.split("__")[1].split("-")[0];
    const totals = Object.entries(letters).map(([l, j]) => [l, j.accuracy + j.teaching + j.fit] as const);
    const best = Math.max(...totals.map((t) => t[1]));
    for (const [letter, j] of Object.entries(letters)) {
      const arm = key[k][letter];
      for (const [map, id] of [[agg, arm], [perKind, `${arm} · ${kind}`]] as const) {
        const a = map.get(id) ?? { n: 0, accuracy: 0, teaching: 0, fit: 0, wins: 0 };
        a.n++; a.accuracy += j.accuracy; a.teaching += j.teaching; a.fit += j.fit;
        if (j.accuracy + j.teaching + j.fit === best) a.wins++;
        map.set(id, a);
      }
    }
  }
  const fmt = (m: Map<string, Agg>) => [...m].sort().map(([id, a]) =>
    `| ${id} | ${a.n} | ${(a.accuracy / a.n).toFixed(2)} | ${(a.teaching / a.n).toFixed(2)} | ${(a.fit / a.n).toFixed(2)} | ${((a.accuracy + a.teaching + a.fit) / a.n).toFixed(2)} | ${a.wins} |`).join("\n");
  const header = "| arm | n | accuracy | teaching | fit | total /15 | best-or-tied |\n|---|---|---|---|---|---|---|";
  const out = `${header}\n${fmt(agg)}\n\nBy mode:\n${header}\n${fmt(perKind)}`;
  fs.writeFileSync(path.join(DIR, "reveal.md"), out);
  console.log(out);
}
