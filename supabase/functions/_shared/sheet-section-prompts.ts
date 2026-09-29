/**
 * Rewrites of one section of a sheet the student already has, in a direction
 * they pick (REGEN_STYLES), and the pieces a follow-up on a sheet shares with
 * its branches (sheet-branch-prompts.ts): the request's size limits, how a
 * section body is read, and the grounding block.
 *
 * Depth used to live here too — a passage written under every section of a
 * comprehensive sheet. Branches replaced it: a comprehensive sheet is now the
 * high-yield sheet with its most useful branches grown.
 *
 * The model sees the whole sheet as it stands, with every section's scope, so
 * a fact can go to its one home even in a section this call does not write.
 * Grounding is the sheet's own passages, re-read by id, so the rewrite rests
 * on what the sheet's badges vouch for.
 *
 * Kept free of Deno-only imports so the app's tests can check exactly what the
 * model is shown.
 */
import { MAX_SECTIONS, asExamMode, resolvePlanFromKeys, sectionQuota, type PlannedSection } from "./sheet-plan.ts";
import { ONE_HOME_PER_FACT, highYieldTest, schemaLine } from "./sheet-schema.ts";
import { SECTIONS } from "./sheet-sections.ts";
import { parseSignature, sentSections, type SheetSignature } from "./sheet-signature.ts";
import type { SheetSectionBody } from "./sheet-text.ts";

export type SectionAction = "regenerate";

/**
 * The direction a rewrite takes. There is no rewrite without one: asked only
 * to "regenerate", the writer handed back the section it had, near word for
 * word, and a request it was given in passing ("focus on potassium") barely
 * moved it. Each direction says what every line of the rewrite must now do.
 */
export type RegenStyle = "simpler" | "clinical" | "mechanism" | "exam" | "custom";

export const REGEN_STYLES: readonly RegenStyle[] = ["simpler", "clinical", "mechanism", "exam", "custom"];

const REGEN_TASK: Record<Exclude<RegenStyle, "custom">, string> = {
  simpler:
    "Make it simpler: plainer words, shorter lines, abbreviations spelled out, one idea per line. Keep every fact that matters; drop none of the numbers.",
  clinical:
    "Make it clinical: tie each fact to the patient in front of you — the presentation that brings it up and the decision it changes.",
  mechanism:
    "Make it mechanistic: give each fact the why behind it, in the same line, so it can be reasoned out rather than memorised.",
  exam:
    "Sharpen it for the exam: the thresholds, the discriminators between look-alikes, the next best steps and the classic traps this exam asks about.",
};

/**
 * The parts of a retrieved passage the prompt shows. rag.ts's RagChunk fits;
 * it is not imported, since rag.ts pulls a Deno-only dependency into the
 * app's type-check.
 */
export interface Passage {
  guidelineName: string;
  sectionTitle: string | null;
  content: string;
}

export type Body = string | string[] | string[][];

export interface SectionRequest {
  action: SectionAction;
  /** The section to rewrite. */
  key: string;
  /** The sheet's planned section keys, in reading order. */
  plan: string[];
  /** The sheet's bodies as they stand. */
  sections: Record<string, Body>;
  topic: string;
  /** The direction of the rewrite. */
  style: RegenStyle;
  /** custom only — what the student wants changed, in their words. */
  instruction?: string;
  /** The sheet's own retrieved passages, re-read server-side by id. */
  sourceIds: string[];
  /** Proof the sheet was written as premium, for a student without Pro. */
  grant?: string;
  /** The sheet's signatures, as the page kept them; null for a sheet saved before signing. */
  signature: SheetSignature | null;
  /** The sections exactly as sent, for checking against the signatures. */
  sent: Record<string, SheetSectionBody>;
}

/** Size limits: a sheet is a few kilobytes; these stop the endpoint carrying anything else. */
export const SECTION_LIMITS = {
  sheetChars: 24_000,
  line: 2_000,
  items: 20,
  topic: 120,
  instruction: 200,
  sources: 10,
} as const;

/** Output budget: one section is a few hundred tokens. */
export const SECTION_MAX_TOKENS = 2_000;

