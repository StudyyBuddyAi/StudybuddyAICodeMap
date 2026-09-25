import type { Flashcard, GeneratedSheet, SectionBody } from "@/types/generated-sheet";
import { resolvePlan, sectionBody } from "@/lib/sheet-plan";

/**
 * A student's own layer over a generated sheet.
 *
 * The sheet itself is never rewritten. What the student does to it — the
 * lines they highlight and why, the lines they rewrite or have the AI rewrite,
 * the points they add, the notes they leave, what they already know — lives
 * here, beside it, keyed by the same `section:index` anchors the renderer
 * already puts on every line, item and row. So "show original" is always one
 * toggle away, a "verified sources" badge never ends up vouching for words the
 * student wrote, and a saved sheet's layer can be loaded, saved and migrated
 * on its own.
 *
 * Anchors: `${sectionKey}:${index}` for a prose line (its index in the body
 * split on "\n", blank lines included — the renderer's own count), a list
 * item or a table row; `${sectionKey}:end` for the section as a whole.
 *
 * Every operation here is pure: it takes a layer and returns a new one.
 */

/** Why a passage was marked. The colour follows from the reason, not the other way round. */
export type HighlightIntent = "key" | "confusing" | "memorize";

export const HIGHLIGHT_INTENTS: readonly HighlightIntent[] = ["key", "confusing", "memorize"];

/** Who wrote a piece of the layer: the student, or an AI action they accepted. */
export type LayerSource = "user" | "ai";

export interface LayerHighlight {
  id: string;
  anchor: string;
  /** The highlighted text exactly as it read on screen (bold markers stripped). */
  quote: string;
  /** Which occurrence of `quote` in the line, 0-based, when it appears more than once. */
  occurrence: number;
  intent: HighlightIntent;
  at: string;
}

export interface LayerEdit {
  anchor: string;
  text: string;
  source: LayerSource;
  /** What the line said when it was edited, so a changed original is detectable. */
  original: string;
  at: string;
}

/** A point the student added to a section, after its own items. */
export interface LayerAddition {
  id: string;
  section: string;
  text: string;
  source: LayerSource;
  at: string;
}

export interface LayerNote {
  id: string;
  /** A line, item or row anchor, or `${section}:end` for the section. */
  anchor: string;
  text: string;
  /** "ai" for an explanation the student asked for. */
  source: LayerSource;
  at: string;
}

/** A flashcard made from the sheet, and already added to the student's deck. */
export interface LayerCard {
  id: string;
  question: string;
  answer: string;
  anchor: string;
  at: string;
}

export interface SheetLayer {
  v: 1;
  highlights: LayerHighlight[];
  /** At most one per anchor. */
  edits: Record<string, LayerEdit>;
  additions: LayerAddition[];
  notes: LayerNote[];
  /** Anchors the student marked as already known. */
  known: string[];
  /** Anchors the student removed from their view of the sheet. */
  hidden: string[];
  cards: LayerCard[];
}

export const EMPTY_LAYER: SheetLayer = Object.freeze({
  v: 1,
  highlights: [],
  edits: {},
  additions: [],
  notes: [],
  known: [],
  hidden: [],
  cards: [],
}) as SheetLayer;

export const emptyLayer = (): SheetLayer => ({
  v: 1,
  highlights: [],
  edits: {},
  additions: [],
  notes: [],
  known: [],
  hidden: [],
  cards: [],
});

/** Caps that keep one sheet's layer a sane size in a row or in localStorage. */
export const LAYER_LIMITS = {
  items: 400,
  text: 2000,
  quote: 600,
} as const;

export function newLayerId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

const now = () => new Date().toISOString();

export const anchorOf = (section: string, index: number | "end") => `${section}:${index}`;

/** The section an anchor belongs to. */
export const anchorSection = (anchor: string) => anchor.slice(0, anchor.lastIndexOf(":"));

// ── Validation ───────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number = LAYER_LIMITS.text): string | null =>
  typeof v === "string" ? v.slice(0, max) : null;
