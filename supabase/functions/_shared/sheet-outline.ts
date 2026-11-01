/**
 * The shape of a topic, decided before its sheet is planned — and the warm-up
 * for the wait.
 *
 * Most curriculum titles are not one thing. "Neonatal Assessment & Common
 * Neonatal Conditions", "Childhood Cancers — ALL, Wilms' & Neuroblastoma" and
 * "Hepatitis — Viral (A, B, C, D, E)" are a family or a set of look-alikes,
 * and the archetype template cuts each member across every section: in one
 * saved neonatal sheet, jaundice was in six of seven sections and the
 * Overview opened on PPHN, because the template asks for "the core defect"
 * and a family has none. Sorted by shape, the 170 curriculum titles came out
 * 56 single, 34 linked, 46 look-alike sets and 34 families.
 *
 * Two small calls, each failing open:
 *
 *   - outlineSheet reads the topic and says what it is. A group is taught
 *     block by block — a map, one block per member under the same labels,
 *     then a table that tells them apart (sheet-plan.ts resolveShapedPlan).
 *     One thing keeps its archetype's sections. The plan waits for it, so it
 *     is kept small; it runs beside the classifier and retrieval.
 *   - warmupFor writes two questions the sheet is about to answer, so the
 *     student is retrieving before they read (the pretesting effect). Nothing
 *     waits for it. It starts with the outline rather than after it — chained,
 *     it landed after the sheet had begun to stream — and each question names
 *     its subject, which attachBlocks matches to a block once both are in.
 *     Asked in the same call as the outline, the questions took it from about
 *     1.5 s to 5–6 s and held the writer back for all of it.
 *
 * A timeout, an error or a reply that does not validate returns null (or no
 * questions), and the sheet is planned and written exactly as before.
 * SHEET_OUTLINE=off turns both off.
 */
import { asCortiModel, cortiChatCompletion, cortiConfigFromEnv, type CortiModel } from "./corti.ts";

export type TopicShape = "single" | "linked" | "compare" | "survey";

export interface WarmupQuestion {
  /** The stem. */
  q: string;
  /** 3 or 4 options. */
  options: string[];
  /** Index of the right option. */
  answer: number;
  /** One sentence on why. */
  why: string;
  /** The block that teaches it, when the sheet has blocks. */
  block?: string;
}

export interface SheetOutline {
  shape: TopicShape;
  /** compare and survey: what orders the blocks ("timing after birth"). */
  axis: string;
  /** compare and survey: the blocks, in teaching order. */
  blocks: { name: string; labels: string[] }[];
  /** compare and survey: the tell-apart table's headers. */
  columns: string[];
}

/** The outline as the page receives it: what is coming. */
export interface WireOutline {
  shape: TopicShape;
  axis: string;
  blocks: string[];
}

/** Whether a shape is taught block by block. */
export const isGroupShape = (shape: TopicShape) => shape === "compare" || shape === "survey";

/**
 * The strongest non-reasoning model, as the archetype classifier uses: a bad
 * outline gives the whole sheet the wrong blocks, and a wrong warm-up answer
 * teaches the wrong fact. Overridable with CORTI_OUTLINE_MODEL.
 */
const DEFAULT_OUTLINE_MODEL: CortiModel = "corti-s1-instant";

/**
 * Past this the sheet is planned without an outline rather than kept waiting.
 * Measured at 1.1–2.6 s alone and about 5 s with four sheets in flight, when
 * a 6 s limit dropped two of twelve back to their archetype plan.
 */
const OUTLINE_TIMEOUT_MS = 8_000;
/** The warm-up holds nothing up, so it may take longer; past this it is dropped. */
const WARMUP_TIMEOUT_MS = 15_000;

const MAX_INPUT_CHARS = 600;
export const MAX_BLOCKS = 5;

/**
 * The labels a block takes when the outline's own don't validate: the
 * illness-script order, which is how clinicians hold a disease.
 */
export const DEFAULT_BLOCK_LABELS = ["Who and when", "Why it happens", "How it shows up", "How to confirm", "How to treat"];
export const DEFAULT_COLUMNS = ["Condition", "What points to it", "Confirm or first step"];