/**
 * Added to that budget for GPT-OSS, whose hidden reasoning counts against
 * max_tokens. Measured on these prompts it reasoned for 3,000–20,000
 * characters before writing a word, and on a Corti-sized budget half of its
 * calls ended at the limit with nothing written. Unused tokens cost nothing.
 */
export const REASONING_HEADROOM = 8_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const oneLine = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max);
  return s || undefined;
};

/** A body as it may arrive: prose, items, or rows. Anything else is dropped. */
export function asBody(v: unknown): Body | null {
  if (typeof v === "string") return v.slice(0, SECTION_LIMITS.line * 4);
  if (!Array.isArray(v)) return null;
  const items = v.slice(0, SECTION_LIMITS.items);
  if (items.length && items.every((x) => Array.isArray(x))) {
    return (items as unknown[][]).map((row) =>
      row.slice(0, 4).map((c) => (typeof c === "string" ? c.slice(0, SECTION_LIMITS.line) : ""))
    );
  }
  return items.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, SECTION_LIMITS.line));
}

/**
 * The request, validated; null when it names nothing runnable. The plan's keys
 * must all be catalogue sections, since each one's brief is resolved here and
 * never taken from the client.
 */
export function parseSectionRequest(raw: unknown): SectionRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.action !== "regenerate") return null;

  if (!Array.isArray(r.plan)) return null;
  const plan = [...new Set(r.plan.filter((k): k is string => typeof k === "string" && !!SECTIONS[k]))].slice(0, MAX_SECTIONS);
  if (!plan.length) return null;
  const key = typeof r.key === "string" ? r.key : "";
  if (!plan.includes(key)) return null;

  const rawSections = r.sections;
  if (!rawSections || typeof rawSections !== "object" || Array.isArray(rawSections)) return null;
  if (JSON.stringify(rawSections).length > SECTION_LIMITS.sheetChars) return null;
  const sections: Record<string, Body> = {};
  for (const k of plan) {
    const body = asBody((rawSections as Record<string, unknown>)[k]);
    if (body !== null) sections[k] = body;
  }

  const topic = oneLine(r.topic, SECTION_LIMITS.topic);
  if (!topic) return null;

  const style = REGEN_STYLES.includes(r.style as RegenStyle) ? (r.style as RegenStyle) : null;
  if (!style) return null;

  const req: SectionRequest = {
    action: "regenerate",
    key,
    plan,
    sections,
    topic,
    style,
    sourceIds: Array.isArray(r.sourceIds)
      ? r.sourceIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)).slice(0, SECTION_LIMITS.sources)
      : [],
    signature: parseSignature(r.signature),
    sent: sentSections(rawSections, plan),
  };
  if (style === "custom") {
    const instruction = oneLine(r.instruction, SECTION_LIMITS.instruction);
    if (!instruction) return null;
    req.instruction = instruction;
  }
  if (typeof r.grant === "string" && UUID_RE.test(r.grant)) req.grant = r.grant;
  return req;
}

/** One section as plain text: prose by line, a list by item, a table by row under its header. */
function bodyText(section: PlannedSection, body: Body | undefined): string {
  if (body === undefined) return "";
  if (typeof body === "string") return body.trim();
  if (!body.length) return "";
  if (Array.isArray(body[0])) {
    const header = section.columns?.length ? `${section.columns.join(" | ")}\n` : "";
    return header + (body as string[][]).map((row) => row.join(" | ")).join("\n");
  }
  return (body as string[]).map((item) => `- ${item}`).join("\n");
}

/**
 * The sheet as the student has it, section by section. What the model must
 * not say again. `mark` labels one section's heading — the one being
 * rewritten.
 */
export function sheetAsText(plan: PlannedSection[], sections: Record<string, Body>, mark?: { key: string; note: string }): string {
  return plan
    .map((s) => {
      const heading = `## ${s.title}${mark?.key === s.key ? ` (${mark.note})` : ""}`;
      return [heading, bodyText(s, sections[s.key]) || "(empty)"].join("\n");
    })
    .join("\n\n");
}

