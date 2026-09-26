/**
 * Depth for a sheet the student already has, and rewrites of one section.
 *
 *   - expandAll  — the sheet is high-yield and the student wants it
 *                  comprehensive: write the `<key>_more` of every content
 *                  section in one call (the study aids get none — see
 *                  STUDY_AIDS). This is also how a comprehensive sheet is
 *                  made: the high-yield sheet first, then this.
 *   - expand     — the same for one section, study aids included.
 *   - regenerate — write one section again, core (and depth, if it had one),
 *                  in a direction the student picks (REGEN_STYLES).
 *
 * Why comprehensive is two calls. Asked for cores and depth in one pass, the
 * writer shared the facts out between them: a Step 2 DKA core lost "add
 * dextrose at 200–250" to its depth, and an HFrEF core swapped the four
 * mortality drugs for recovered-EF subtypes. So a comprehensive sheet's core
 * was not the high-yield sheet, and switching views changed what "high-yield"
 * meant. Written from the finished high-yield sheet, the depth cannot move
 * anything out of it.
 *
 * Why expandAll exists beside expand. Deepened one section at a time, the
 * calls reached for the same salient passages and repeated each other — a
 * DKA sheet said three times that ketones falsely raise creatinine. One call
 * over every section shares the facts out once.
 *
 * The model sees the whole sheet as it stands, with every section's scope, so
 * a fact can go to its one home even in a section this call does not write.
 * Grounding is the sheet's own passages, re-read by id, so the depth rests on
 * what the sheet's badges vouch for.
 *
 * Kept free of Deno-only imports so the app's tests can check exactly what the
 * model is shown.
 */
import { MAX_SECTIONS, STUDY_AIDS, asExamMode, resolvePlanFromKeys, sectionQuota, type PlannedSection } from "./sheet-plan.ts";
import { ONE_HOME_PER_FACT, highYieldTest, schemaLine } from "./sheet-schema.ts";
import { SECTIONS, moreKey, type Depth } from "./sheet-sections.ts";

export type SectionAction = "expandAll" | "expand" | "regenerate";

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

type Body = string | string[] | string[][];

export interface SectionRequest {
  action: SectionAction;
  /** The section to work on; null for expandAll. */
  key: string | null;
  /** The sheet's planned section keys, in reading order. */
  plan: string[];
  /** The sheet's bodies as they stand, cores and any `_more`. */
  sections: Record<string, Body>;
  topic: string;
  /** regenerate only — the direction of the rewrite. */
  style?: RegenStyle;
  /** regenerate + custom only — what the student wants changed, in their words. */
  instruction?: string;
  /** regenerate only — whether the section is written with its depth. */
  depth?: Depth;
  /** The sheet's own retrieved passages, re-read server-side by id. */
  sourceIds: string[];
  /** Proof the sheet was written as premium, for a student without Pro. */
  grant?: string;
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

/** Output budgets: one section's depth or rewrite is a few hundred tokens; every section's depth, a few times that. */
export const SECTION_MAX_TOKENS = 2_000;
export const EXPAND_ALL_MAX_TOKENS = 5_000;

/**
 * Added to those budgets for GPT-OSS, whose hidden reasoning counts against
 * max_tokens. Measured on these prompts it reasoned for 3,000–20,000
 * characters before writing a word, and on the Corti-sized budgets above half
 * of its calls ended at the limit with nothing written. Unused tokens cost
 * nothing.
 */
export const REASONING_HEADROOM = 8_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const oneLine = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max);
  return s || undefined;
};

