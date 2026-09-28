/**
 * Branches: what a student grows out of one line of their sheet.
 *
 * The sheet is the trunk — high-yield, and never rewritten by a branch. A
 * branch answers one question about one line of it, in the shape that
 * question needs: a management question gets ordered steps with the doses and
 * thresholds, a look-alike gets a side-by-side table, a mechanism gets prose.
 * It replaced the fixed "in depth" passage under every section, which gave
 * every section the same three "Why…" paragraphs whatever the section needed,
 * and squeezed management — for a condition, one line of the sheet — into a
 * third of a 270-word passage that the rules only let explain the sheet's own
 * lines.
 *
 *   - suggest — reads the finished sheet and proposes the branches worth
 *               growing, each tied to the line it grows from: the pills. One
 *               call for the whole sheet, so the questions are shared out
 *               between the lines rather than asked twice.
 *   - grow    — writes one branch. It sees the whole sheet, so it builds on it
 *               rather than repeating it, and the branches it hangs from, so a
 *               branch of a branch goes further along the same path. It also
 *               proposes where to go next, until MAX_BRANCH_DEPTH.
 *
 * Grounding is the sheet's own passages, re-read by id, as for a section
 * request.
 *
 * Kept free of Deno-only imports so the app's tests can check exactly what the
 * model is shown.
 */
import { asExamMode, resolvePlanFromKeys, type PlannedSection } from "./sheet-plan.ts";
import { SECTIONS } from "./sheet-sections.ts";
import { SECTION_LIMITS, asBody, groundingBlock, type Body, type Passage } from "./sheet-section-prompts.ts";

export type BranchType = "mechanism" | "management" | "compare" | "differential" | "case" | "ask";

export const BRANCH_TYPES: readonly BranchType[] = ["mechanism", "management", "compare", "differential", "case", "ask"];

/** The types the model may propose. "ask" is the student's own question. */
export const SUGGESTED_TYPES: readonly BranchType[] = ["mechanism", "management", "compare", "differential", "case"];

/** Types that are about a second condition, which they name. */
export const NEEDS_VERSUS: readonly BranchType[] = ["compare", "differential"];

export type BranchAction = "suggest" | "grow";

/**
 * How deep branches go: a branch, a branch of it, and one more. Past that a
 * sheet stops being a sheet and becomes a chat log, and each level's question
 * is further from the line the student started on. The last level proposes
 * nothing further.
 */
export const MAX_BRANCH_DEPTH = 3;

/** What a pill asks for. */
export interface BranchQuestion {
  type: BranchType;
  /** What the pill says: 3 to 7 words. */
  label: string;
  /** The exact question the branch answers, in one sentence. */
  ask: string;
  /** compare and differential: the other condition. */
  versus?: string;
}

/** A branch above the one being grown, outermost first. */
export interface BranchAncestor {
  label: string;
  text: string;
}

export interface BranchRequest {
  action: BranchAction;
  /** The sheet's planned section keys, in reading order. */
  plan: string[];
  /** The sheet's bodies as the student has them. */
  sections: Record<string, Body>;
  topic: string;
  /** The sheet's own retrieved passages, re-read server-side by id. */
  sourceIds: string[];
  /** grow only — the line it grows from: `section:index`. */
  anchor?: string;
  /** grow only — the line as it read, for a line the server cannot find. */
  quote?: string;
  /** grow only. */
  question?: BranchQuestion;
  /** grow only — the branches it hangs from, outermost first. */
  path?: BranchAncestor[];
  /** grow only — the sheet's other branches, which this one must not repeat. */
  others?: { label: string; ask: string }[];
}

export const BRANCH_LIMITS = {
  label: 80,
  ask: 300,
  versus: 80,
  ancestorText: 2_000,
  others: 40,
} as const;

/** Output budgets. A branch is a few hundred words; the suggestions, a line or two per pill. */
export const SUGGEST_MAX_TOKENS = 2_400;
export const GROW_MAX_TOKENS = 1_800;

const ANCHOR_RE = /^([A-Za-z][A-Za-z0-9_]*):(\d+)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const oneLine = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max);
  return s || undefined;
};

/**
 * The other condition, read from a label that names it — "vs Paralytic
 * ileus", "Mesenteric ischemia profile" — for a pill that left out "versus".
 */