const OUTLINE_PROMPT = `You plan a medical study sheet before it is written. Read the topic and reply with JSON only.

"shape" is one of:
- "single": one disease, drug, organism, structure, test or process.
- "linked": two or three things that are one story (a disease and its complication or its treatment, a cause and its effect), best taught as one narrative.
- "compare": two to four named look-alikes a student must tell apart.
- "survey": a family or umbrella of many items (e.g. "common neonatal conditions", "congenital anomalies").

For "compare" and "survey" only:
- "blocks": the sheet's blocks in teaching order, 2 to ${MAX_BLOCKS}, each name under 100 characters. Together they must cover every part the title names and the members the exam tests most — a sheet that leaves out half its title has failed. When there are more members than blocks, group close relatives into one block and name them in it (e.g. "Respiratory distress — RDS, TTN, meconium aspiration", "Cyanotic — the 5 Ts: TOF, TGA, truncus, tricuspid atresia, TAPVR") rather than dropping them. If the topic names an assessment or approach as well as conditions, the approach is the first block.
- "axis": the one organising idea that orders the blocks (timing, age, mechanism, site, severity), as a short phrase.
- "labels": 3 to 5 labels every block uses, in the same order, so the blocks read in parallel. For diseases use an illness-script order such as: Who and when, Why it happens, How it shows up, How to confirm, How to treat. For items that are not diseases, labels that fit them (e.g. for milestones by age band: Gross motor, Fine motor, Language, Social, Red flags). Plain words only, 1 to 3 words each, starting with a capital letter.
- "ownLabels": for a block that is not a condition (an assessment, a screening programme, an approach), its own 3 to 5 labels, keyed by the block's name. {} when every block is a condition.
- "columns": 3 headers for a table with one row per block: the first names what each row is (e.g. "Condition"), the other two the discriminators (e.g. "Classic clue", "Confirm with").

Reply with exactly this JSON:
{"shape":"…","axis":"…","blocks":["…"],"labels":["…"],"ownLabels":{},"columns":["…","…","…"]}
For "single" and "linked": "blocks", "labels" and "columns" are [], "axis" is "" and "ownLabels" is {}.`;

const WARMUP_PROMPT = `You write two warm-up questions a medical student answers from memory in the seconds before reading a study sheet. A guess before reading makes the answer stick when it is read, so each question must be about a fact the sheet will teach.

Rules:
- Each question is about a classic, uncontroversial, high-yield fact for the exam named — never a trick, never a fact that is debated, regional or recently changed.
- Exactly one option is correct, and the others are plausible but clearly wrong to someone who knows the fact.
- If the topic covers several conditions, the two questions are about two different ones.
- "about" names the condition or part of the topic the question tests, in 1 to 4 words (e.g. "neonatal jaundice", "epiglottitis").

Reply with JSON only:
{"warmup":[{"q":"<under 140 characters>","options":["<3 or 4, each under 60 characters>"],"answer":<index of the correct option>,"why":"<one sentence under 160 characters>","about":"<1 to 4 words>"}]}`;

/**
 * A label the renderer will bold: it matches the head-of-line label the page
 * looks for (OutputSection's SECTION_LABEL_RE), so a block reads like every
 * other prose section.
 */
const LABEL_RE = /^[A-Z][A-Za-z][A-Za-z ,/&-]{0,28}$/;

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : null;
};

const jsonIn = (text: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

function asLabels(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const labels = v.map((l) => str(l, 30)).filter((l): l is string => !!l && LABEL_RE.test(l));
  const unique = [...new Set(labels)];
  return unique.length >= 3 && unique.length === v.length ? unique.slice(0, 5) : null;
}

/**
 * The outline, validated, or null when the reply is not usable at all. A
 * group whose blocks don't validate is read as a single topic — the sheet it
 * gets is today's — rather than dropped.
 */
export function parseOutline(text: string): SheetOutline | null {
  const raw = jsonIn(text);
  if (!raw) return null;
  const shapes: TopicShape[] = ["single", "linked", "compare", "survey"];
  let shape = shapes.includes(raw.shape as TopicShape) ? (raw.shape as TopicShape) : null;
  if (!shape) return null;

  let blocks: SheetOutline["blocks"] = [];
  let axis = "";
  let columns: string[] = [];
  if (isGroupShape(shape)) {
    const names = Array.isArray(raw.blocks)
      ? [...new Set(raw.blocks.map((b) => str(b, 120)).filter((b): b is string => !!b))].slice(0, MAX_BLOCKS)
      : [];
    if (names.length < 2) {
      shape = "single";
    } else {
      const shared = asLabels(raw.labels) ?? DEFAULT_BLOCK_LABELS;
      const own = raw.ownLabels && typeof raw.ownLabels === "object" ? (raw.ownLabels as Record<string, unknown>) : {};
      blocks = names.map((name) => ({ name, labels: asLabels(own[name]) ?? shared }));
      axis = str(raw.axis, 80) ?? "";
      const cols = Array.isArray(raw.columns) ? raw.columns.map((c) => str(c, 40)) : [];
      columns = cols.length >= 2 && cols.length <= 4 && cols.every(Boolean) ? (cols as string[]) : DEFAULT_COLUMNS;
    }
  }
  return { shape, axis, blocks, columns };
}

/** A warm-up question as written, before it is matched to a block. */
export interface DraftQuestion extends Omit<WarmupQuestion, "block"> {
  /** What it tests, in a few words, for matching to a block. */
  about: string;
}

/** The warm-up, validated: at most two questions that hold together. */
export function parseWarmup(text: string): DraftQuestion[] {
  const raw = jsonIn(text);
  const list = Array.isArray(raw?.warmup) ? (raw!.warmup as unknown[]) : [];
  const out: DraftQuestion[] = [];
  for (const item of list.slice(0, 2)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const q = str(r.q, 200);
    const why = str(r.why, 240);
    const options = Array.isArray(r.options) ? r.options.map((o) => str(o, 90)) : [];
    if (!q || !why || options.length < 3 || options.length > 4 || options.some((o) => !o)) continue;
    if (new Set(options).size !== options.length) continue;
    const answer = typeof r.answer === "number" && Number.isInteger(r.answer) ? r.answer : -1;
    if (answer < 0 || answer >= options.length) continue;
    out.push({ q, options: options as string[], answer, why, about: str(r.about, 60) ?? "" });
  }
  return out;
}

/** Words that say nothing about which member a question is on. */
const STOP = new Set(["the", "and", "with", "from", "into", "this", "that", "what", "which", "most", "common", "type", "types", "disease", "diseases", "syndrome", "disorder", "disorders", "condition", "conditions", "neonatal", "infant", "child", "children", "pediatric", "paediatric"]);
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
  );

