import type { Flashcard, GeneratedSheet, SectionBody } from "@/types/generated-sheet";
import { resolvePlan, sectionBody } from "@/lib/sheet-plan";
import type { BranchQuestion, BranchType } from "@/lib/sheet-branches";

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
 * Branches live here too (src/lib/sheet-branches.ts): the questions the sheet
 * suggests growing from its lines, and each branch grown — by the AI or by the
 * student — kept as markdown and anchored to the line it grew from.
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

/**
 * A section the student had written after the sheet was: rewritten in a
 * direction they picked. It is generated content — held here because a saved
 * sheet's row is never changed, so "Original" still shows the sheet as it was
 * made. ("depth" is a section's depth under `<key>_more`, from before branches
 * replaced it; nothing writes or shows one now.)
 */
export interface LayerSection {
  body: SectionBody;
  kind: "depth" | "rewrite";
  /** rewrite only: the direction it took. */
  style?: string;
  at: string;
}

/** A branch the sheet suggests growing from one of its lines: a pill. */
export interface LayerPill extends BranchQuestion {
  id: string;
  anchor: string;
}

/**
 * A branch: the answer to one question about one line of the sheet, or about
 * the branch it grew from. Kept as markdown, whatever shape it arrived in.
 */
export interface LayerBranch {
  id: string;
  /** The line of the sheet it grows from, or `${section}:end` once that section was rewritten. */
  anchor: string;
  /** The branch it grew from; absent for one grown from the sheet. */
  parentId?: string;
  type: BranchType;
  label: string;
  /** The question it answers. */
  ask: string;
  versus?: string;
  text: string;
  /** What it suggests growing next. */
  next: BranchQuestion[];
  /** Who wrote it: the AI, or the student ("note"). An AI branch the student edits stays "ai", marked edited. */
  source: LayerSource;
  edited?: boolean;
  /** Whether the sheet's passages backed it. */
  covered?: boolean;
  /** The pill it was grown from. */
  pillId?: string;
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
  /** Depth and rewrites, by the key they are written under. */
  sections: Record<string, LayerSection>;
  /** The branches the sheet suggests, in the order suggested. */
  pills: LayerPill[];
  /** When the suggestions arrived; absent until they have, so they are asked for once. */
  suggestedAt?: string;
  /** A comprehensive sheet's first branches have been grown, so they are not grown again. */
  picksGrown?: boolean;
  branches: LayerBranch[];
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
  sections: {},
  pills: [],
  branches: [],
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
  sections: {},
  pills: [],
  branches: [],
});