export function versusFromLabel(label: string): string | undefined {
  const t = label.trim();
  const m = /^vs\.?\s+(.+)$/i.exec(t) ?? /^(.+?)\s+profile$/i.exec(t);
  return m?.[1].trim() || undefined;
}

/** A pill's question as it may arrive, validated; null when it is not one. */
export function parseQuestion(raw: unknown, allowed: readonly BranchType[] = BRANCH_TYPES): BranchQuestion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const type = allowed.includes(r.type as BranchType) ? (r.type as BranchType) : null;
  const ask = oneLine(r.ask, BRANCH_LIMITS.ask);
  if (!type || !ask) return null;
  const label = oneLine(r.label, BRANCH_LIMITS.label) ?? ask.slice(0, BRANCH_LIMITS.label);
  const q: BranchQuestion = { type, label, ask };
  const versus = oneLine(r.versus, BRANCH_LIMITS.versus) ?? versusFromLabel(label);
  if (NEEDS_VERSUS.includes(type)) {
    if (!versus) return null;
    q.versus = versus;
  }
  return q;
}

/** Sections a pill may grow from: every planned one but the mnemonics, which a branch has nothing to add to. */
export const branchable = (key: string) => key !== "memoryHooks";

/**
 * The request, validated; null when it names nothing runnable. The plan's keys
 * must all be catalogue sections, and a grow's anchor must be one of their
 * lines.
 */
export function parseBranchRequest(raw: unknown): BranchRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const action = r.action;
  if (action !== "suggest" && action !== "grow") return null;

  if (!Array.isArray(r.plan)) return null;
  const plan = [...new Set(r.plan.filter((k): k is string => typeof k === "string" && !!SECTIONS[k]))].slice(0, 7);
  if (!plan.length) return null;

  const rawSections = r.sections;
  if (!rawSections || typeof rawSections !== "object" || Array.isArray(rawSections)) return null;
  if (JSON.stringify(rawSections).length > SECTION_LIMITS.sheetChars) return null;
  const sections: Record<string, Body> = {};
  for (const k of plan) {
    const body = asBody((rawSections as Record<string, unknown>)[k]);
    if (body !== null) sections[k] = body;
  }
  if (!Object.keys(sections).length) return null;

  const topic = oneLine(r.topic, SECTION_LIMITS.topic);
  if (!topic) return null;

  const req: BranchRequest = {
    action,
    plan,
    sections,
    topic,
    sourceIds: Array.isArray(r.sourceIds)
      ? r.sourceIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)).slice(0, SECTION_LIMITS.sources)
      : [],
  };
  if (action === "suggest") return req;

  const m = typeof r.anchor === "string" ? ANCHOR_RE.exec(r.anchor) : null;
  if (!m || !plan.includes(m[1]) || !branchable(m[1])) return null;
  req.anchor = r.anchor as string;
  const quote = oneLine(r.quote, SECTION_LIMITS.line);
  if (quote) req.quote = quote;

  const question = parseQuestion(r.question);
  if (!question) return null;
  req.question = question;

  const path = Array.isArray(r.path) ? r.path : [];
  if (path.length > MAX_BRANCH_DEPTH - 1) return null;
  req.path = [];
  for (const p of path) {
    if (!p || typeof p !== "object") return null;
    const label = oneLine((p as Record<string, unknown>).label, BRANCH_LIMITS.label);
    const text = (p as Record<string, unknown>).text;
    if (!label || typeof text !== "string") return null;
    req.path.push({ label, text: text.trim().slice(0, BRANCH_LIMITS.ancestorText) });
  }

  req.others = (Array.isArray(r.others) ? r.others : [])
    .slice(0, BRANCH_LIMITS.others)
    .map((o) => {
      const x = (o ?? {}) as Record<string, unknown>;
      const label = oneLine(x.label, BRANCH_LIMITS.label);
      return label ? { label, ask: oneLine(x.ask, BRANCH_LIMITS.ask) ?? "" } : null;
    })
    .filter((o): o is { label: string; ask: string } => o !== null);
  return req;
}

// ── The sheet, as the model reads it ─────────────────────────────────────────

