import type { Flashcard, GeneratedSheet, GroundingLevel, SheetSource } from "@/types/generated-sheet";
import { resolvePlan, sectionBody } from "@/lib/sheet-plan";
import { resolveGroundingLevel } from "@/lib/grounding";
import { cleanExcerpt, formatLocation, groupSources, resolveLocation } from "@/lib/source-display";
import {
  anchorOf,
  anchorSection,
  effectiveText,
  highlightRanges,
  isEmptyLayer,
  withLayerSections,
  type HighlightIntent,
  type LayerBranch,
  type SheetLayer,
} from "@/lib/sheet-layer";

/**
 * The exported sheet, as data. Built once from the sheet, the student's layer
 * and the export options, and rendered by SheetPrintDocument — the preview in
 * the export dialog and the page that is printed are the same object, so what
 * the student sees is what they get.
 */

// ── Options ──────────────────────────────────────────────────────────────────

/** "study" reads like a handout; "revision" packs two columns for a cram sheet. */
export type PrintLayout = "study" | "revision";
/** Cards with answers beside them, as a self-test with the key at the back, or not at all. */
export type PrintCards = "inline" | "quiz" | "omit";
export type PrintSources = "list" | "excerpts" | "omit";
export type PrintPaper = "A4" | "Letter";
export type PrintTextSize = "small" | "medium" | "large";

export interface PrintOptions {
  layout: PrintLayout;
  paper: PrintPaper;
  textSize: PrintTextSize;
  /** No tinted fills or coloured marks: cheaper to print, and clean in black and white. */
  inkSaver: boolean;
  /** A title page with the contents, rather than a title block at the top of page one. */
  coverPage: boolean;
  /** A ruled column beside every section for handwritten cues, Cornell-style. */
  notesMargin: boolean;
  /** Section keys left out. Stored as exclusions so a new archetype section is in by default. */
  excluded: string[];
  cards: PrintCards;
  /** The student's edits, highlights, added points and notes. */
  mine: boolean;
  branches: boolean;
  sources: PrintSources;
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  layout: "study",
  paper: "A4",
  textSize: "medium",
  inkSaver: false,
  coverPage: false,
  notesMargin: false,
  excluded: [],
  cards: "inline",
  mine: true,
  branches: true,
  sources: "list",
};

/** Closes every export, PDF or Word: the sheet is model output. */
export const AI_NOTICE =
  "AI-generated study material. Check it against current guidelines before relying on it; it is not a substitute for clinical judgment.";

// ── Model ────────────────────────────────────────────────────────────────────

export interface PrintSpan {
  text: string;
  bold?: boolean;
  mark?: HighlightIntent;
}

export interface PrintNote {
  text: string;
  ai: boolean;
}

export interface PrintLine {
  /** A short "Label:" a prose line opens with, set apart in the margin of the line. */
  label?: string;
  spans: PrintSpan[];
  /** The student rewrote this line, or added it. */
  mine?: "edited" | "added";
  notes: PrintNote[];
}

export interface PrintSection {
  key: string;
  title: string;
  /** 1-based, as numbered in the contents. */
  number: number;
  kind: "prose" | "list" | "table";
  columns?: string[];
  lines: PrintLine[];
  /** Table only: rows of cells. */
  rows: PrintSpan[][][];
  /** Notes on the section as a whole, and on rows of a table. */
  notes: PrintNote[];
  branches: LayerBranch[];
}

export interface PrintReference {
  number: number;
  title: string;
  chapters: { heading: string | null; pages: string[]; excerpts: string[] }[];
  url: string | null;
}

export interface PrintModel {
  title: string;
  emoji?: string;
  meta: {
    examMode: string;
    difficulty: string;
    depth: string;
    date: string;
    grounding: GroundingLevel | null;
  };
  sections: PrintSection[];
  cards: (Flashcard & { mine: boolean })[];
  /** Every branch, so a section's branches can find their children. */
  allBranches: LayerBranch[];
  referenceNote: string;
  references: PrintReference[];
  hasMine: boolean;
}

