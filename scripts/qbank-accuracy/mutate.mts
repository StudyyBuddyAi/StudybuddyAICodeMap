// Plants known faults in sound gold items: gold.json → mutants.json.
//   node scripts/qbank-accuracy/mutate.mts
// Every mutant is a fatal item by construction, so a check's catch rate on
// them is measured without a reviewer. Text edits are deterministic; the four
// faults that need medical writing are made by Corti once and kept in
// mutants.json, so later runs replay the same set at no cost.
import path from "node:path";
import { HERE, readJson, writeJson, unit, cached, pool, config, CORTI, CONCURRENCY, LETTERS, type GoldItem, type Mutant, type Letter } from "./common.mts";

const PER_TYPE = Number(process.env.PER_TYPE ?? 25);
const gold: GoldItem[] = readJson(path.join(HERE, "gold.json"));
const sound = gold.filter((g) => g.verdict === "ok");

/** Items for one fault type, in a stable order of their own. */
const pick = (type: string, ok: (g: GoldItem) => boolean = () => true) =>
  sound.filter(ok).sort((a, b) => unit(a.id + type) - unit(b.id + type)).slice(0, PER_TYPE);
/** A stable distractor (or any non-key letter) for an item and fault type. */
const otherLetter = (g: GoldItem, type: string): Letter => {
  const others = LETTERS.filter((l) => l !== g.correctOption);
  return others[Math.floor(unit(g.id + type + "letter") * others.length)];
};
const mutant = (g: GoldItem, type: string, change: string, edit: Partial<Mutant>): Mutant => {
  const { verdict: _v, fault: _f, note: _n, ...item } = g;
  return { ...item, ...edit, id: `${g.id.slice(0, 8)}:${type}`, parent: g.id, type, change };
};

const mutants: Mutant[] = [];

// ── Text edits ──────────────────────────────────────────────────────────────

// The commonest live fault: correctOption names the wrong letter while the
// explanation argues for the right one. Per-option explanations follow the
// wrong key, as a writer that mislabelled its key writes them.
for (const g of pick("mislabeled-key")) {
  const to = otherLetter(g, "mislabeled-key");
  const d = { ...g.distractorExplanations };
  d[g.correctOption] = d[to];
  delete d[to];
  mutants.push(mutant(g, "mislabeled-key", `key moved ${g.correctOption}→${to}`, { correctOption: to, distractorExplanations: d }));
}

const LAB_EDITS: { re: RegExp; to: (m: string, a: string, v: string, s: string) => string; what: string }[] = [
  { re: /(potassium (?:is |of )?)(\d+(?:\.\d+)?)( ?mEq\/L)/i, to: (_m, a, v, s) => `${a}${(Number(v) * 10).toFixed(0)}${s}`, what: "potassium ×10" },
  { re: /(sodium (?:is |of )?)(\d{3})( ?mEq\/L)/i, to: (_m, a, v, s) => `${a}${(Number(v) / 10).toFixed(1)}${s}`, what: "sodium ÷10" },
  { re: /(ha?emoglobin (?:is |of )?)(\d+(?:\.\d+)?)( ?g\/dL)/i, to: (_m, a, v, s) => `${a}${(Number(v) * 10).toFixed(0)}${s}`, what: "hemoglobin ×10" },
];
for (const g of pick("lab-implausible", (g) => LAB_EDITS.some((e) => e.re.test(g.vignette)))) {
  const e = LAB_EDITS.find((x) => x.re.test(g.vignette))!;
  mutants.push(mutant(g, "lab-implausible", e.what, { vignette: g.vignette.replace(e.re, e.to as any) }));
}
for (const g of pick("lab-unit", (g) => /\d\s?(?:mg\/dL|mEq\/L|mmol\/L)/.test(g.vignette))) {
  const vignette = g.vignette.replace(/(\d)(\s?)(mg\/dL|mEq\/L|mmol\/L)/, (_m, d, s, u) => `${d}${s}${u === "mg/dL" ? "mmol/dL" : u === "mEq/L" ? "mEq/dL" : "mmol/dL"}`);
  mutants.push(mutant(g, "lab-unit", "first concentration unit made per-decilitre molar", { vignette }));
}

for (const g of pick("duplicate-exact")) {
  const at = otherLetter(g, "duplicate-exact");
  mutants.push(mutant(g, "duplicate-exact", `option ${at} repeats the key`, { options: { ...g.options, [at]: g.options[g.correctOption] } }));
}

for (const g of pick("self-correction")) {
  const said = otherLetter(g, "self-correction");
  mutants.push(
    mutant(g, "self-correction", `explanation opens with a correction to ${said}`, {
      explanation: `Wait, the correct answer is ${said}. Let me fix that. ${g.explanation}`,
    })
  );
}