const src = (v: unknown): LayerSource => (v === "ai" ? "ai" : "user");
const ANCHOR_RE = /^[A-Za-z][A-Za-z0-9_]*:(\d+|end)$/;
const validAnchor = (v: unknown): v is string => typeof v === "string" && ANCHOR_RE.test(v);

/**
 * A layer as read back from the database or localStorage, where anything may
 * have been written. Malformed entries are dropped one by one rather than
 * throwing the whole layer away.
 */
export function parseLayer(raw: unknown): SheetLayer {
  const layer = emptyLayer();
  if (!isObj(raw)) return layer;
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, LAYER_LIMITS.items) : []);

  for (const h of list(raw.highlights)) {
    if (!isObj(h) || !validAnchor(h.anchor)) continue;
    const quote = str(h.quote, LAYER_LIMITS.quote);
    const intent = HIGHLIGHT_INTENTS.includes(h.intent as HighlightIntent) ? (h.intent as HighlightIntent) : null;
    if (!quote?.trim() || !intent) continue;
    layer.highlights.push({
      id: str(h.id, 64) || newLayerId(),
      anchor: h.anchor,
      quote,
      occurrence: typeof h.occurrence === "number" && h.occurrence >= 0 ? Math.floor(h.occurrence) : 0,
      intent,
      at: str(h.at, 40) || now(),
    });
  }

  if (isObj(raw.edits)) {
    for (const [anchor, e] of Object.entries(raw.edits).slice(0, LAYER_LIMITS.items)) {
      if (!validAnchor(anchor) || !isObj(e)) continue;
      const text = str(e.text);
      if (text === null) continue;
      layer.edits[anchor] = {
        anchor,
        text,
        source: src(e.source),
        original: str(e.original) ?? "",
        at: str(e.at, 40) || now(),
      };
    }
  }

  for (const a of list(raw.additions)) {
    if (!isObj(a) || typeof a.section !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(a.section)) continue;
    const text = str(a.text);
    if (!text?.trim()) continue;
    layer.additions.push({ id: str(a.id, 64) || newLayerId(), section: a.section, text, source: src(a.source), at: str(a.at, 40) || now() });
  }

  for (const n of list(raw.notes)) {
    if (!isObj(n) || !validAnchor(n.anchor)) continue;
    const text = str(n.text);
    if (!text?.trim()) continue;
    layer.notes.push({ id: str(n.id, 64) || newLayerId(), anchor: n.anchor, text, source: src(n.source), at: str(n.at, 40) || now() });
  }

  layer.known = [...new Set(list(raw.known).filter(validAnchor))];
  layer.hidden = [...new Set(list(raw.hidden).filter(validAnchor))];

  for (const c of list(raw.cards)) {
    if (!isObj(c) || !validAnchor(c.anchor)) continue;
    const question = str(c.question);
    const answer = str(c.answer);
    if (!question?.trim() || !answer?.trim()) continue;
    layer.cards.push({ id: str(c.id, 64) || newLayerId(), question, answer, anchor: c.anchor, at: str(c.at, 40) || now() });
  }

  return layer;
}

export function isEmptyLayer(layer: SheetLayer): boolean {
  return (
    !layer.highlights.length &&
    !Object.keys(layer.edits).length &&
    !layer.additions.length &&
    !layer.notes.length &&
    !layer.known.length &&
    !layer.hidden.length &&
    !layer.cards.length
  );
}

export interface LayerSummary {
  highlights: number;
  edits: number;
  notes: number;
  additions: number;
  known: number;
  hidden: number;
  cards: number;
}

export function summarizeLayer(layer: SheetLayer): LayerSummary {
  return {
    highlights: layer.highlights.length,
    edits: Object.keys(layer.edits).length,
    notes: layer.notes.length,
    additions: layer.additions.length,
    known: layer.known.length,
    hidden: layer.hidden.length,
    cards: layer.cards.length,
  };
}

// ── Highlights ───────────────────────────────────────────────────────────────