/** Caps that keep one sheet's layer a sane size in a row or in localStorage. */
export const LAYER_LIMITS = {
  items: 400,
  text: 2000,
  quote: 600,
  /** Sections: a sheet has at most seven, each with a core and a depth. */
  sections: 20,
  sectionItems: 30,
  pills: 60,
  branches: 200,
  branchText: 8000,
  prose: 8000,
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

  for (const x of list(raw.pills).slice(0, LAYER_LIMITS.pills)) {
    if (!isObj(x) || !validAnchor(x.anchor)) continue;
    const q = question(x);
    if (q) layer.pills.push({ ...q, id: str(x.id, 64) || newLayerId(), anchor: x.anchor });
  }
  if (typeof raw.suggestedAt === "string") layer.suggestedAt = raw.suggestedAt.slice(0, 40);
  if (raw.picksGrown === true) layer.picksGrown = true;

  const branchIds = new Set<string>();
  for (const b of list(raw.branches).slice(0, LAYER_LIMITS.branches)) {
    if (!isObj(b) || !validAnchor(b.anchor)) continue;
    const q = question(b, true);
    const text = str(b.text, LAYER_LIMITS.branchText);
    if (!q || text === null) continue;
    const id = str(b.id, 64) || newLayerId();
    branchIds.add(id);
    layer.branches.push({
      id,
      anchor: b.anchor,
      ...(typeof b.parentId === "string" ? { parentId: b.parentId.slice(0, 64) } : {}),
      ...q,
      text,
      next: (Array.isArray(b.next) ? b.next : []).slice(0, 3).map((n) => question(n)).filter((n): n is BranchQuestion => !!n),
      source: src(b.source),
      ...(b.edited === true ? { edited: true } : {}),
      ...(typeof b.covered === "boolean" ? { covered: b.covered } : {}),
      ...(typeof b.pillId === "string" ? { pillId: b.pillId.slice(0, 64) } : {}),
      at: str(b.at, 40) || now(),
    });
  }
  // A branch whose parent is gone has nothing to hang from.
  layer.branches = layer.branches.filter((b) => !b.parentId || branchIds.has(b.parentId));

  if (isObj(raw.sections)) {
    for (const [key, s] of Object.entries(raw.sections).slice(0, LAYER_LIMITS.sections)) {
      if (!SECTION_KEY_RE.test(key) || !isObj(s)) continue;
      const body = layerBody(s.body);
      if (body === null) continue;
      layer.sections[key] = {
        body,
        kind: s.kind === "rewrite" ? "rewrite" : "depth",
        ...(typeof s.style === "string" ? { style: s.style.slice(0, 20) } : {}),
        at: str(s.at, 40) || now(),
      };
    }
  }

  return layer;
}

const SECTION_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

const BRANCH_TYPES: readonly BranchType[] = ["mechanism", "management", "compare", "differential", "case", "ask", "note"];

/** A pill's or branch's question as read back; null when it is not one. `any` also admits the student's own types. */
function question(v: unknown, any = false): BranchQuestion | null {
  if (!isObj(v)) return null;
  const type = BRANCH_TYPES.includes(v.type as BranchType) ? (v.type as BranchType) : null;
  if (!type || (!any && (type === "ask" || type === "note"))) return null;
  const label = str(v.label, 80)?.trim();
  if (!label) return null;
  const versus = str(v.versus, 80)?.trim();
  return { type, label, ask: str(v.ask, 300) ?? "", ...(versus ? { versus } : {}) };
}

/** A section body as read back: prose, items or rows, trimmed to the caps; null for anything else. */
function layerBody(v: unknown): SectionBody | null {
  if (typeof v === "string") return v.slice(0, LAYER_LIMITS.prose);
  if (!Array.isArray(v)) return null;
  const items = v.slice(0, LAYER_LIMITS.sectionItems);
  if (items.length && items.every((x) => Array.isArray(x))) {
    return (items as unknown[][]).map((row) => row.slice(0, 4).map((c) => (typeof c === "string" ? c.slice(0, LAYER_LIMITS.text) : "")));
  }
  return items.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, LAYER_LIMITS.text));
}