/**
 * One section's lines, numbered the way the page anchors them: a prose line by
 * its index in the body split on "\n" (blank lines count, and are not shown),
 * a list item or a table row by its index.
 */
function numberedLines(section: PlannedSection, body: Body | undefined): string[] {
  if (body === undefined) return [];
  if (typeof body === "string") {
    return body
      .split("\n")
      .map((line, i) => (line.trim() ? `[${i}] ${line.trim()}` : ""))
      .filter(Boolean);
  }
  if (!body.length) return [];
  if (Array.isArray(body[0])) {
    const header = section.columns?.length ? [`(columns: ${section.columns.join(" | ")})`] : [];
    return [...header, ...(body as string[][]).map((row, i) => `[${i}] ${row.join(" | ")}`)];
  }
  return (body as string[]).map((item, i) => `[${i}] ${item}`);
}

/** The sheet with every line numbered and each section's key, for pills that name a line. */
export function numberedSheet(plan: PlannedSection[], sections: Record<string, Body>): string {
  return plan
    .map((s) => [`## ${s.title} [${s.key}]`, ...numberedLines(s, sections[s.key])].join("\n"))
    .join("\n\n");
}

/** The sheet as plain text, for a branch that must build on it and not repeat it. */
function plainSheet(plan: PlannedSection[], sections: Record<string, Body>): string {
  return plan
    .map((s) => [`## ${s.title}`, ...numberedLines(s, sections[s.key]).map((l) => l.replace(/^\[\d+\] /, ""))].join("\n"))
    .join("\n\n");
}

/** What a line says, by its anchor; null when the sheet has no such line. */
export function lineAt(sections: Record<string, Body>, anchor: string): string | null {
  const m = ANCHOR_RE.exec(anchor);
  if (!m) return null;
  const body = sections[m[1]];
  const i = Number(m[2]);
  if (typeof body === "string") return body.split("\n")[i]?.trim() || null;
  const item = body?.[i];
  if (item === undefined) return null;
  return Array.isArray(item) ? item.join(" | ") : item;
}

// ── What each kind of branch is ──────────────────────────────────────────────

/** What a branch of each type answers, as the suggest and grow prompts both say it. */
export const TYPE_GUIDE: Record<BranchType, string> = {
  management:
    "how it is actually done: the steps in order — stabilise, first-line with the drug, dose, threshold or timing, how long to persist, what to monitor, what failure looks like, then second-line or definitive treatment and its triggers",
  compare:
    "this topic side by side with one named look-alike: the features that tell them apart, and the fastest way to tell them apart",
  differential:
    "one condition from the differential, profiled: who gets it, how it presents, the test that clinches it, how it is managed, and how to tell it from this topic",
  mechanism:
    "the mechanism one level below a line: how it happens, step by step, and what follows from it for the patient",
  case:
    "a short patient case that turns on this line: the decision to make, the answer, and the reasoning",
  ask: "the student's own question, answered directly",
};

/** How deep a branch starts, by the student's difficulty — explicit for a novice, dense for an expert. */
const PITCH: Record<string, string> = {
  Basic:
    "The student is meeting this for the first time. Define each technical term the first time it appears and leave no step for them to fill in.",
  Intermediate:
    "The student knows core physiology and pharmacology. Explain what is specific to this topic without re-teaching the basics.",
  Advanced:
    "The student knows the basics and the high-yield facts. Skip both: the finer detail, the exceptions and the reasoning an expert uses. Dense is fine.",
};

/** What a branch reasons toward, by the exam. */
const EXAM_AIM: Record<ReturnType<typeof asExamMode>, string> = {
  "USMLE Step 1":
    "Aim at Step 1: down to the molecule, cell and tissue, tied to the finding, lab value or adverse effect each mechanism produces.",
  "USMLE Step 2":
    "Aim at Step 2: the clinical reasoning — the next best step, why this test or drug over its alternative, what changes the decision, and what to do when first-line fails.",
  General: "Aim at the reasoning a clinician uses: why each step is taken, what to watch for, and what changes management.",
};

/**
 * What every branch leaves out. Detail that does not serve the question makes
 * the rest harder to learn (the seductive-details effect; Rey 2012).
 */