/**
 * Marks a passage. Marking the same passage again changes why it was marked
 * rather than stacking a second highlight on it.
 */
export function addHighlight(
  layer: SheetLayer,
  h: { anchor: string; quote: string; occurrence?: number; intent: HighlightIntent }
): SheetLayer {
  const quote = h.quote.slice(0, LAYER_LIMITS.quote);
  if (!quote.trim() || !validAnchor(h.anchor)) return layer;
  const occurrence = h.occurrence ?? 0;
  const same = (x: LayerHighlight) => x.anchor === h.anchor && x.quote === quote && x.occurrence === occurrence;
  const existing = layer.highlights.find(same);
  if (existing) {
    return existing.intent === h.intent ? layer : setHighlightIntent(layer, existing.id, h.intent);
  }
  if (layer.highlights.length >= LAYER_LIMITS.items) return layer;
  return {
    ...layer,
    highlights: [...layer.highlights, { id: newLayerId(), anchor: h.anchor, quote, occurrence, intent: h.intent, at: now() }],
  };
}

export function setHighlightIntent(layer: SheetLayer, id: string, intent: HighlightIntent): SheetLayer {
  return { ...layer, highlights: layer.highlights.map((h) => (h.id === id ? { ...h, intent } : h)) };
}

export function removeHighlight(layer: SheetLayer, id: string): SheetLayer {
  return { ...layer, highlights: layer.highlights.filter((h) => h.id !== id) };
}

/** Case-insensitive start of the nth occurrence of `needle` in `hay`, or -1. */
function nthIndexOf(hay: string, needle: string, n: number): number {
  const h = hay.toLowerCase();
  const nd = needle.toLowerCase();
  let at = -1;
  for (let i = 0; i <= n; i++) {
    at = h.indexOf(nd, at + 1);
    if (at === -1) return -1;
  }
  return at;
}

export interface HighlightRange {
  start: number;
  end: number;
  id: string;
  intent: HighlightIntent;
}

/**
 * Where each of a line's highlights falls in its visible text. A highlight
 * whose quote no longer appears there is skipped rather than guessed at; one
 * whose occurrence has gone falls back to the first.
 */
