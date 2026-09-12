/**
 * QBank on-demand generation - measurement harness.
 *
 * Reproduces supabase/functions/qbank-generate/index.ts end to end against the
 * real Corti gateway, using the SAME shared modules the edge function uses:
 * the router prompt, buildBatchPlan, buildUserMessage, the v13.1-api system
 * prompt, the streaming relay, prepareBatch (parse, permute onto the planned
 * letters, gate) and verifyBatch (the cold-answering pass).
 *
 * What it deliberately does NOT do is write rows: the INSERT inside
 * persistBatch is the only step replaced, so nothing lands in the questions
 * table. Everything else is the production path.
 *
 * It also keeps the browser's parsePartialQuestions running over the stream, so
 * the reveal timings measured here are the moments the progress console's
 * per-question ticks would have lit up.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT_DIR = process.env.QBANK_EVAL_OUT ?? path.join(HERE, "out");

// -- env + Deno shim --------------------------------------------------------
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => process.env[k] } };

const {
  QBANK_SYSTEM_PROMPTS, SYSTEM_ROUTER_PROMPT, SYSTEM_KEYS,
  buildBatchPlan, buildUserMessage, asExamMode,
} = await import(path.join(ROOT, "supabase/functions/_shared/qbank-prompt.ts"));
const { parseBatchContent, prepareBatch } =
  await import(path.join(ROOT, "supabase/functions/_shared/qbank-persist.ts"));
const { verifyBatch } = await import(path.join(ROOT, "supabase/functions/_shared/qbank-verify.ts"));
const { cortiConfigFromEnv, cortiChatCompletion, cortiComplete } =
  await import(path.join(ROOT, "supabase/functions/_shared/corti.ts"));
const { parsePartialQuestions } =
  await import(path.join(ROOT, "src/lib/parse-partial-questions.ts"));

// -- the run ----------------------------------------------------------------
const COUNT = Number(process.env.QBANK_EVAL_COUNT ?? 5);

/**
 * EXAM_MODE=step1|step2ck|mixed selects the system prompt and briefs, exactly
 * as the edge function does from the request body. Defaults to step1, so a run
 * with no knob set is the same run it always was. Two readings to take from a
 * step2ck run against a step1 run: that the Step 2 items are genuinely
 * management/diagnostic, AND that Step 1's block rate, reasoning-order mix and
 * verifier agreement have not moved.
 */
const EXAM_MODE = asExamMode(process.env.EXAM_MODE);

/** Ten topics: ten different systems, three phrasing styles. */
const DEFAULT_TOPICS: { topic: string; expectSystem: string; note: string }[] = [
  { topic: "preload, afterload and the pressure-volume loop in heart failure", expectSystem: "cardiovascular", note: "textbook physiology phrasing" },
  { topic: "acid-base compensation in the renal tubule", expectSystem: "renal", note: "textbook physiology phrasing" },
  { topic: "thyroid hormone synthesis and the Wolff-Chaikoff effect", expectSystem: "endocrine", note: "named-effect phrasing" },
  { topic: "why do I keep mixing up the demyelinating diseases", expectSystem: "neuro", note: "student vernacular, no keyword" },
  { topic: "iron metabolism and microcytic anemia", expectSystem: "heme_onc", note: "textbook phrasing" },
  { topic: "surfactant and neonatal respiratory distress syndrome", expectSystem: "respiratory|peds_dev", note: "cross-system, router ambiguity" },
  { topic: "brachial plexus injuries", expectSystem: "msk_derm|neuro", note: "anatomy, router ambiguity" },
  { topic: "H pylori peptic ulcer disease", expectSystem: "gastrointestinal|infectious_disease", note: "abbreviated, cross-system" },
  { topic: "the four hypersensitivity reactions", expectSystem: "immune", note: "list-shaped topic - duplication risk" },
  { topic: "beta lactam resistance mechanisms in gram negatives", expectSystem: "infectious_disease", note: "pharm/micro overlap" },
];

/**
 * QBANK_EVAL_TOPICS=path/to/topics.json swaps the topic list.
 *
 * The built-in ten are Step 1-shaped — mechanisms, pathways, named effects.
 * Run against EXAM_MODE=step2ck they measure whether the mode can redirect a
 * basic-science prompt to management, which is a real question but not the
 * same one as "does step2ck write good items on the topics a Step 2 student
 * actually searches for". That needs its own list; this is how it is supplied.
 *
 * Shape: the same { topic, expectSystem, note } triples, as a JSON array.
 */
const TOPICS: typeof DEFAULT_TOPICS = process.env.QBANK_EVAL_TOPICS
  ? JSON.parse(fs.readFileSync(process.env.QBANK_EVAL_TOPICS, "utf8"))
  : DEFAULT_TOPICS;