const LEAVE_OUT = `LEAVE OUT, even when a passage says it:
- Epidemiology by region, country, race or sex; trial names and results; history and discovery; guideline disagreements.
- What a source says about another population, setting or neighbouring topic.
- Filler: "it is important to note", "in summary", a restatement of the question, a closing moral.`;

// ── suggest ──────────────────────────────────────────────────────────────────

/** The sections' hints: what each is for, and what its high-yield core left out. */
function sectionHints(plan: PlannedSection[]): string {
  return plan
    .filter((s) => branchable(s.key))
    .map((s) => {
      const left = s.moreLabels?.length ? ` Its high-yield core left out: ${s.moreLabels.join(", ").toLowerCase()}.` : "";
      return `- ${s.title} [${s.key}]: ${s.scope}.${left}`;
    })
    .join("\n");
}

const STUDY_AID_KEYS = ["keyPoints", "memoryHooks", "examTraps"];

export interface BranchPromptInput {
  request: BranchRequest;
  examMode?: string;
  difficulty?: string;
  ragChunks: Passage[];
}

export function buildSuggestPrompts(input: BranchPromptInput): { systemPrompt: string; userContent: string } {
  const { request: req } = input;
  const exam = asExamMode(input.examMode);
  const diff = input.difficulty || "Intermediate";
  const plan = resolvePlanFromKeys(req.plan, exam);
  const content = plan.filter((s) => branchable(s.key) && !STUDY_AID_KEYS.includes(s.key));
  const aids = plan.filter((s) => branchable(s.key) && STUDY_AID_KEYS.includes(s.key));

  const systemPrompt = `You are a medical educator. A student has the high-yield study sheet below — the trunk of what they will learn on this topic. Propose the branches worth growing from it: each one a question about one line of the sheet that a student at this level would most want answered next, and that the sheet itself only touches.

Mode: ${input.examMode || "General"} | Difficulty: ${diff}
${PITCH[diff] ?? PITCH.Intermediate}
${EXAM_AIM[exam]}

THE KINDS OF BRANCH — pick the one whose shape fits the question:
${SUGGESTED_TYPES.map((t) => `- ${t}: ${TYPE_GUIDE[t]}`).join("\n")}

THE SHEET'S SECTIONS:
${sectionHints(plan)}

WHAT TO PROPOSE:
- Where a high-yield sheet compresses most, a branch pays most. A management line squeezes a whole treatment plan into one sentence: give it a management branch that asks for the specifics — how long, which drug and dose, what threshold, what to monitor, when to escalate or operate. Where a section's core left something out (listed above), propose the branch that covers it.
- A row of a differential, or a classic look-alike, gets a compare branch (the one most often confused with this topic) or a differential branch (a dangerous one worth knowing in full).
- A line whose mechanism is the key to reasoning the rest out gets a mechanism branch.
- A line that decides what the doctor does next gets a case branch.
- Across the sheet, cover the kinds the topic needs: for a condition or a drug, at least one management branch, one compare branch and one mechanism branch.
- Every branch is specific to this topic and its line. Never "Learn more", "Go deeper", or a label that would fit any topic.
- No two branches answer the same question, and none asks for what the sheet already says in full.

COUNTS — per section, in the order the sheet has them, the most valuable first:
${content.map((s) => `- ${s.key}: 2 to 4`).join("\n")}${aids.length ? `\n${aids.map((s) => `- ${s.key}: 0 to 2`).join("\n")}` : ""}
At most 18 in all.

EACH BRANCH:
- "section": the section's key, in brackets on its heading below.
- "line": the number in brackets before the line it grows from.
- "type": one of ${SUGGESTED_TYPES.map((t) => `"${t}"`).join(", ")}.
- "label": what its button says — 3 to 7 words, specific, as a student would name it: "Conservative trial, step by step", "Reading the CT for a closed loop". For compare, "vs <the look-alike>". Not a question, and never starting with "Why".
- "ask": the exact question the branch answers, in one sentence that names its specifics — the drug, the threshold, the look-alike.
- "versus": compare and differential only — the other condition's name.

OUTPUT — return exactly this JSON and nothing else:
{
  "pills": [
    {"section": "<key>", "line": <number>, "type": "<type>", "label": "<label>", "ask": "<question>"},
    {"section": "<key>", "line": <number>, "type": "compare", "label": "vs <the look-alike>", "ask": "<question>", "versus": "<the look-alike>"},
    ...
  ]
}

FINAL CHECK — before the closing }:
- No label starts with "Why" or "How", and none is a question: each names its subject ("Potassium before insulin", not "Why potassium comes first").
- Each "line" is the number of a line under that section's heading.
- Every compare and differential branch has "versus".
Start your response with { and end with }. Nothing else.`;

  const userContent = `Topic: ${req.topic}

THE SHEET — every line numbered:
---
${numberedSheet(plan, req.sections)}
---`;

  return { systemPrompt, userContent };
}