export function highlightRanges(visible: string, highlights: LayerHighlight[]): HighlightRange[] {
  const out: HighlightRange[] = [];
  for (const h of highlights) {
    let at = nthIndexOf(visible, h.quote, h.occurrence);
    if (at === -1 && h.occurrence > 0) at = nthIndexOf(visible, h.quote, 0);
    if (at === -1) continue;
    out.push({ start: at, end: at + h.quote.length, id: h.id, intent: h.intent });
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

/** How many times `quote` occurs in `before` — the occurrence index of a selection that starts after it. */
export function occurrenceBefore(before: string, quote: string): number {
  if (!quote) return 0;
  const h = before.toLowerCase();
  const q = quote.toLowerCase();
  let count = 0;
  let at = h.indexOf(q);
  while (at !== -1) {
    count++;
    at = h.indexOf(q, at + 1);
  }
  return count;
}

// ── Edits ────────────────────────────────────────────────────────────────────

const visibleOf = (s: string) => s.replace(/\*\*/g, "");

/**
 * Rewrites one line or item. Writing it back to exactly what it said removes
 * the edit. Highlights on the line whose text is gone go with it — a highlight
 * left pointing at words that no longer exist would silently vanish anyway.
 */
export function setEdit(
  layer: SheetLayer,
  e: { anchor: string; text: string; source: LayerSource; original: string }
): SheetLayer {
  if (!validAnchor(e.anchor)) return layer;
  const text = e.text.slice(0, LAYER_LIMITS.text);
  const edits = { ...layer.edits };
  if (text.trim() === e.original.trim()) delete edits[e.anchor];
  else edits[e.anchor] = { anchor: e.anchor, text, source: e.source, original: e.original, at: now() };
  const effective = visibleOf(edits[e.anchor]?.text ?? e.original);
  const highlights = layer.highlights.filter(
    (h) => h.anchor !== e.anchor || nthIndexOf(effective, h.quote, 0) !== -1
  );
  return { ...layer, edits, highlights };
}

export function removeEdit(layer: SheetLayer, anchor: string): SheetLayer {
  if (!layer.edits[anchor]) return layer;
  const edits = { ...layer.edits };
  delete edits[anchor];
  return { ...layer, edits };
}

/** A line's text as the student sees it: their edit, or what was generated. */
export const effectiveText = (layer: SheetLayer, anchor: string, original: string) =>
  layer.edits[anchor]?.text ?? original;

// ── Additions, notes, known, hidden, cards ───────────────────────────────────

export function addAddition(layer: SheetLayer, section: string, text: string, source: LayerSource = "user"): SheetLayer {
  if (!text.trim() || layer.additions.length >= LAYER_LIMITS.items) return layer;
  return {
    ...layer,
    additions: [...layer.additions, { id: newLayerId(), section, text: text.slice(0, LAYER_LIMITS.text), source, at: now() }],
  };
}

export function updateAddition(layer: SheetLayer, id: string, text: string): SheetLayer {
  if (!text.trim()) return removeAddition(layer, id);
  return {
    ...layer,
    additions: layer.additions.map((a) => (a.id === id ? { ...a, text: text.slice(0, LAYER_LIMITS.text), source: "user" as const } : a)),
  };
}

export function removeAddition(layer: SheetLayer, id: string): SheetLayer {
  return { ...layer, additions: layer.additions.filter((a) => a.id !== id) };
}

export function addNote(layer: SheetLayer, anchor: string, text: string, source: LayerSource = "user"): SheetLayer {
  if (!text.trim() || !validAnchor(anchor) || layer.notes.length >= LAYER_LIMITS.items) return layer;
  return {
    ...layer,
    notes: [...layer.notes, { id: newLayerId(), anchor, text: text.slice(0, LAYER_LIMITS.text), source, at: now() }],
  };
}

export function updateNote(layer: SheetLayer, id: string, text: string): SheetLayer {
  if (!text.trim()) return removeNote(layer, id);
  return {
    ...layer,
    notes: layer.notes.map((n) => (n.id === id ? { ...n, text: text.slice(0, LAYER_LIMITS.text), source: "user" as const } : n)),
  };
}

export function removeNote(layer: SheetLayer, id: string): SheetLayer {
  return { ...layer, notes: layer.notes.filter((n) => n.id !== id) };
}

const toggle = (list: string[], anchor: string) =>
  list.includes(anchor) ? list.filter((a) => a !== anchor) : [...list, anchor];

export function toggleKnown(layer: SheetLayer, anchor: string): SheetLayer {
  return validAnchor(anchor) ? { ...layer, known: toggle(layer.known, anchor) } : layer;
}

export function toggleHidden(layer: SheetLayer, anchor: string): SheetLayer {
  return validAnchor(anchor) ? { ...layer, hidden: toggle(layer.hidden, anchor) } : layer;
}

export function addCard(layer: SheetLayer, card: { question: string; answer: string; anchor: string }): SheetLayer {
  if (!card.question.trim() || !card.answer.trim() || layer.cards.length >= LAYER_LIMITS.items) return layer;
  return {
    ...layer,
    cards: [
      ...layer.cards,
      {
        id: newLayerId(),
        question: card.question.slice(0, LAYER_LIMITS.text),
        answer: card.answer.slice(0, LAYER_LIMITS.text),
        anchor: card.anchor,
        at: now(),
      },
    ],
  };
}

export function removeCard(layer: SheetLayer, id: string): SheetLayer {
  return { ...layer, cards: layer.cards.filter((c) => c.id !== id) };
}

/**
 * What the sheet itself says at an anchor: a prose line (trimmed), a list item,
 * or a table row's cells joined. Null for a section-level anchor or one the
 * sheet has no line for.
 */
export function originalLine(sheet: GeneratedSheet, anchor: string): string | null {
  const m = /^(.+):(\d+)$/.exec(anchor);
  if (!m) return null;
  const body = sectionBody(sheet, m[1]);
  const i = Number(m[2]);
  if (typeof body === "string") return body.split("\n")[i]?.trim() || null;
  const item = body?.[i];
  if (item === undefined) return null;
  return Array.isArray(item) ? item.join(" | ") : item;
}

// ── The sheet as the student has made it ─────────────────────────────────────

/**
 * The sheet with the student's layer applied: their edits in place of the
 * lines they rewrote, the lines they removed gone, the points they added
 * appended, and their cards in the deck. For everything that takes the sheet
 * as text — export, share, the QBank hand-off. The renderer does not use it:
 * it shows the layer in place, marked as the student's.
 */
export function applyLayer(sheet: GeneratedSheet, layer: SheetLayer): GeneratedSheet {
  if (isEmptyLayer(layer)) return sheet;
  const out: GeneratedSheet = { ...sheet, sections: { ...(sheet.sections ?? {}) } };
  const legacy = out as unknown as Record<string, unknown>;
  const hidden = new Set(layer.hidden);

  for (const { key } of resolvePlan(sheet)) {
    const body = sectionBody(sheet, key);
    if (body === undefined) continue;
    const added = layer.additions.filter((a) => a.section === key).map((a) => a.text);
    let next: SectionBody;

    if (typeof body === "string") {
      const lines = body
        .split("\n")
        .map((line, i) => ({ line, anchor: anchorOf(key, i) }))
        .filter(({ anchor }) => !hidden.has(anchor))
        .map(({ line, anchor }) => (line.trim() ? effectiveText(layer, anchor, line) : line));
      next = [...lines, ...added].join("\n");
    } else if (body.length && Array.isArray(body[0])) {
      next = (body as string[][]).filter((_, i) => !hidden.has(anchorOf(key, i)));
    } else {
      const items = (body as string[])
        .map((item, i) => ({ item, anchor: anchorOf(key, i) }))
        .filter(({ anchor }) => !hidden.has(anchor))
        .map(({ item, anchor }) => effectiveText(layer, anchor, item));
      next = [...items, ...added];
    }

    out.sections![key] = next;
    if (key in legacy) legacy[key] = next;
  }

  if (layer.cards.length) {
    const mine: Flashcard[] = layer.cards.map((c) => ({ tag: "Mine", question: c.question, answer: c.answer }));
    out.flashcards = [...(sheet.flashcards ?? []), ...mine];
  }
  return out;
}

/**
 * The student's notes as text, section by section, for the end of an export.
 * Empty when there are none.
 */
export function layerNotesText(sheet: GeneratedSheet, layer: SheetLayer): string {
  if (!layer.notes.length) return "";
  const titles = new Map(resolvePlan(sheet).map((s) => [s.key, s.title]));
  const lines = layer.notes.map((n) => {
    const title = titles.get(anchorSection(n.anchor)) ?? anchorSection(n.anchor);
    return `- ${title}${n.source === "ai" ? " (AI explanation)" : ""}: ${n.text.replace(/\s*\n\s*/g, " ")}`;
  });
  return `My notes\n${lines.join("\n")}`;
}

/**
 * What the student wants to drill, for a QBank set: the passages they marked
 * confusing or to memorise, most recent first, as one short line. Empty when
 * they marked none.
 */
export function practiceFocus(layer: SheetLayer, maxChars = 220): string {
  const quotes = layer.highlights
    .filter((h) => h.intent === "confusing" || h.intent === "memorize")
    .slice()
    .reverse()
    .map((h) => h.quote.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const picked: string[] = [];
  let used = 0;
  for (const q of quotes) {
    const clipped = q.length > 80 ? `${q.slice(0, 77)}…` : q;
    if (picked.some((p) => p.toLowerCase() === clipped.toLowerCase())) continue;
    if (used + clipped.length + 2 > maxChars) break;
    picked.push(clipped);
    used += clipped.length + 2;
  }
  return picked.join("; ");
}