for (const g of pick("missing-explanation")) {
  const gone = otherLetter(g, "missing-explanation");
  const d = { ...g.distractorExplanations };
  delete d[gone];
  mutants.push(mutant(g, "missing-explanation", `no explanation for ${gone}`, { distractorExplanations: d }));
}

// ── Corti-written faults ────────────────────────────────────────────────────

const render = (g: GoldItem) =>
  `${g.vignette}\n\n${g.leadIn}\n\n${LETTERS.map((l) => `${l.toUpperCase()}. ${g.options[l]}`).join("\n")}\n\nCorrect answer: ${g.correctOption.toUpperCase()}`;

const SYSTEM = `You build test cases for a medical question bank's quality checks by planting one specific, realistic flaw in a USMLE-style item, exactly as instructed. The flaw must be real: an expert reading the changed item must agree it is broken in the way asked. Return only the JSON object requested.`;

type Llm = { type: string; ask: (g: GoldItem, l: Letter) => string; apply: (g: GoldItem, l: Letter, r: any) => Partial<Mutant> | null; change: (l: Letter) => string };
const LLM: Llm[] = [
  {
    type: "paraphrase-duplicate",
    ask: (g) => `Rewrite the correct answer (option ${g.correctOption.toUpperCase()}) in clearly different words that mean exactly the same thing, worded like the other options. Return {"text": string}.`,
    apply: (g, l, r) => {
      const text = String(r?.text ?? "").trim();
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      return text && norm(text) !== norm(g.options[g.correctOption]) ? { options: { ...g.options, [l]: text } } : null;
    },
    change: (l) => `option ${l} paraphrases the key`,
  },
  {
    type: "second-correct",
    ask: (g, l) => `Write a replacement for option ${l.toUpperCase()} that is ALSO a fully correct answer to the question as asked — as defensible as the keyed answer, not merely partly right — in the same style and length as the other options. Return {"text": string}.`,
    apply: (g, l, r) => (String(r?.text ?? "").trim() ? { options: { ...g.options, [l]: String(r.text).trim() } } : null),
    change: (l) => `option ${l} made a second correct answer`,
  },
  {
    type: "remove-finding",
    ask: () => `Rewrite the case (everything before the question line) removing the one or two findings that make the keyed answer the single best answer, so that a well-prepared student can no longer choose between the keyed answer and at least one other option. Change nothing else. Return {"vignette": string}.`,
    apply: (g, _l, r) => {
      const v = String(r?.vignette ?? "").trim();
      return v && v !== g.vignette.trim() && v.length > g.vignette.length * 0.5 ? { vignette: v } : null;
    },
    change: () => "deciding finding removed from the stem",
  },
  {
    type: "flipped-finding",
    ask: (_g, l) => `Change as few findings as possible in the case (everything before the question line) so that option ${l.toUpperCase()} becomes the single best answer instead of the keyed answer. Do not change the options or the question line. Return {"vignette": string}.`,
    apply: (g, _l, r) => {
      const v = String(r?.vignette ?? "").trim();
      return v && v !== g.vignette.trim() && v.length > g.vignette.length * 0.5 ? { vignette: v } : null;
    },
    change: (l) => `stem changed so ${l} is the best answer; key left in place`,
  },
];

const jobs = LLM.flatMap((spec) => pick(spec.type).map((g) => ({ spec, g, l: otherLetter(g, spec.type) })));
let dropped = 0;
const made = await pool(jobs, CONCURRENCY, async ({ spec, g, l }) => {
  const res = await cached("mutate", { type: spec.type, id: g.id, l }, async () => {
    try {
      const raw = await CORTI.cortiComplete(config, {
        temperature: 0.4,
        maxTokens: 2500,
        json: true,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `${render(g)}\n\n${spec.ask(g, l)}` },
        ],
        signal: AbortSignal.timeout(120_000),
      });
      const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
      return { result: JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)), error: null };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : String(err) };
    }
  });
  const edit = res.error ? null : spec.apply(g, l, res.result);
  if (!edit) {
    dropped++;
    return null;
  }
  return mutant(g, spec.type, spec.change(l), edit);
});
mutants.push(...made.filter((m): m is Mutant => !!m));

writeJson(path.join(HERE, "mutants.json"), mutants);
const byType: Record<string, number> = {};
for (const m of mutants) byType[m.type] = (byType[m.type] ?? 0) + 1;
console.log(`mutants.json: ${mutants.length} mutants (${dropped} Corti edits unusable)`, byType);