// ── grow ─────────────────────────────────────────────────────────────────────

/** A branch's JSON body by type, with its counts, for the task and the skeleton. */
const BODY: Record<BranchType, { rules: string; skeleton: string; keys: string[] }> = {
  management: {
    rules: `- "steps": 3 to 8 steps, in the order they are done. Each opens with a bold head of 2 to 6 words naming the step ("**Decompress the stomach** — "), then what to do with its specifics — drug, dose, route, threshold, timing, duration — and, in a clause, why. One step, one decision.
- "watch": 0 to 3 lines — what to monitor or the sign that the plan is failing, each → what to do then.`,
    skeleton: `  "steps": ["**<Step head>** — <what to do, with its specifics, and why>", "..."],
  "watch": ["<what to monitor or the sign of failure> → <what to do>"],`,
    keys: ["steps", "watch"],
  },
  compare: {
    rules: `- "rows": 4 to 8 rows, each an array of exactly 3 strings: the feature, how it is in the topic, how it is in the look-alike. Features that tell them apart, most decisive first: the history, the examination, the tests, the treatment. No header row. Short cells.
- "takeaway": one sentence — the fastest reliable way to tell them apart.`,
    skeleton: `  "rows": [["<feature>", "<in the topic>", "<in the look-alike>"], ["..."]],
  "takeaway": "<the fastest way to tell them apart>",`,
    keys: ["rows", "takeaway"],
  },
  differential: {
    rules: `- "profile": exactly 5 lines, each starting with its label and 1 or 2 sentences after it: "Who: …", "Presents: …", "Clinch it: …", "Manage: …", "Tell apart: …" (how to tell it from the topic).`,
    skeleton: `  "profile": ["Who: <…>", "Presents: <…>", "Clinch it: <…>", "Manage: <…>", "Tell apart: <…>"],`,
    keys: ["profile"],
  },
  mechanism: {
    rules: `- "paragraphs": 2 to 4 paragraphs of connected prose, at most 90 words each. Each opens with a bold head of 2 to 6 words naming what it covers — a noun phrase such as "**Fluid lost to the lumen.**", never a question and never starting with Why or How.
- Sentences of at most 30 words, one step of the mechanism each. Link the steps with because, so, whereas — but start a new sentence rather than chain a third clause onto one. No lists and no arrow chains in place of sentences.`,
    skeleton: `  "paragraphs": ["**<Head.>** <connected prose>", "..."],`,
    keys: ["paragraphs"],
  },
  case: {
    rules: `- "stem": the case in 60 to 110 words — age, setting, the history, the examination and the results that matter — the way an exam writes one.
- "question": the decision, as one question.
- "answer": the answer in at most 15 words.
- "reasoning": 2 to 4 sentences — why that is right, and why the most tempting alternative is wrong.`,
    skeleton: `  "stem": "<the case>",
  "question": "<the decision>",
  "answer": "<the answer>",
  "reasoning": "<why>",`,
    keys: ["stem", "question", "answer", "reasoning"],
  },
  ask: {
    rules: `- "paragraphs": 1 to 4 paragraphs that answer the question directly — the answer first, then what it rests on. At most 90 words each. Each may open with a bold head of 2 to 6 words naming what it covers, never starting with Why or How. Where the answer is a sequence of steps, write the steps as sentences.`,
    skeleton: `  "paragraphs": ["<the answer>", "..."],`,
    keys: ["paragraphs"],
  },
};

/** The keys a grown branch's body may use, by type — what the client reads. */
export const BODY_KEYS: Record<BranchType, string[]> = Object.fromEntries(
  BRANCH_TYPES.map((t) => [t, BODY[t].keys])
) as Record<BranchType, string[]>;