export function isEmptyLayer(layer: SheetLayer): boolean {
  return (
    !layer.highlights.length &&
    !Object.keys(layer.edits).length &&
    !layer.additions.length &&
    !layer.notes.length &&
    !layer.known.length &&
    !layer.hidden.length &&
    !layer.cards.length &&
    !Object.keys(layer.sections).length &&
    !layer.pills.length &&
    !layer.branches.length
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
  branches: number;
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
    branches: layer.branches.length,
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

// ── Depth and rewrites ───────────────────────────────────────────────────────

/** Whether an anchor points at one of a key's lines (not the section as a whole). */
const onLineOf = (keys: string[]) => (anchor: string) => keys.includes(anchorSection(anchor)) && !anchor.endsWith(":end");

/**
 * What the student has anchored to a section's lines: highlights, edits,
 * notes, known and removed lines. A rewrite takes all of it away — the lines
 * it pointed at are gone — so the page asks first when this is not zero.
 */
export function anchoredTo(layer: SheetLayer, keys: string[]): number {
  const on = onLineOf(keys);
  return (
    layer.highlights.filter((h) => on(h.anchor)).length +
    Object.keys(layer.edits).filter(on).length +
    layer.notes.filter((n) => on(n.anchor)).length +
    layer.known.filter(on).length +
    layer.hidden.filter(on).length
  );
}

/**
 * A section written again. Its new bodies stand in for the sheet's, and what
 * was anchored to the old lines goes with them. Cards made from the section
 * stay: they are already in the deck.
 */
export function rewriteSection(layer: SheetLayer, bodies: Record<string, SectionBody>, style: string): SheetLayer {
  const keys = Object.keys(bodies).filter((k) => SECTION_KEY_RE.test(k));
  const off = (a: string) => !onLineOf(keys)(a);
  // Its branches stay — what they say still holds — but the lines they grew
  // from are gone, so they hang from the section instead. Its suggestions
  // named those lines, and go.
  const reanchor = (b: LayerBranch) => (off(b.anchor) ? b : { ...b, anchor: anchorOf(anchorSection(b.anchor), "end") });
  const edits: Record<string, LayerEdit> = {};
  for (const [a, e] of Object.entries(layer.edits)) if (off(a)) edits[a] = e;
  const sections = { ...layer.sections };
  for (const key of keys) sections[key] = { body: bodies[key], kind: "rewrite", style, at: now() };
  return {
    ...layer,
    sections,
    edits,
    highlights: layer.highlights.filter((h) => off(h.anchor)),
    notes: layer.notes.filter((n) => off(n.anchor)),
    known: layer.known.filter(off),
    hidden: layer.hidden.filter(off),
    pills: layer.pills.filter((p) => off(p.anchor)),
    branches: layer.branches.map(reanchor),
  };
}

/** Takes a key's depth or rewrite away, back to what the sheet had. */
export function removeLayerSection(layer: SheetLayer, keys: string[]): SheetLayer {
  if (!keys.some((k) => k in layer.sections)) return layer;
  const sections = { ...layer.sections };
  for (const k of keys) delete sections[k];
  return { ...layer, sections };
}

/**
 * The sheet with the student's depth and rewrites in place of, or beside, what
 * was generated. What the renderer, the exporter and the section requests
 * read. The layer's line operations then apply to this sheet's lines.
 */
export function withLayerSections(sheet: GeneratedSheet, layer: SheetLayer): GeneratedSheet {
  const keys = Object.keys(layer.sections);
  if (!keys.length) return sheet;
  const out: GeneratedSheet = { ...sheet, sections: { ...(sheet.sections ?? {}) } };
  const legacy = out as unknown as Record<string, unknown>;
  for (const key of keys) {
    const body = layer.sections[key].body;
    out.sections![key] = body;
    if (key in legacy && key !== "sections") legacy[key] = body;
  }
  return out;
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

// ── Branches ─────────────────────────────────────────────────────────────────

/** The sheet's suggestions, replacing any it had. A pill keeps the id it streamed in with. */
export function setPills(layer: SheetLayer, pills: (BranchQuestion & { anchor: string; id?: string })[]): SheetLayer {
  return {
    ...layer,
    pills: pills
      .filter((p) => validAnchor(p.anchor))
      .slice(0, LAYER_LIMITS.pills)
      .map((p) => ({ ...p, id: p.id ?? newLayerId() })),
    suggestedAt: now(),
  };
}

/** Marks a comprehensive sheet's first branches as grown, so a reload does not grow them again. */
export const markPicksGrown = (layer: SheetLayer): SheetLayer => (layer.picksGrown ? layer : { ...layer, picksGrown: true });

export type NewBranch = Omit<LayerBranch, "at" | "id"> & { id?: string };

/** A branch grown or written. An id already in the layer replaces that branch. */
export function addBranch(layer: SheetLayer, b: NewBranch): SheetLayer {
  if (!validAnchor(b.anchor) || layer.branches.length >= LAYER_LIMITS.branches) return layer;
  const branch: LayerBranch = { ...b, id: b.id ?? newLayerId(), text: b.text.slice(0, LAYER_LIMITS.branchText), at: now() };
  const at = layer.branches.findIndex((x) => x.id === branch.id);
  const branches = [...layer.branches];
  if (at >= 0) branches[at] = branch;
  else branches.push(branch);
  return { ...layer, branches };
}

/** The student's own wording of a branch. Writing it empty removes it. */
export function editBranch(layer: SheetLayer, id: string, text: string): SheetLayer {
  if (!text.trim()) return removeBranch(layer, id);
  return {
    ...layer,
    branches: layer.branches.map((b) =>
      b.id === id ? { ...b, text: text.slice(0, LAYER_LIMITS.branchText), edited: b.source === "ai" ? true : b.edited } : b
    ),
  };
}

/** A branch and every branch grown from it. */
export function removeBranch(layer: SheetLayer, id: string): SheetLayer {
  const gone = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const b of layer.branches) {
      if (b.parentId && gone.has(b.parentId) && !gone.has(b.id)) {
        gone.add(b.id);
        grew = true;
      }
    }
  }
  return { ...layer, branches: layer.branches.filter((b) => !gone.has(b.id)) };
}

/** The branches a branch hangs from, outermost first. */
export function branchPath(layer: SheetLayer, id: string): LayerBranch[] {
  const byId = new Map(layer.branches.map((b) => [b.id, b]));
  const path: LayerBranch[] = [];
  let at = byId.get(id)?.parentId;
  while (at && path.length < 10) {
    const parent = byId.get(at);
    if (!parent) break;
    path.unshift(parent);
    at = parent.parentId;
  }
  return path;
}

/**
 * The branches as text, section by section, for the end of an export or a
 * share. Empty when there are none.
 */
export function layerBranchesText(sheet: GeneratedSheet, layer: SheetLayer): string {
  if (!layer.branches.length) return "";
  const titles = new Map(resolvePlan(sheet).map((s) => [s.key, s.title]));
  const children = (parent?: string) => layer.branches.filter((b) => b.parentId === parent);
  const write = (b: LayerBranch, depth: number): string[] => [
    `${"#".repeat(Math.min(depth + 2, 6))} ${b.label}`,
    b.text.replace(/^#{1,6}\s+/gm, ""),
    ...children(b.id).flatMap((c) => write(c, depth + 1)),
  ];
  const bySection = new Map<string, LayerBranch[]>();
  for (const b of children(undefined)) {
    const key = anchorSection(b.anchor);
    bySection.set(key, [...(bySection.get(key) ?? []), b]);
  }
  const parts = [...bySection.entries()].map(([key, list]) =>
    [`# ${titles.get(key) ?? key}`, ...list.flatMap((b) => write(b, 0))].join("\n\n")
  );
  return `My branches\n\n${parts.join("\n\n")}`;
}

// ── The sheet as the student has made it ─────────────────────────────────────

/**
 * The sheet with the student's layer applied: their edits in place of the
 * lines they rewrote, the lines they removed gone, the points they added
 * appended, and their cards in the deck. For everything that takes the sheet
 * as text — export, share, the QBank hand-off. The renderer does not use it:
 * it shows the layer in place, marked as the student's.
 */
export function applyLayer(generated: GeneratedSheet, layer: SheetLayer): GeneratedSheet {
  if (isEmptyLayer(layer)) return generated;
  const sheet = withLayerSections(generated, layer);
  const out: GeneratedSheet = { ...sheet, sections: { ...(sheet.sections ?? {}) } };
  const legacy = out as unknown as Record<string, unknown>;
  const hidden = new Set(layer.hidden);

  // Each section, and its depth: a depth line can be edited or removed too.
  const keys = resolvePlan(sheet).flatMap(({ key }) => [key, `${key}_more`]);
  for (const key of keys) {
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