export interface PrintContext {
  topic: string;
  examMode: string;
  difficulty: string;
  depth: "highYield" | "comprehensive";
  /** Injected so tests are stable; defaults to today. */
  date?: Date;
}

// ── Text → spans ─────────────────────────────────────────────────────────────

/** Same rule the on-screen sheet uses (OutputSection's SECTION_LABEL_RE). */
const LABEL_RE = /^([A-Z][A-Za-z][A-Za-z ,/&-]{0,30}?)\s*[:：](?=\s|$)\s*/;

/** **bold** runs, with the markers removed. */
function boldRuns(text: string): PrintSpan[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4
        ? { text: part.slice(2, -2), bold: true }
        : { text: part.replace(/\*\*/g, "") }
    );
}

/** Splits runs at the highlight ranges, which are measured on the visible (marker-free) text. */
function applyMarks(runs: PrintSpan[], ranges: { start: number; end: number; intent: HighlightIntent }[]): PrintSpan[] {
  if (!ranges.length) return runs;
  const out: PrintSpan[] = [];
  let pos = 0;
  for (const run of runs) {
    const runEnd = pos + run.text.length;
    const cuts = new Set([pos, runEnd]);
    for (const r of ranges) {
      if (r.start > pos && r.start < runEnd) cuts.add(r.start);
      if (r.end > pos && r.end < runEnd) cuts.add(r.end);
    }
    const points = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const [a, b] = [points[i], points[i + 1]];
      const hit = ranges.find((r) => r.start <= a && r.end >= b);
      out.push({ ...run, text: run.text.slice(a - pos, b - pos), ...(hit ? { mark: hit.intent } : {}) });
    }
    pos = runEnd;
  }
  return out;
}

export function toSpans(text: string, ranges: { start: number; end: number; intent: HighlightIntent }[] = []): PrintSpan[] {
  return applyMarks(boldRuns(text), ranges);
}

/** Lifts a leading "Label:" off a prose line's spans. */
function splitLabel(spans: PrintSpan[]): { label?: string; spans: PrintSpan[] } {
  const first = spans[0];
  if (!first || first.mark) return { spans };
  const m = LABEL_RE.exec(first.text);
  if (!m) return { spans };
  const rest = first.text.slice(m[0].length);
  return { label: m[1], spans: rest ? [{ ...first, text: rest }, ...spans.slice(1)] : spans.slice(1) };
}

// ── Build ────────────────────────────────────────────────────────────────────

const DEPTH_LABEL = { highYield: "High-yield", comprehensive: "Comprehensive" } as const;