/**
 * Each question with the block that teaches it: the block whose name shares
 * the most words with what the question is about (its stem breaks a tie). No
 * block when nothing matches, and the page then names none.
 */
export function attachBlocks(drafts: DraftQuestion[], blocks: string[]): WarmupQuestion[] {
  return drafts.map(({ about, ...q }) => {
    const aboutWords = words(about);
    const stemWords = words(q.q);
    let best: { name: string; score: number } | null = null;
    for (const name of blocks) {
      const nameWords = words(name);
      let score = 0;
      for (const w of nameWords) {
        if (aboutWords.has(w)) score += 10;
        else if (stemWords.has(w)) score += 1;
      }
      if (score > 0 && (!best || score > best.score)) best = { name, score };
    }
    return best ? { ...q, block: best.name } : q;
  });
}

export function toWireOutline(o: SheetOutline): WireOutline {
  return { shape: o.shape, axis: o.axis, blocks: o.blocks.map((b) => b.name) };
}

export interface OutlineResult {
  outline: SheetOutline | null;
  ms: number;
  /** Why it came back empty, for the logs. Null on success. */
  error: string | null;
}

/**
 * One JSON completion from the outline model, bounded by `timeoutMs`. Null
 * content on any failure.
 *
 * Raced against a timer rather than only aborted by it, as the archetype
 * classifier is: the Corti token exchange happens before the request and
 * carries no signal, and on a stalled exchange an abort-only limit let one
 * sheet's plan wait 52 s.
 */
async function ask(system: string, user: string, maxTokens: number, timeoutMs: number): Promise<{ text: string | null; error: string | null }> {
  const model = asCortiModel(Deno.env.get("CORTI_OUTLINE_MODEL"), DEFAULT_OUTLINE_MODEL);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<{ text: null; error: string }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ text: null, error: "timeout" });
    }, timeoutMs);
  });
  const attempt = (async (): Promise<{ text: string | null; error: string | null }> => {
    const res = await cortiChatCompletion(cortiConfigFromEnv(), {
      model,
      temperature: 0,
      maxTokens,
      json: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      signal: controller.signal,
    });
    if (!res.ok) return { text: null, error: `http_${res.status}` };
    const body = await res.json();
    const text = body?.choices?.[0]?.message?.content;
    return typeof text === "string" ? { text, error: null } : { text: null, error: "empty" };
  })().catch((err: unknown) => ({ text: null, error: err instanceof Error ? err.message : String(err) }));
  try {
    return await Promise.race([attempt, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

const topicLine = (topic: string, examMode?: string, difficulty?: string) =>
  `Topic: ${topic.trim().slice(0, MAX_INPUT_CHARS)}\nExam: ${examMode || "General"} | Difficulty: ${difficulty || "Intermediate"}`;

const disabled = () => Deno.env.get("SHEET_OUTLINE") === "off";

export async function outlineSheet(topic: string, examMode?: string, difficulty?: string): Promise<OutlineResult> {
  const startedAt = Date.now();
  if (disabled()) return { outline: null, ms: 0, error: "disabled" };
  const { text, error } = await ask(OUTLINE_PROMPT, topicLine(topic, examMode, difficulty), 500, OUTLINE_TIMEOUT_MS);
  const outline = text ? parseOutline(text) : null;
  return { outline, ms: Date.now() - startedAt, error: outline ? null : error ?? "unreadable" };
}

/** Two warm-up questions for this topic, not yet matched to blocks. Empty on any failure. */
export async function warmupFor(topic: string, examMode?: string, difficulty?: string): Promise<DraftQuestion[]> {
  if (disabled()) return [];
  const { text } = await ask(WARMUP_PROMPT, topicLine(topic, examMode, difficulty), 700, WARMUP_TIMEOUT_MS);
  return text ? parseWarmup(text) : [];
}
