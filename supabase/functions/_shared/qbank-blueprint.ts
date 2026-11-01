import { cortiComplete, type CortiConfig } from "./corti.ts";
import { SYSTEM_NAMES, isFamily, type SystemKey } from "./qbank-systems.ts";
import type { ExamTrack } from "./qbank-prompt.ts";
import type { BlueprintConcept } from "./qbank-repetition.ts";

/**
 * Topic blueprints: the distinct concepts an exam tests on one topic.
 *
 * A blueprint is what lets a set be assigned concepts rather than left to the
 * writer's sense of "the highest-yield facets", which is the same five facts
 * every time. Built once per topic and track, stored in qbank_topic_blueprints
 * and shared by every student, so its cost is paid once per topic.
 *
 * ── How it is built, and why this way ──────────────────────────────────────
 *
 * Measured before this was written (docs/qbank/repetition-study-2026-11.md):
 *
 *  - corti-s1, the reasoning model, writes the cleanest list but took 110-183s
 *    and once spent its entire 30k-token budget reasoning and returned nothing.
 *    A build runs in the background of a wave, inside the edge runtime's wall
 *    clock, so neither is acceptable. corti-s1-mini did the same at 6k tokens.
 *  - corti-s1-instant writes a usable list in 7-9s, but at temperature 0 it
 *    loops (the same concept three times, garbled lines) and even at 0.5 it
 *    restates a few concepts in other words — three ways of saying warfarin is
 *    teratogenic. A duplicate concept is the exact repetition this exists to
 *    remove, so those cannot be left in.
 *  - Asking it to clean its own list by REWRITING merged distinct facts into
 *    one long line. Asking it to judge medical CORRECTNESS dropped true core
 *    concepts ("SGLT2 inhibitors reduce mortality in HFrEF").
 *
 * So: a draft at 0.5, then an audit that may only point at duplicates and at
 * lines that are garbled or off-topic — never rewrite, never judge the
 * medicine — and code keeps the first line of each duplicate group. Then
 * validation, which fails the build rather than store a thin or broken list.
 * About fifteen seconds in all.
 */

export const BLUEPRINT_VERSION = "b1";

/** Fewer than this after the audit and the draft was not a usable list. */
export const MIN_CONCEPTS = 8;
const MAX_CONCEPTS = 40;
const MAX_WORDS = 25;

const DRAFT_TIMEOUT_MS = 60_000;
const AUDIT_TIMEOUT_MS = 45_000;

const EXAM_NAMES: Record<ExamTrack, string> = {
  step1: "USMLE Step 1",
  step2ck: "USMLE Step 2 CK",
};

const EXAM_SCOPE: Record<ExamTrack, string> = {
  step1:
    "Step 1 tests foundational science: mechanism, pathophysiology, pharmacology mechanism of action and adverse effects, biochemistry, histology, and pattern recognition tied to mechanism — not management protocols.",
  step2ck:
    "Step 2 CK tests clinical decisions: the diagnosis, the next best step, the study to order and how to read it, the drug or intervention for this patient, complications, and prevention.",
};

/** For the two families a "concept" means something other than a fact about an organ. */
const FAMILY_NOTE: Partial<Record<SystemKey, string>> = {
  social_sciences:
    "For communication and ethics, a concept is the principle or skill that decides what the physician should say or do in one kind of situation.",
  biostats_epi:
    "For biostatistics and epidemiology, a concept is one calculation, one interpretation, or one property of a study design.",
};

type Message = { role: "system" | "user"; content: string };

export function draftMessages(topic: string, system: SystemKey, track: ExamTrack): Message[] {
  const exam = EXAM_NAMES[track];
  const familyNote = isFamily(system) ? ` ${FAMILY_NOTE[system]}` : "";
  return [
    {
      role: "system",
      content: `You map a medical study topic onto the distinct concepts a ${exam} question bank tests on it. ${EXAM_SCOPE[track]}${familyNote}`,
    },
    {
      role: "user",
      content: `Topic: ${topic}
System: ${SYSTEM_NAMES[system]}
Exam: ${exam}

List the distinct testable concepts for this topic on this exam. A concept is ONE specific fact, mechanism, interpretation or decision that a single multiple-choice item's correct answer can turn on. Phrase each as the point tested, in at most 15 words, not as a heading and not as an explanation: "Hypokalemia potentiates digoxin toxicity at the Na/K-ATPase", not "Digoxin", and not a paragraph.

Rules:
- Two concepts must never be answerable from the same learning. If a student who learned one would answer an item on the other without new knowledge, they are one concept — merge them. Before you answer, check every pair: where one is a consequence, a restatement or the clinical face of another, merge them.
- Stay squarely within the topic and within the exam's scope.
- Order by yield, highest first, and tag each: "core" (on nearly every exam form), "standard", or "extended" (fair, less common).
- Give as many as the topic genuinely holds, up to 30 — usually 15 to 30. A narrow topic holds fewer; never pad with obscure detail.

Also name a broader topic that contains this one, for a student who has covered it ("Anticoagulants" for "Warfarin"), in at most 5 words.

Return {"broader":"...","concepts":[{"concept":"...","tier":"core"}]} and nothing else.`,
    },
  ];
}

