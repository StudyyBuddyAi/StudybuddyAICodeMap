/**
 * A deck written from the student's own material instead of from a topic.
 *
 * Early-access feedback asked for flashcards that come from what the student
 * studied — their sheet, and the explanations of the QBank questions they
 * answered — "because the point of flashcards is to remember and review the
 * QBank". Two sources, one request field (`deckSource`):
 *
 *   sheet — the sheet as the student has it, with the signatures the server
 *   put on its sections (sheet-signature.ts). Only a sheet whose signatures
 *   check is written from: trusted as sent, a made-up "sheet" would turn the
 *   card writer into a free model for anything. An unsigned one (saved before
 *   signing) gets an ordinary deck on its topic instead.
 *
 *   qbank — question ids. The server reads the questions itself, and only
 *   those the student has answered: the key and explanation are never served
 *   before grading, and must not leak through a deck either.
 *
 * And `cardSlice`, which keeps one of several parallel requests for a large
 * deck to its own kinds of card, so the batches don't write the same deck
 * three times.
 *
 * No Deno API here, so the app's tests run it.
 */
import { MAX_SECTIONS, parsePlanHints, resolvePlanFromKeys, type PlanHints } from "./sheet-plan.ts";
import { SECTIONS } from "./sheet-sections.ts";
import { SECTION_LIMITS, asBody, sheetAsText, type Body } from "./sheet-section-prompts.ts";
import { parseSignature, sentSections, type SheetSignature } from "./sheet-signature.ts";
import type { SheetSectionBody } from "./sheet-text.ts";

/** Questions one deck may be written from — a full exam block. */
export const MAX_DECK_QUESTIONS = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SheetDeckSource {
  kind: "sheet";
  plan: string[];
  sections: Record<string, Body>;
  topic: string;
  hints: PlanHints;
  signature: SheetSignature | null;
  /** The sections exactly as sent, for the signature check. */
  sent: Record<string, SheetSectionBody>;
}

export interface QBankDeckSource {
  kind: "qbank";
  questionIds: string[];
}

export type DeckSource = SheetDeckSource | QBankDeckSource;

/** The request's `deckSource`, validated; null when it names nothing usable. */
export function parseDeckSource(raw: unknown): DeckSource | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  if (r.kind === "qbank") {
    if (!Array.isArray(r.questionIds)) return null;
    const ids = [...new Set(r.questionIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)))];
    return ids.length ? { kind: "qbank", questionIds: ids.slice(0, MAX_DECK_QUESTIONS) } : null;
  }

  if (r.kind === "sheet") {
    if (!Array.isArray(r.plan)) return null;
    const plan = [...new Set(r.plan.filter((k): k is string => typeof k === "string" && !!SECTIONS[k]))].slice(0, MAX_SECTIONS);
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
    const topic = typeof r.topic === "string" ? r.topic.replace(/\s+/g, " ").trim().slice(0, SECTION_LIMITS.topic) : "";
    if (!topic) return null;
    return {
      kind: "sheet",
      plan,
      sections,
      topic,
      hints: parsePlanHints(r.hints),
      signature: parseSignature(r.signature),
      sent: sentSections(rawSections, plan),
    };
  }

  return null;
}

/** The sheet as text for the card writer, in its own section order. */
export function sheetMaterial(source: SheetDeckSource, examMode?: string): string {
  const plan = resolvePlanFromKeys(source.plan, examMode, source.hints, source.sections);
  return sheetAsText(plan, source.sections);
}

/** A question as stored, with what grading reveals. */
export interface AnsweredQuestion {
  id: string;
  topic: string | null;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string;
  correct_option: string;
  explanation: string | null;
  teaching_point: string | null;
  distractor_explanations: Record<string, string> | null;
}

const strip = (s: string | null | undefined) => (s ?? "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();

/**
 * The answered questions as text for the card writer: what was asked, the
 * right answer, and the teaching — the explanation, its key point, and why
 * each wrong option was wrong. The full vignette stays out; a card tests the
 * idea, not the patient.
 */
export function qbankMaterial(questions: AnsweredQuestion[]): string {
  return questions
    .map((q, i) => {
      const options: Record<string, string> = { a: q.option_a, b: q.option_b, c: q.option_c, d: q.option_d, e: q.option_e };
      const key = q.correct_option?.toLowerCase();
      const wrong = Object.entries(q.distractor_explanations ?? {})
        .filter(([letter, text]) => letter !== key && text)
        .map(([letter, text]) => `  - ${strip(options[letter]) || letter.toUpperCase()}: ${strip(text)}`)
        .join("\n");
      // Stored as the vignette, a blank line, and the lead-in (qbank-persist.ts).
      const leadIn = strip((q.question_text ?? "").split(/\n\s*\n/).pop());
      return [
        `## Question ${i + 1}${q.topic ? ` — ${strip(q.topic)}` : ""}`,
        leadIn && `Asked: ${leadIn}`,
        `Correct answer: ${strip(options[key])}`,
        q.explanation && `Explanation: ${strip(q.explanation)}`,
        q.teaching_point && `Key teaching point: ${strip(q.teaching_point)}`,
        wrong && `Why the other options were wrong:\n${wrong}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

/** The prompt block that takes retrieval's place when a deck has a source. */
export function studyMaterialBlock(kind: DeckSource["kind"], text: string): string {
  const what =
    kind === "sheet"
      ? "the student's own study sheet on this topic"
      : "the QBank questions the student just answered — what each asked, the right answer, and its explanation";
  const coverage =
    kind === "sheet"
      ? "- Cover the sheet: draw cards from every section that has content, not only the first ones."
      : "- Cover every question: one or two cards each, on the idea its explanation and key teaching point teach. Never copy the vignette or ask the question again as written.";
  return `Context — ${what}:
---
${text}
---
Rules:
- Write every card from this material. It is what the student studied, and the deck is for remembering it.
- Do not add facts the material does not contain, and never contradict it.
${coverage}
- Tag every card [Grounded].`;
}

/**
 * The kinds of card one batch of a large deck keeps to, by the clinical tags
 * the card prompt already uses. A Map, as CARD_FOCUS is: the key comes from
 * the request body. Together the three cover every tag once.
 */
export const CARD_SLICES = new Map<string, string>([
  ["recognise", "This deck is one part of a larger one. Write only [Diagnosis] and [Association] cards."],
  ["explain", "This deck is one part of a larger one. Write only [Mechanism] cards."],
  ["manage", "This deck is one part of a larger one. Write only [Next Step] and [Complication] cards."],
]);

export const CARD_SLICE_KEYS = [...CARD_SLICES.keys()];

export function cardSliceLine(value: unknown): string {
  const line = typeof value === "string" ? CARD_SLICES.get(value) : undefined;
  return line ? `\n${line}` : "";
}