export function buildPrintModel(
  generated: GeneratedSheet,
  layer: SheetLayer | null,
  options: PrintOptions,
  context: PrintContext
): PrintModel {
  const useLayer = options.mine && !!layer && !isEmptyLayer(layer);
  const L = useLayer ? layer! : null;
  const sheet = L ? withLayerSections(generated, L) : generated;
  const hidden = new Set(L?.hidden ?? []);
  const excluded = new Set(options.excluded);

  const notesAt = (anchor: string): PrintNote[] =>
    (L?.notes ?? []).filter((n) => n.anchor === anchor).map((n) => ({ text: n.text, ai: n.source === "ai" }));
  const marksAt = (anchor: string, visible: string) =>
    L ? highlightRanges(visible, L.highlights.filter((h) => h.anchor === anchor)) : [];

  const line = (anchor: string, original: string, prose: boolean): PrintLine => {
    const text = L ? effectiveText(L, anchor, original) : original;
    const spans = toSpans(text, marksAt(anchor, text.replace(/\*\*/g, "")));
    const { label, spans: body } = prose ? splitLabel(spans) : { spans };
    return { label, spans: body, notes: notesAt(anchor), ...(L?.edits[anchor] ? { mine: "edited" as const } : {}) };
  };

  const sections: PrintSection[] = [];
  for (const spec of resolvePlan(sheet)) {
    if (excluded.has(spec.key)) continue;
    const body = sectionBody(sheet, spec.key);
    const added: PrintLine[] = (L?.additions ?? [])
      .filter((a) => a.section === spec.key)
      .map((a) => ({ spans: toSpans(a.text), notes: [], mine: "added" as const }));

    const section: PrintSection = {
      key: spec.key,
      title: spec.title,
      number: 0,
      kind: spec.kind,
      columns: spec.columns,
      lines: [],
      rows: [],
      notes: notesAt(`${spec.key}:end`),
      branches: options.branches && L ? L.branches.filter((b) => !b.parentId && anchorSection(b.anchor) === spec.key) : [],
    };

    if (typeof body === "string") {
      section.kind = "prose";
      body.split("\n").forEach((raw, i) => {
        const anchor = anchorOf(spec.key, i);
        if (!raw.trim() || hidden.has(anchor)) return;
        section.lines.push(line(anchor, raw.trim(), true));
      });
    } else if (Array.isArray(body) && body.length && Array.isArray(body[0])) {
      section.kind = "table";
      (body as string[][]).forEach((row, i) => {
        const anchor = anchorOf(spec.key, i);
        if (hidden.has(anchor)) return;
        section.rows.push(row.map((cell) => toSpans(cell)));
        section.notes.push(...notesAt(anchor));
      });
    } else if (Array.isArray(body)) {
      section.kind = "list";
      (body as string[]).forEach((item, i) => {
        const anchor = anchorOf(spec.key, i);
        if (hidden.has(anchor)) return;
        section.lines.push(line(anchor, item, false));
      });
    }
    section.lines.push(...added);

    if (section.lines.length || section.rows.length) sections.push(section);
  }
  sections.forEach((s, i) => (s.number = i + 1));

  const cards =
    options.cards === "omit"
      ? []
      : [
          ...(generated.flashcards ?? []).map((c) => ({ ...c, mine: false })),
          ...(L?.cards ?? []).map((c) => ({ tag: "Mine", question: c.question, answer: c.answer, mine: true })),
        ];

  return {
    title: generated.topic?.trim() || context.topic.trim() || "Study sheet",
    emoji: generated.topicEmoji,
    meta: {
      examMode: context.examMode,
      difficulty: context.difficulty,
      depth: DEPTH_LABEL[context.depth],
      date: (context.date ?? new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
      grounding: resolveGroundingLevel(generated),
    },
    sections,
    cards,
    allBranches: L?.branches ?? [],
    referenceNote: options.sources === "omit" ? "" : generated.referenceNote?.trim() ?? "",
    references: options.sources === "omit" ? [] : buildReferences(generated.sources ?? [], options.sources === "excerpts"),
    hasMine: useLayer,
  };
}

/** One numbered reference per book, its chapters and printed pages beneath. */
export function buildReferences(sources: readonly SheetSource[], withExcerpts: boolean): PrintReference[] {
  return groupSources(sources).map((book, i) => ({
    number: i + 1,
    title: book.title,
    url: book.chapters.flatMap((c) => c.passages).find((p) => p.sourceUrl)?.sourceUrl ?? null,
    chapters: book.chapters.map((ch) => {
      const pages = [
        ...new Set(
          ch.passages
            .map((p) => resolveLocation(p).page)
            .filter((n): n is number => n !== null)
            .sort((a, b) => a - b)
            .map((n) => `p.\u00a0${n}`)
        ),
      ];
      return {
        heading: ch.heading ?? formatLocation(resolveLocation(ch.passages[0])),
        pages,
        excerpts: withExcerpts
          ? ch.passages.map((p) => {
              const c = cleanExcerpt(p.content);
              return `${c.startsMidSentence ? "…" : ""}${c.text}${c.endsMidSentence ? "…" : ""}`;
            })
          : [],
      };
    }),
  }));
}

/** A file name the browser offers in its Save dialog, from the print document's title. */
export function exportFileName(title: string, date = new Date()): string {
  const safe = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Study sheet";
  return `${safe} — StudyBuddy sheet ${date.toISOString().slice(0, 10)}`;
}

/** A string safe inside a CSS `content: "…"` value, for the running header. */
export function cssString(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r]+/g, " ")}"`;
}