/** Every section and what belongs in it, so a fact can be sent to its one home. */
function scopeMap(plan: PlannedSection[]): string {
  return `THE SHEET'S SECTIONS — a fact belongs in the section whose scope it fits, and nowhere else:
${plan.map((s) => `- ${s.title}: ${s.scope}`).join("\n")}`;
}

/** The sheet's own passages, or word that there are none. */
export function groundingBlock(chunks: Passage[]): string {
  if (!chunks.length) {
    return "No verified guideline passages back this sheet. Write from general medical knowledge.";
  }
  return `Context from verified clinical guidelines — the passages this sheet was built on:
---
${chunks
  .map((c, i) => `[source ${i + 1}: ${c.guidelineName}${c.sectionTitle ? " — " + c.sectionTitle : ""}]\n${c.content}`)
  .join("\n\n")}
---
Use a passage for what it says about this topic; it outranks your own knowledge on any conflict. Add well-established general knowledge where it is silent, and never invent a guideline name, number or citation.`;
}

/** How one key's body is shaped, for the format block. */
function formatRule(section: PlannedSection): string {
  if (section.kind === "table") {
    return `- ${section.key}: rows, each an array of exactly ${section.columns!.length} strings (${section.columns!.join(" | ")}). No header row.`;
  }
  if (section.kind === "list") return `- ${section.key}: one fact per item, no leading number.`;
  const labels = section.coreLabels ?? [];
  return `- ${section.key}: labelled lines separated by \\n inside the string. Every line starts with one of ${labels.map((l) => `"${l}:"`).join(", ")}.`;
}

export interface SectionPromptInput {
  request: SectionRequest;
  examMode?: string;
  difficulty?: string;
  ragChunks: Passage[];
}

/** The system and user messages for one rewrite. */
export function buildSectionPrompts(input: SectionPromptInput): { systemPrompt: string; userContent: string } {
  const { request: req, ragChunks } = input;
  const exam = asExamMode(input.examMode);
  const plan = resolvePlanFromKeys(req.plan, exam);
  const target = plan.find((s) => s.key === req.key)!;

  const task = `Rewrite the "${target.title}" section. ${
    req.style === "custom"
      ? `The student asked for this: "${req.instruction}". If that is not a way of rewriting this section, rewrite it as clearly as you can instead.`
      : REGEN_TASK[req.style as Exclude<RegenStyle, "custom">]
  }
- The rewrite must visibly take that direction: every line serves it. A version that reads like the current one with new wording has failed.
- Keep what is right in the current version and fix what is wrong. Keep its numbers unless they are wrong.
- "${target.key}" is the high-yield core: only facts that pass the high-yield test above.
- The other sections stay as they are: say nothing they already say.`;

  const systemPrompt = `You are a medical educator rewriting one section of a student's study sheet. Pitch it at the difficulty level named below.

Mode: ${input.examMode || "General"} | Difficulty: ${input.difficulty || "Intermediate"}

${highYieldTest(exam)}

${scopeMap(plan)}

${groundingBlock(ragChunks)}

${ONE_HOME_PER_FACT}

YOUR TASK:
${task}

FORMAT:
${formatRule(target)}
- Use **double asterisks** to bold the key term where it helps, and arrows → for flow.

COUNTS — maximums; stop short rather than pad: ${req.key}: ${sectionQuota(target, "core")}.

OUTPUT — return exactly this JSON and nothing else:
{
${schemaLine(target, "core")}
  "covered": true
}
"covered" is true only if the Context above supports what you wrote, and false if you wrote it mainly from your own knowledge. With no Context, false.

FINAL CHECK — before the closing }:
- The only keys are "${req.key}", "covered".
- No fact from the sheet you are given appears again, reworded or not, and no line is about another population or topic.
Start your response with { and end with }. Nothing else.`;

  const userContent = `Topic: ${req.topic}

THE SHEET AS IT STANDS — every fact in it already has its home:
---
${sheetAsText(plan, req.sections, { key: target.key, note: "CURRENT VERSION — the one you are rewriting" })}
---`;

  return { systemPrompt, userContent };
}