const OPTS = ["a", "b", "c", "d", "e"] as const;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
const sentences = (s: string) => (s.match(/[.!?](\s|$)/g) ?? []).length;
const bolds = (s: string) => (s.match(/\*\*[^*]+\*\*/g) ?? []).length;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

interface Reveal { index: number; ms: number }

async function routeTopic(config: unknown, topic: string) {
  const t0 = Date.now();
  try {
    const raw = await cortiComplete(config, {
      model: (config as { routerModel: string }).routerModel, temperature: 0, maxTokens: 200, json: true,
      messages: [
        { role: "system", content: SYSTEM_ROUTER_PROMPT },
        { role: "user", content: topic },
      ],
    });
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim());
    if (SYSTEM_KEYS.includes(parsed?.system)) {
      return { system: parsed.system, confidence: typeof parsed.confidence === "number" ? parsed.confidence : null, ms: Date.now() - t0, fellBack: false, error: null as string | null };
    }
    return { system: "cardiovascular", confidence: null, ms: Date.now() - t0, fellBack: true, error: `off-enum: ${JSON.stringify(parsed?.system)}` };
  } catch (err) {
    return { system: "cardiovascular", confidence: null, ms: Date.now() - t0, fellBack: true, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Streams the writer call, mirroring the edge function's TransformStream. */
async function generate(config: unknown, topic: string, plan: unknown) {
  const started = Date.now();
  const res: Response = await cortiChatCompletion(config, {
    stream: true, temperature: 0.7, maxTokens: 32768, json: true,
    messages: [
      { role: "system", content: QBANK_SYSTEM_PROMPTS[EXAM_MODE] },
      { role: "user", content: buildUserMessage({ topic, plan }) },
    ],
    signal: AbortSignal.timeout(420_000),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`upstream ${res.status}: ${body.slice(0, 300)}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let frames = 0;
  let contentDeltas = 0;
  let usage: unknown = null;
  let finishReason: string | null = null;
  let ttfbMs: number | null = null;
  let ttfcMs: number | null = null;
  const reveals: Reveal[] = [];
  let revealed = 0;
  let lastPartialAt = 0;

  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    if (ttfbMs === null) ttfbMs = Date.now() - started;
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const event of events) {
      const dataLine = event.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const data = dataLine.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      frames++;
      try {
        const parsed = JSON.parse(data);
        if (parsed?.usage) usage = parsed.usage;
        const choice = parsed?.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const d = choice?.delta?.content;
        const r = choice?.delta?.reasoning ?? choice?.delta?.reasoning_content;
        if (typeof r === "string") reasoning += r;
        if (typeof d === "string") {
          if (ttfcMs === null) ttfcMs = Date.now() - started;
          content += d;
          contentDeltas++;
        }
      } catch { /* unparseable frame - the production relay tolerates it too */ }
    }
    // Reveal timing: what the preview page would have shown, and when.
    if (Date.now() - lastPartialAt > 200) {
      lastPartialAt = Date.now();
      const partial = parsePartialQuestions(content);
      while (revealed < partial.length) {
        revealed++;
        reveals.push({ index: revealed, ms: Date.now() - started });
      }
    }
  }

  const partial = parsePartialQuestions(content);
  while (revealed < partial.length) { revealed++; reveals.push({ index: revealed, ms: Date.now() - started }); }

  return { content, reasoning, frames, contentDeltas, usage, finishReason, ttfbMs, ttfcMs, reveals, totalMs: Date.now() - started };
}

// -- main -------------------------------------------------------------------
fs.mkdirSync(path.join(OUT_DIR, "raw"), { recursive: true });
const config = cortiConfigFromEnv();
console.log(`[eval] model=${config.model} verifier=${config.verifierModel} router=${config.routerModel} region=${config.region} tenant=${config.tenant} examMode=${EXAM_MODE} count=${COUNT} topics=${TOPICS.length}`);

const runs: unknown[] = [];
const runStarted = Date.now();

/** QBANK_EVAL_ONLY="5,7" reruns just those 1-based topics; LIMIT truncates. */
const SELECTED = process.env.QBANK_EVAL_ONLY
  ? process.env.QBANK_EVAL_ONLY.split(",").map((n) => TOPICS[Number(n.trim()) - 1]).filter(Boolean)
  : TOPICS.slice(0, Number(process.env.QBANK_EVAL_LIMIT ?? TOPICS.length));

for (const [i, spec] of SELECTED.entries()) {
  const label = `${i + 1}/${TOPICS.length} ${slug(spec.topic)}`;
  console.log(`[eval] ${label} - routing`);
  const router = await routeTopic(config, spec.topic);
  const plan = buildBatchPlan(router.system, COUNT, Math.random, 1, "balanced", EXAM_MODE);
  console.log(`[eval] ${label} - routed=${router.system} (${router.confidence}) in ${router.ms}ms; generating`);

  let gen: Awaited<ReturnType<typeof generate>> | null = null;
  let genError: string | null = null;
  try {
    gen = await generate(config, spec.topic, plan);
  } catch (err) {
    genError = err instanceof Error ? err.message : String(err);
    console.log(`[eval] ${label} - FAILED: ${genError}`);
  }

  const record: Record<string, unknown> = {
    index: i + 1, topic: spec.topic, note: spec.note, expectSystem: spec.expectSystem,
    router, plan: plan.questions, genError,
  };

  if (gen) {
    fs.writeFileSync(path.join(OUT_DIR, "raw", `${i + 1}-${slug(spec.topic)}.txt`), gen.content, "utf8");

    // The production path: parse, permute onto the planned letters, gate.
    const rawParsed = parseBatchContent(gen.content);
    const prepared = prepareBatch(gen.content, plan);
    const drafts = prepared.questions;
    const qa = prepared.qa;

    console.log(`[eval] ${label} - ${gen.totalMs}ms, ${gen.content.length} chars, parsed ${drafts.length}/${COUNT}; verifying`);

    // The cold-answering pass as the edge function now runs it, plus the
    // harness's own probe fields for continuity with the pre-change run.
    const verifyStarted = Date.now();
    const verification = await verifyBatch(config, drafts);
    const verifyMs = Date.now() - verifyStarted;
    const cold = verification.map((v) => ({
      index: v.index,
      key: drafts.find((d) => d.index === v.index)?.correctOption ?? null,
      answer: v.answer ?? "",
      solvable: v.solvable,
      issue: v.issue,
      error: v.error,
      ms: verifyMs,
    }));

    record.stream = {
      ttfbMs: gen.ttfbMs, ttfcMs: gen.ttfcMs, totalMs: gen.totalMs,
      frames: gen.frames, contentDeltas: gen.contentDeltas,
      contentChars: gen.content.length, reasoningChars: gen.reasoning.length,
      finishReason: gen.finishReason, usage: gen.usage, reveals: gen.reveals,
    };
    record.parse = { serverPersisted: rawParsed.length, clientDrafts: drafts.length, requested: COUNT };
    record.qa = qa;
    record.cold = cold;
    record.verifyMs = verifyMs;
    // How far the permutation had to move each key, and therefore how much of
    // the flat letter distribution is now bought after the fact.
    record.permutation = drafts.map((d, n: number) => ({
      index: d.index,
      modelChose: rawParsed[n]?.correctOption ?? null,
      planned: plan.questions[n]?.answerLetter ?? null,
      moved: rawParsed[n]?.correctOption !== d.correctOption,
    }));
    record.questions = drafts.map((d, n: number) => ({
      index: d.index, domain: d.domain, subtopic: d.subtopic, competency: d.competency,
      // The plan's track beside the model's self-report: a mismatch is the
      // mode instruction not taking. Off-track lead-ins are the other tell —
      // count step1 items matching /next (best )?step|most appropriate/i.
      examTrack: d.examTrack, examTrackReported: d.examTrackReported,
      difficulty: d.difficulty, reasoningOrder: d.reasoningOrder,
      plannedOrder: plan.questions[n]?.reasoningOrder ?? null,
      correctOption: d.correctOption, plannedLetter: plan.questions[n]?.answerLetter ?? null,
      vignetteWords: words(d.vignette), vignetteSentences: sentences(d.vignette),
      leadInWords: words(d.leadIn),
      optionChars: Object.fromEntries(OPTS.map((k) => [k, d.options[k].length])),
      keyChars: d.options[d.correctOption].length,
      longestDistractorChars: Math.max(...OPTS.filter((k) => k !== d.correctOption).map((k) => d.options[k].length)),
      explanationWords: words(d.explanation), explanationBolds: bolds(d.explanation),
      distractorExplanationCount: Object.keys(d.distractorExplanations ?? {}).length,
      teachingPointWords: words(d.teachingPoint ?? ""),
      reasoningChainWords: words(d.reasoningChain ?? ""),
      selfCheckFalse: Object.entries(d.selfCheck ?? {}).filter(([, v]) => v === false).map(([k]) => k),
      reviewerFlag: d.reviewerFlag ?? "",
      suggestedImageNeeded: d.suggestedImage?.needed ?? null,
    }));
    record.drafts = drafts;
  }

  runs.push(record);
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify({ startedAt: new Date(runStarted).toISOString(), model: config.model, verifierModel: config.verifierModel, routerModel: config.routerModel, examMode: EXAM_MODE, count: COUNT, runs }, null, 2),
    "utf8"
  );
}

console.log(`[eval] done in ${Math.round((Date.now() - runStarted) / 1000)}s - ${path.join(OUT_DIR, "report.json")}`);