export function auditMessages(topic: string, track: ExamTrack, concepts: string[]): Message[] {
  const exam = EXAM_NAMES[track];
  return [
    { role: "system", content: `You are an expert ${exam} item writer auditing a concept list for a question bank.` },
    {
      role: "user",
      content: `Topic: ${topic}
Exam: ${exam}

Each numbered line below is meant to be one distinct testable concept. Find the problems; do not rewrite anything.

- duplicates: groups of line numbers that a student would answer from the same learning — one is a restatement, a consequence or the clinical face of another. Two lines that share a subject but test different facts are NOT duplicates.
- unusable: line numbers that are garbled, join two unrelated facts, or are not about this topic. Do not judge whether a line is medically correct — that is checked elsewhere.

${concepts.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Return {"duplicates":[[n,n]],"unusable":[n]} and nothing else.`,
    },
  ];
}

/** The first JSON object in a reply, fences and chatter tolerated. */
function extractObject(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in reply");
  return JSON.parse(raw.slice(start, end + 1));
}

const TIERS = new Set(["core", "standard", "extended"]);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const normalised = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

export interface Draft {
  broader: string | null;
  concepts: { text: string; tier: BlueprintConcept["tier"] }[];
}

/**
 * Reads the draft, dropping lines that are not a concept: empty, a heading of
 * one or two words, or a paragraph. Exact duplicates go here; the audit is for
 * the ones in other words.
 */
export function parseDraft(raw: string): Draft {
  const obj = extractObject(raw) as { broader?: unknown; concepts?: unknown };
  if (!Array.isArray(obj.concepts)) throw new Error("draft has no concepts array");
  const seen = new Set<string>();
  const concepts: Draft["concepts"] = [];
  for (const c of obj.concepts as { concept?: unknown; tier?: unknown }[]) {
    const text = typeof c?.concept === "string" ? squash(c.concept) : "";
    const words = text.split(" ").filter(Boolean).length;
    if (words < 3 || words > MAX_WORDS || text.length > 220) continue;
    const key = normalised(text);
    if (seen.has(key)) continue;
    seen.add(key);
    const tier = typeof c.tier === "string" && TIERS.has(c.tier) ? (c.tier as BlueprintConcept["tier"]) : "standard";
    concepts.push({ text, tier });
  }
  const broader =
    typeof obj.broader === "string" && squash(obj.broader) && squash(obj.broader).length <= 60
      ? squash(obj.broader)
      : null;
  return { broader, concepts };
}

/**
 * Applies the audit: drops every line it called unusable and all but the
 * earliest line of each duplicate group. The earliest is the one the draft
 * ranked higher, so the kept wording is the higher-yield framing. Numbers that
 * name no line are ignored rather than trusted.
 */
export function applyAudit(concepts: Draft["concepts"], raw: string): Draft["concepts"] {
  const obj = extractObject(raw) as { duplicates?: unknown; unusable?: unknown };
  const valid = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= concepts.length;
  const drop = new Set<number>();
  if (Array.isArray(obj.unusable)) for (const n of obj.unusable) if (valid(n)) drop.add(n);
  if (Array.isArray(obj.duplicates)) {
    for (const group of obj.duplicates) {
      if (!Array.isArray(group)) continue;
      const members = [...new Set(group.filter(valid))].sort((a, b) => a - b);
      members.slice(1).forEach((n) => drop.add(n));
    }
  }
  // An audit that would empty most of the list is not an audit of this list.
  if (drop.size > concepts.length / 2) throw new Error(`audit dropped ${drop.size} of ${concepts.length}`);
  return concepts.filter((_, i) => !drop.has(i + 1));
}

/** Numbers the surviving concepts. Ids are positional and stable once stored. */
export function finalise(concepts: Draft["concepts"]): BlueprintConcept[] {
  if (concepts.length < MIN_CONCEPTS) throw new Error(`only ${concepts.length} concepts`);
  return concepts.slice(0, MAX_CONCEPTS).map((c, i) => ({ id: `c${i + 1}`, text: c.text, tier: c.tier }));
}

export interface BuiltBlueprint {
  concepts: BlueprintConcept[];
  broader: string | null;
  model: string;
}

/** Draft, audit, validate. Throws on any failure: a failed build is retried later, never stored half-made. */
export async function buildBlueprint(
  config: CortiConfig,
  input: { topic: string; system: SystemKey; track: ExamTrack }
): Promise<BuiltBlueprint> {
  const model = config.blueprintModel;
  const draftRaw = await cortiComplete(config, {
    model,
    temperature: 0.5,
    maxTokens: 4000,
    messages: draftMessages(input.topic, input.system, input.track),
    signal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
  });
  const draft = parseDraft(draftRaw);
  if (draft.concepts.length < MIN_CONCEPTS) throw new Error(`draft held ${draft.concepts.length} concepts`);

  const auditRaw = await cortiComplete(config, {
    model,
    temperature: 0,
    maxTokens: 1500,
    messages: auditMessages(input.topic, input.track, draft.concepts.map((c) => c.text)),
    signal: AbortSignal.timeout(AUDIT_TIMEOUT_MS),
  });
  return { concepts: finalise(applyAudit(draft.concepts, auditRaw)), broader: draft.broader, model };
}