/** A body as it may arrive: prose, items, or rows. Anything else is dropped. */
function asBody(v: unknown): Body | null {
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
  const action = r.action;
  if (action !== "expandAll" && action !== "expand" && action !== "regenerate") return null;

  if (!Array.isArray(r.plan)) return null;
  const plan = [...new Set(r.plan.filter((k): k is string => typeof k === "string" && !!SECTIONS[k]))].slice(0, MAX_SECTIONS);
  if (!plan.length) return null;
  let key: string | null = null;
  if (action !== "expandAll") {
    key = typeof r.key === "string" ? r.key : "";
    if (!plan.includes(key)) return null;
  }

  const rawSections = r.sections;
  if (!rawSections || typeof rawSections !== "object" || Array.isArray(rawSections)) return null;
  if (JSON.stringify(rawSections).length > SECTION_LIMITS.sheetChars) return null;
  const sections: Record<string, Body> = {};
  for (const k of plan) {
    for (const name of [k, moreKey(k)]) {
      const body = asBody((rawSections as Record<string, unknown>)[name]);
      if (body !== null) sections[name] = body;
    }
  }
  // Nothing to deepen: every content section already has depth, or the plan
  // has only study aids.
  if (action === "expandAll" && !pendingDepth(resolvePlanFromKeys(plan), sections).length) return null;

  const topic = oneLine(r.topic, SECTION_LIMITS.topic);
  if (!topic) return null;

  const req: SectionRequest = {
    action,
    key,
    plan,
    sections,
    topic,
    sourceIds: Array.isArray(r.sourceIds)
      ? r.sourceIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)).slice(0, SECTION_LIMITS.sources)
      : [],
  };
  if (action === "regenerate") {
    const style = REGEN_STYLES.includes(r.style as RegenStyle) ? (r.style as RegenStyle) : null;
    if (!style) return null;
    req.style = style;
    if (style === "custom") {
      const instruction = oneLine(r.instruction, SECTION_LIMITS.instruction);
      if (!instruction) return null;
      req.instruction = instruction;
    }
    req.depth = r.depth === "comprehensive" ? "comprehensive" : "highYield";
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
 * The sheet as the student has it, section by section, with each section's
 * depth under it. What the model must not say again. `mark` labels one
 * section's heading — the one being deepened or rewritten.
 */
export function sheetAsText(plan: PlannedSection[], sections: Record<string, Body>, mark?: { key: string; note: string }): string {
  return plan
    .map((s) => {
      const core = bodyText(s, sections[s.key]);
      const more = bodyText(s, sections[moreKey(s.key)]);
      const heading = `## ${s.title}${mark?.key === s.key ? ` (${mark.note})` : ""}`;
      return [heading, core || "(empty)", more ? `(its depth)\n${more}` : ""].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

/** The sections deepening a whole sheet writes: the content, not the study aids. */
export const depthSections = (plan: PlannedSection[]) => plan.filter((s) => !STUDY_AIDS.includes(s.key));

/** Of those, the ones with no depth yet. */
const pendingDepth = (plan: PlannedSection[], sections: Record<string, Body>) =>
  depthSections(plan).filter((s) => {
    const more = sections[moreKey(s.key)];
    return more === undefined || (Array.isArray(more) ? !more.length : !more.trim());
  });

/** Every section and what belongs in it, so a fact can be sent to its one home. */
function scopeMap(plan: PlannedSection[]): string {
  return `THE SHEET'S SECTIONS — a fact belongs in the section whose scope it fits, and nowhere else:
${plan.map((s) => `- ${s.title}: ${s.scope}`).join("\n")}`;
}

/**
 * A content section's depth is a passage that explains it; a study aid's is
 * more of its own kind — more hooks, traps or one-liners.
 *
 * Depth began as more lines in the core's own shape, and read as a second,
 * smaller sheet: a warfarin sheet deepened its Indications with two further
 * indications and its Mechanism with enantiomer trivia, none of it explaining
 * why the lines above were true. What a student opens "in depth" for is what
 * a textbook gives and a review sheet cannot: the reasons that connect the
 * facts. Causal explanation is also what makes clinical facts stick — students
 * taught why a disease's features arise remember them and diagnose with them
 * better than students given the features alone (Woods, Brooks & Norman) —
 * and it lives in the connecting words ("because", "which is why") that a list
 * strips out.
 */
export const isPassage = (s: PlannedSection) => !STUDY_AIDS.includes(s.key);

/** A passage's size: paragraphs, each with a run-in head and a few sentences. */
const PASSAGE_BUDGET = "1 to 3 paragraphs";
const PARAGRAPH_WORDS = 90;

/** What a passage explains, by the shape of the section it sits under. */
const PASSAGE_LENS: Record<PlannedSection["kind"], string> = {
  prose: "the chain its lines describe, one level below them — each step, and why it follows from the one before",
  list: "why each item is so — the mechanism or reasoning behind it — and what ties the items together",
  table: "the underlying difference that produces each distinguishing feature, so the rows can be told apart by reasoning rather than recall",
};

function passageFocus(s: PlannedSection): string {
  const past = s.moreLabels?.length
    ? ` Where the topic needs it, it also takes the student past the core — ${s.moreLabels.join(", ").toLowerCase()} — each with its reason.`
    : "";
  return `- ${s.title} (${s.scope}): explains ${PASSAGE_LENS[s.kind]}.${past}`;
}

/**
 * What a passage is. Its "leave out" list is DEPTH_RULES' — the pilot's
 * failures — and the reason for it: interesting detail that does not serve
 * the explanation lowers what is learned from the rest (the seductive-details
 * effect; Rey 2012, Sundararajan & Adesope 2020).
 */
export const PASSAGE_RULES = `WHAT AN IN-DEPTH PASSAGE IS
The sheet gives the student the facts. The passage under a section is what a good textbook says about them: it explains them, so the section's lines stop being things to memorise and become things the student could reason out.
- Start from what the section states. Take its central lines and explain them: the mechanism one level below, why each is true, how they connect to each other, and what follows for the patient — the "so what".
- Answer the questions a thoughtful student asks on reading the section: why is it this way; why not the obvious alternative; what happens when it fails; how is it told apart from its look-alike.
- Write connected prose: whole sentences joined by because, so, which is why, whereas, unless, until. The links between the facts are the point, so no lists, no labels, and no arrow chains in place of sentences.
- Name a fact the section already states only to explain it, inside a sentence that adds the why. A sentence that only restates the sheet is cut.
- A fact the sheet does not have comes in only as part of the explanation — the finer threshold, the exception, the second-line option, the special population — each with its reason. Never a fact tacked on for its own sake.
- Where a concrete case makes a principle click, use one short one: a patient, a number, a time course.
- Every sentence must be correct. Where a passage below speaks, follow it; where you are unsure of a number or a detail, leave it out rather than guess.
- If a line of the sheet is wrong or leaves out a rule that changes management, do not explain it as though it were complete: explain what is right.
LEAVE OUT, even when a passage says it — detail that does not serve the explanation makes the rest harder to learn:
- Epidemiology by region, country, race or sex; trial names and results; history and discovery; guideline disagreements; research classifications.
- What a source says about another population, setting or neighbouring topic.
- Filler: "it is important to note", "in summary", a restatement of the heading, a closing moral.
- The same explanation twice. Each mechanism is explained once, in the passage of the section it belongs to; another passage may refer back to it in a clause.`;

/** How deep a passage starts, by the student's difficulty — explicit for a novice, dense for an expert. */
const PASSAGE_PITCH: Record<string, string> = {
  Basic:
    "The student is meeting this for the first time. Define each technical term the first time it appears, take one step at a time, and leave no step for them to fill in.",
  Intermediate:
    "The student knows core physiology and pharmacology. Explain the steps specific to this topic without re-teaching the basics.",
  Advanced:
    "The student knows the basics and the high-yield facts. Skip both: go to the finer mechanism, the exceptions and the reasoning an expert uses. Dense is fine.",
};

/** What a passage reasons toward, by the exam. */
const PASSAGE_EXAM: Record<ReturnType<typeof asExamMode>, string> = {
  "USMLE Step 1":
    "Explain down to the molecule, cell and tissue, and tie each mechanism to the finding, lab value or adverse effect it produces.",
  "USMLE Step 2":
    "Explain the clinical reasoning: why this test or step comes next, why this drug over its alternative, what changes the decision, and what to do when first-line fails.",
  General:
    "Explain the reasoning a clinician uses: why each step is taken, what to watch for, and what changes management.",
};

function passageBlock(sections: PlannedSection[], exam: ReturnType<typeof asExamMode>, diff: string): string {
  return `${PASSAGE_RULES}

PITCH — ${diff}: ${PASSAGE_PITCH[diff] ?? PASSAGE_PITCH.Intermediate}
${exam === "General" ? "" : `${exam}: `}${PASSAGE_EXAM[exam]}

WHAT EACH PASSAGE EXPLAINS:
${sections.map(passageFocus).join("\n")}`;
}

/**
 * What depth is for a study aid. Each "not" is a failure seen in the pilot: a
 * DKA depth padded with a pediatric screening rule from a Nelson passage, an
 * HFrEF depth with comorbidity by continent, case-fatality by race and a
 * trial's regional results — all true, all in the passages, none of it what a
 * student going deeper on the topic needs.
 */
export const DEPTH_RULES = `WHAT DEPTH IS — every line does one of these, for this topic, at this exam and difficulty:
- Explains the mechanism behind a fact the sheet states: the why.
- Adds the next layer of a fact the sheet states: what to do when first-line fails, the finer threshold, the exception, the atypical but testable presentation, the special population the exam asks about.
- Adds a testable fact about this topic that the high-yield sheet had no room for.
WHAT DEPTH IS NOT — leave these out, even when a passage says them:
- Epidemiology by region, country, race or sex; trial names and trial results; guideline disagreements; research classifications; history.
- What a passage says about another population, setting or neighbouring topic — a pediatric screening rule on an adult topic, a different disease's workup.
- Anything the sheet already says. Before each line, name to yourself the one fact it adds; if the sheet states that fact anywhere — in any section, in any words, inside a longer line — drop the line.
- Anything whose home is another section's scope.`;

function passages(chunks: Passage[]): string {
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

/**
 * How the passages are shaped, said once for all of them. A bold run-in head
 * on each paragraph keeps a passage skimmable without breaking it into a list.
 * The example head is from no pilot topic, so it cannot be copied into one.
 *
 * A paragraph is one array item rather than a line of one string: asked for
 * paragraphs split by \n\n inside a string, Corti closed the string between
 * two of them, and the reply stopped being JSON.
 */
const passageFormat = (keys: string[]) =>
  `- ${keys.join(", ")}: ${keys.length > 1 ? "each " : ""}an array of ${PASSAGE_BUDGET}, one paragraph per string. Each paragraph opens with a bold run-in head of 3 to 8 words naming what it explains, the full stop inside the bold (e.g. "**Why the cough is dry.** "), then 2 to 5 sentences of connected prose — at most ${PARAGRAPH_WORDS} words a paragraph. At most one more bold term per paragraph. No lists, labels or arrows.`;

/** How one key's body is shaped, for the format block. */
function formatRule(section: PlannedSection, key: string, part: "core" | "more"): string {
  if (section.kind === "table") {
    return `- ${key}: rows, each an array of exactly ${section.columns!.length} strings (${section.columns!.join(" | ")}). No header row.`;
  }
  if (section.kind === "list") return `- ${key}: one fact per item, no leading number.`;
  // A core keeps to its own labels; a depth may add the ones the core left out.
  const labels = [...(section.coreLabels ?? []), ...(part === "more" ? section.moreLabels ?? [] : [])];
  return `- ${key}: labelled lines separated by \\n inside the string. Every line starts with one of ${labels.map((l) => `"${l}:"`).join(", ")}.`;
}

export interface SectionPromptInput {
  request: SectionRequest;
  examMode?: string;
  difficulty?: string;
  ragChunks: Passage[];
}

/** The system and user messages for one depth or rewrite request. */
export function buildSectionPrompts(input: SectionPromptInput): { systemPrompt: string; userContent: string } {
  const { request: req, ragChunks } = input;
  const exam = asExamMode(input.examMode);
  const diff = input.difficulty || "Intermediate";
  const plan = resolvePlanFromKeys(req.plan, exam);
  const target = req.key ? plan.find((s) => s.key === req.key)! : null;

  // What this call writes: [section, part] pairs, in the order they are written.
  // Deepening the whole sheet skips a section the student already deepened on
  // its own — that depth is on the page, and is what the rest must not repeat.
  const writes: [PlannedSection, "core" | "more"][] =
    req.action === "expandAll"
      ? pendingDepth(plan, req.sections).map((s) => [s, "more"])
      : req.action === "expand"
      ? [[target!, "more"]]
      : [[target!, "core"], ...(req.depth === "comprehensive" ? [[target!, "more"] as [PlannedSection, "more"]] : [])];
  const keyOf = ([s, part]: [PlannedSection, "core" | "more"]) => (part === "core" ? s.key : moreKey(s.key));
  const keys = writes.map(keyOf);
  const passageOf = ([s, part]: [PlannedSection, "core" | "more"]) => part === "more" && isPassage(s);
  const passageSections = writes.filter(passageOf).map(([s]) => s);
  // Deepening the whole sheet, a section may have nothing worth adding, and
  // says so with an empty value rather than filling a floor.
  const quota = (w: [PlannedSection, "core" | "more"]) => {
    const q = passageOf(w) ? PASSAGE_BUDGET : sectionQuota(w[0], w[1]);
    return req.action === "expandAll" ? `${q.replace(/^\d+ to (\d+)/, "up to $1")}, or none` : q;
  };
  const counts = writes.map((w) => `${keyOf(w)}: ${quota(w)}`).join("; ");
  const skeleton = writes
    .map((w) =>
      passageOf(w)
        ? `  "${keyOf(w)}": [\n    "<**Run-in head.** The first paragraph of the passage explaining ${w[0].title}.>",\n    "<...>"\n  ],`
        : schemaLine(w[0], w[1])
    )
    .join("\n");
  // The sheet's own coverage shape, so the page reads it with the parser it
  // already has — and a bare "uncovered" list is not mistaken for a section.
  const coverageKey = req.action === "expandAll" ? "sourceCoverage" : "covered";
  const coverageLine =
    req.action === "expandAll"
      ? `  "sourceCoverage": {\n    "level": "full | partial | none",\n    "uncovered": ["<zero or more of: ${keys.join(", ")}>"]\n  }`
      : `  "covered": true`;
  const coverageRule =
    req.action === "expandAll"
      ? `"sourceCoverage": "full" when the Context above supports every key you wrote; "partial" when some keys were written mainly from your own knowledge — list those in "uncovered"; "none" when the Context was empty or irrelevant — list them all. When in doubt, the weaker level.`
      : `"covered" is true only if the Context above supports what you wrote, and false if you wrote it mainly from your own knowledge. With no Context, false.`;

  // A study aid deepened on its own gets more of its kind; every other depth is a passage.
  const aidDepth = writes.some((w) => w[1] === "more" && !passageOf(w));
  const allPassages = writes.every(passageOf);
  const task =
    req.action === "expandAll"
      ? `The student has this high-yield sheet and wants the comprehensive one: under each section listed below, in the order shown, the in-depth passage that explains it.
- Every section stays exactly as it is. The passage sits under it and explains it.
- Explain each thing once, under the first section it belongs to. Before each paragraph, check the passages you have already written: if one of them explained this, refer back to it in a clause and spend the paragraph on something else.
- A section whose lines need no explaining gets [].`
      : req.action === "expand" && allPassages
      ? `The student has the high-yield version of "${target!.title}" and wants it in depth. Write "${moreKey(target!.key)}": the passage under it that explains it.
- The section stays exactly as it is. The passage sits under it and explains it.
- It explains "${target!.title}" only: what belongs to another section's passage stays out, even though that section has none yet. What another section's passage already explains, refer back to in a clause rather than explain again.`
      : req.action === "expand"
      ? `The student has the high-yield version of "${target!.title}" and wants the comprehensive one. Write "${moreKey(target!.key)}": what a comprehensive sheet adds to this section.
- The section's core stays exactly as it is. You add to it; you never restate it.
- It deepens "${target!.title}" only: a fact whose home is another section stays out, even though that section is not being deepened.`
      : `Rewrite the "${target!.title}" section. ${
          req.style === "custom"
            ? `The student asked for this: "${req.instruction}". If that is not a way of rewriting this section, rewrite it as clearly as you can instead.`
            : REGEN_TASK[req.style as Exclude<RegenStyle, "custom">]
        }
- The rewrite must visibly take that direction: every line serves it. A version that reads like the current one with new wording has failed.
- Keep what is right in the current version and fix what is wrong. Keep its numbers unless they are wrong.
- "${target!.key}" is the high-yield core: only facts that pass the high-yield test above.${
          req.depth === "comprehensive"
            ? passageSections.length
              ? `\n- "${moreKey(target!.key)}" is the in-depth passage under it, explaining the rewritten lines, in the same direction.`
              : `\n- "${moreKey(target!.key)}" is what a comprehensive sheet adds to it, and never restates it.`
            : ""
        }
- The other sections stay as they are: say nothing they already say.`;

  const rules = [
    passageSections.length ? passageBlock(passageSections, exam, diff) : "",
    aidDepth ? DEPTH_RULES : "",
  ].filter(Boolean);
  const finalChecks = [
    `The only keys are ${[...keys, coverageKey].map((k) => `"${k}"`).join(", ")}.`,
    counts,
    allPassages
      ? "Every sentence explains, connects, or adds a fact with its reason; none only restates a line of the sheet, and no passage holds a list, a label or an arrow."
      : "No fact from the sheet you are given appears again, reworded or not, and no line is about another population or topic.",
    ...(passageSections.length && !allPassages
      ? ["Every passage sentence explains, connects, or adds a fact with its reason, and no passage holds a list, a label or an arrow."]
      : []),
  ];
  const systemPrompt = `You are a medical educator ${
    req.action === "regenerate"
      ? "rewriting one section of"
      : allPassages
      ? "writing the in-depth explanations for"
      : "deepening"
  } a student's study sheet${allPassages ? " — the way a good textbook explains what a review sheet lists" : ""}. Pitch it at the difficulty level named below.

Mode: ${input.examMode || "General"} | Difficulty: ${diff}
${allPassages ? "" : `\n${highYieldTest(exam)}\n`}
${scopeMap(plan)}
${rules.map((r) => `\n${r}\n`).join("")}
${passages(ragChunks)}
${allPassages ? "" : `\n${ONE_HOME_PER_FACT}\n`}
YOUR TASK:
${task}

FORMAT:
${[
  ...writes.flatMap((w, i) => (passageOf(w) ? [] : [formatRule(w[0], keys[i], w[1])])),
  ...(passageSections.length ? [passageFormat(keys.filter((_, i) => passageOf(writes[i])))] : []),
].join("\n")}${
    allPassages ? "" : "\n- Use **double asterisks** to bold the key term where it helps, and arrows → for flow."
  }

COUNTS — maximums; stop short rather than pad: ${counts}.

OUTPUT — return exactly this JSON and nothing else:
{
${skeleton}
${coverageLine}
}
${coverageRule}

FINAL CHECK — before the closing }:
${finalChecks.map((c) => `- ${c}`).join("\n")}
Start your response with { and end with }. Nothing else.`;

  const mark = target
    ? {
        key: target.key,
        note:
          req.action === "regenerate"
            ? "CURRENT VERSION — the one you are rewriting"
            : allPassages
            ? "THE SECTION YOU ARE EXPLAINING"
            : "THE SECTION YOU ARE DEEPENING",
      }
    : undefined;
  const userContent = `Topic: ${req.topic}

THE SHEET AS IT STANDS — ${allPassages ? "the lines your passages explain" : "every fact in it already has its home"}:
---
${sheetAsText(plan, req.sections, mark)}
---`;

  return { systemPrompt, userContent };
}