export function buildGrowPrompts(input: BranchPromptInput): { systemPrompt: string; userContent: string } {
  const { request: req, ragChunks } = input;
  const exam = asExamMode(input.examMode);
  const diff = input.difficulty || "Intermediate";
  const plan = resolvePlanFromKeys(req.plan, exam);
  const q = req.question!;
  const anchorKey = ANCHOR_RE.exec(req.anchor!)![1];
  const section = plan.find((s) => s.key === anchorKey);
  const line = lineAt(req.sections, req.anchor!) ?? req.quote ?? "";
  const path = req.path ?? [];
  const level = path.length + 1;
  const body = BODY[q.type];
  const nextAllowed = level < MAX_BRANCH_DEPTH;

  const subject = q.versus ? `${req.topic} and ${q.versus}` : req.topic;
  const task = `Write the branch that answers: "${q.ask}"
It is a ${q.type} branch — ${TYPE_GUIDE[q.type]}${q.versus ? ` (the other condition: ${q.versus})` : ""}.
- Answer that question, about ${subject}, and nothing else. The student already has the sheet: build on it. A fact the sheet states comes in only where the answer needs it, and then briefly.
- Go past the sheet: the specifics it had no room for are the point of a branch — the doses, thresholds, timings, the exceptions, what to do when the first answer fails.${
    path.length
      ? `\n- It grows from the branch${path.length > 1 ? "es" : ""} shown below, so go further along that path: say nothing ${path.length > 1 ? "they say" : "it says"} again.`
      : ""
  }${req.others?.length ? "\n- The sheet's other branches, listed below, answer their own questions: leave their ground to them." : ""}`;

  const next = nextAllowed
    ? `
"next": 2 or 3 questions this branch opens, each a branch of its own for the student to grow later — same fields as a pill: "type" (one of ${SUGGESTED_TYPES.map((t) => `"${t}"`).join(", ")}), "label" (3 to 7 words, specific, not starting with "Why"), "ask" (the question in one sentence) and, for compare and differential, "versus". None repeats this branch, another branch or the sheet.`
    : "";

  const systemPrompt = `You are a medical educator writing one branch of a student's study sheet: the answer to one question they asked about one line of it.

Mode: ${input.examMode || "General"} | Difficulty: ${diff}
${PITCH[diff] ?? PITCH.Intermediate}
${EXAM_AIM[exam]}

${groundingBlock(ragChunks)}

ACCURACY
- Every sentence must be correct. Where a passage above speaks, follow it.
- Give the numbers the exam asks about — standard doses, thresholds, timings — when you are sure of them. Where you are not sure of a number, give the principle without it rather than guess.
- If a line of the sheet is wrong or leaves out a rule that changes management, say what is right.
- Write about the medicine, to the student. Never mention "the sheet", "this branch" or "the question".

${LEAVE_OUT}

YOUR TASK:
${task}

FORMAT:
${body.rules}
- Use **double asterisks** for the few terms that matter most.${next}

OUTPUT — return exactly this JSON and nothing else:
{
${body.skeleton}${nextAllowed ? `\n  "next": [{"type": "<type>", "label": "<label>", "ask": "<question>"}],` : ""}
  "covered": true
}
"covered" is true only if the passages above support what you wrote, and false if you wrote it mainly from your own knowledge. With no passages, false.
Start your response with { and end with }. Nothing else.`;

  const ancestors = path.length
    ? `\n\nTHE BRANCH${path.length > 1 ? "ES" : ""} IT GROWS FROM, outermost first:\n${path
        .map((p, i) => `--- ${i + 1}. ${p.label}\n${p.text}`)
        .join("\n")}\n---`
    : "";
  const others = req.others?.length
    ? `\n\nTHE SHEET'S OTHER BRANCHES:\n${req.others.map((o) => `- ${o.label}${o.ask ? `: ${o.ask}` : ""}`).join("\n")}`
    : "";
  const userContent = `Topic: ${req.topic}

THE SHEET AS IT STANDS:
---
${plainSheet(plan, req.sections)}
---

THE LINE IT GROWS FROM (${section?.title ?? anchorKey}):
${line}${ancestors}${others}

THE QUESTION: ${q.ask}`;

  return { systemPrompt, userContent };
}
