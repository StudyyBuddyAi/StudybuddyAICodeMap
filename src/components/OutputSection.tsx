import { Fragment, useRef, useEffect, useState, useCallback } from "react";
import { callMedicalNotes } from "@/lib/callMedicalNotes";
import { useMemoryPreference } from "@/hooks/use-memory-preference";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Bug,
  Check,
  ChevronDown,
  ChevronUp,
  Columns2,
  FileText,
  GitBranch,
  HelpCircle,
  Layers,
  Lightbulb,
  List,
  PersonStanding,
  Pill,
  RotateCcw,
  Scissors,
  Settings2,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  X,
  type LucideIcon,
} from "lucide-react";
import CopyButton from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import FlashcardsSection from "@/components/FlashcardsSection";
import SaveButton from "@/components/SaveButton";
import SectionSkeleton from "@/components/SectionSkeleton";
import CitationBadgeList from "@/components/CitationBadgeList";
import { ModelCredit } from "@/components/PoweredByCorti";
import { startTopProgress, finishTopProgress } from "@/components/TopProgressBar";
import { parseModelUsed, type ModelUsed } from "@/lib/model-used";
import type { CitationResult } from "@/lib/citation";
import {
  type GeneratedSheet,
  type EnhancementResult,
  type SectionBody,
  type SheetSectionSpec,
  parseStoredSheet,
  isJsonSheet,
} from "@/types/generated-sheet";
import { bodyLines, isTableRows, renderOrder, sectionBody } from "@/lib/sheet-plan";
import {
  AnimatePresence,
  LazyMotion,
  MotionConfig,
  domAnimation,
  m,
} from "motion/react";
import { AutoHeight, Caret, StreamingWords } from "@/components/StreamingText";
import { ENTER, EXIT, SPRING_POP, SWAP } from "@/lib/motion";
import EnhanceTip from "@/components/sheet/EnhanceTip";
import type { SheetDeck } from "@/components/sheet/SheetFinish";
import SheetSources from "@/components/SheetSources";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import RecallCheck from "@/components/RecallCheck";
import { assignRecallCards } from "@/lib/section-recall";
import {
  addHighlight,
  anchorSection,
  highlightRanges,
  occurrenceBefore,
  originalLine,
  removeHighlight,
  setHighlightIntent,
  type HighlightIntent,
  type LayerAddition,
  type LayerHighlight,
  type LayerSource,
  withLayerSections,
} from "@/lib/sheet-layer";
import { REGEN_CHOICES, hasBody, type RegenStyle } from "@/lib/sheet-depth";
import { CustomRewrite, SectionMenu, type SectionJob } from "@/components/sheet/SectionDepth";
import type { BranchesApi } from "@/hooks/use-sheet-branches";
import { BranchesProvider, useBranches } from "@/components/sheet/branches/branch-context";
import { LineBranches, lineHasBranches } from "@/components/sheet/branches/LineBranches";
import { PrintBranches } from "@/components/sheet/branches/PrintBranches";
import { PersonalProvider, usePersonal, type PersonalApi, type PersonalProps } from "@/components/sheet/personal/personal-context";
import {
  AdditionRow,
  EditedMark,
  ItemMenu,
  PersonalExtras,
  SectionFooter,
} from "@/components/sheet/personal/PersonalItem";
import { HighlightMenu, SelectionToolbar, type AiChoice } from "@/components/sheet/personal/SelectionToolbar";
import { LayerBar } from "@/components/sheet/personal/LayerBar";

type EnhanceKind = "enhance" | "expand" | "clinical";

interface ActiveEnhancement {
  sourceText: string;
  kind: EnhanceKind;
  anchor: string; // "sectionKey:lineIdx" | "sectionKey:end" | "saved"
  /** When true, render the source text as a golden highlight instead of the inline block. */
  isCollapsed?: boolean;
  /** Pre-loaded result from a saved sheet, so the inline block renders without re-calling the AI. */
  savedResult?: string;
}

/** Lightweight ref to a collapsed enhancement, used when wrapping its source text in a golden mark. */
interface CollapsedRef {
  key: string;
  sourceText: string;
}

/**
 * How the student's layer shows on each line, item and row. Built once per
 * render from the personal context; absent, the document renders as it always
 * has.
 */
interface PersonalRender {
  /** The line as the student sees it: their edit, or what was generated. */
  text: (anchor: string, original: string) => string;
  /** Who rewrote the line, or null when it reads as generated. */
  edited: (anchor: string) => LayerSource | null;
  /** Left out: removed by the student, or known while known lines are hidden. */
  skip: (anchor: string) => boolean;
  /** Removed by the student, but shown struck through while "Original" is on. */
  removed: (anchor: string) => boolean;
  known: (anchor: string) => boolean;
  highlights: (anchor: string) => LayerHighlight[];
  onHighlightClick?: (id: string, el: HTMLElement) => void;
  menu: (anchor: string, effective: string, canEdit: boolean) => React.ReactNode;
  extras: (anchor: string, original: string, effective: string) => React.ReactNode;
  additions: (section: string) => LayerAddition[];
}

/** Classes for a line or item's state in the student's layer. */
function layerLineClass(pr: PersonalRender | undefined, anchor: string): string {
  if (!pr) return "";
  if (pr.removed(anchor)) return " line-through opacity-50";
  if (pr.known(anchor)) return " opacity-60";
  return "";
}

/** A ✓ before a line the student has marked as known. */
const KnownTick = () => (
  <Check aria-label="You know this" className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-primary" />
);

/** Golden highlight styling for the source text of a collapsed enhancement. */
const ENH_MARK_STYLE: React.CSSProperties = {
  background: "rgba(234, 179, 8, 0.18)",
  borderBottom: "1.5px solid rgba(234, 179, 8, 0.5)",
  borderRadius: "2px",
  padding: "0 2px",
  cursor: "pointer",
};

/** Section card chrome — shared by the legacy and JSON renderers. */
const SECTION_CARD_STYLE: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderLeft: "3px solid var(--accent)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-elevated)",
  overflow: "hidden",
};

const SECTION_HEADER_STYLE: React.CSSProperties = {
  padding: "20px 24px 8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const SECTION_BODY_STYLE: React.CSSProperties = { padding: "4px 24px 20px" };

const SECTION_ICON_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--bg)",
  flexShrink: 0,
};

const SECTION_TITLE_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: "-0.004em",
  color: "var(--fg)",
  margin: 0,
};

const MODE_BAR_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--fg-muted)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "6px 12px",
  background: "var(--bg-elevated)",
  letterSpacing: "0.04em",
};

/** Mode info bar — same markup in both renderers. */
const ModeInfoBar = ({
  modeInfo,
}: {
  modeInfo: { examMode: string; difficulty: string; length: string };
}) => {
  const dot = (
    <span style={{ margin: "0 6px", opacity: 0.3, color: "var(--fg)" }}>·</span>
  );
  return (
    <div style={MODE_BAR_STYLE}>
      <Settings2 style={{ width: 13, height: 13, color: "var(--accent)" }} />
      <span>
        <span style={{ color: "var(--fg)" }}>{modeInfo.examMode}</span>
        {dot}
        <span>{modeInfo.difficulty}</span>
        {dot}
        <span>{modeInfo.length}</span>
      </span>
    </div>
  );
};

/** Backend mode for a presentational kind — the edge function only knows expand/clinical. */
const kindToMode = (kind: EnhanceKind): "expand" | "clinical" =>
  kind === "clinical" ? "clinical" : "expand";

const kindLabel: Record<EnhanceKind, string> = {
  enhance: "✦ Enhancement",
  expand: "↗ Expansion",
  clinical: "🔗 Clinical Tie",
};

function makeEnhancementKey(sourceText: string, kind: EnhanceKind): string {
  const snippet = sourceText.trim().slice(0, 40).replace(/\s+/g, "_");
  return `${kind}:${snippet}`;
}

export type CitationState = "idle" | "loading" | "found" | "locked" | "hidden";

/** Set once the reader has dismissed the enhance tip or used enhance. */
const ENHANCE_TIP_KEY = "sb_enhance_tip_seen";

// Storage can be unavailable (private mode, blocked site data); a tip that
// shows again is the worst that should happen.
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // not persisted — see readFlag
  }
}

interface OutputSectionProps {
  output: string;
  inputText?: string;
  modeInfo?: {
    examMode: string;
    difficulty: string;
    length: string;
  };
  citations?: CitationResult[];
  citationState?: CitationState;
  onCitationLockedClick?: () => void;
  citationIsLoggedIn?: boolean;
  /** Which model wrote the sheet, from the response headers. */
  modelUsed?: ModelUsed | null;
  isPro?: boolean;
  userId?: string | null;
  isAnonymous?: boolean;
  sheetId?: string;
  /** True while the sheet is still arriving over the stream. */
  isStreaming?: boolean;
  /** Sections safe to render mid-stream. Ignored unless `isStreaming`. */
  streamedKeys?: string[];
  /**
   * The key the model is writing right now. When given, that section shows its
   * draft as it arrives instead of a skeleton. Ignored unless `isStreaming`.
   */
  liveKey?: string;
  /**
   * The settings line and Save above the sections. The Sheets page turns it
   * off: its topic bar carries both. Library's saved-sheet dialog keeps it.
   */
  showHeader?: boolean;
  /**
   * The sheet's own deck, when the page can keep it: the Flashcards section
   * offers to add it to the library.
   */
  deck?: SheetDeck;
  /**
   * The student's own layer over the sheet — highlights, edits, notes, what
   * they know — and what they may do with it. Absent, the sheet renders as
   * generated and offers nothing personal.
   */
  personal?: PersonalProps;
  /**
   * What can be done to one section: rewrite it in a direction, or take the
   * rewrite back. Absent, sections render without the menu (Library's
   * saved-sheet dialog).
   */
  rewrites?: RewriteControls;
  /**
   * The sheet's branches: the chips under its lines, grown or suggested, and
   * the "Branch from this line" item. Absent, the sheet shows none.
   */
  branches?: BranchesApi;
}

/** What the page lets a section do about its wording. */
export interface RewriteControls {
  rewrite: (key: string, style: RegenStyle, instruction?: string) => void;
  /** Back to the section as generated. */
  undoRewrite: (key: string) => void;
  /** What is running, by section key. */
  jobs: Record<string, SectionJob>;
  /** Drafts arriving, by section key. */
  drafts: Record<string, SectionBody>;
  /** Rewrites can run: the sheet is finished and its layer loaded. */
  enabled: boolean;
}

// ─── Legacy renderer helpers (kept for old text-blob sheets) ───────────────

const sectionConfig = {
  SUMMARY: { icon: BookOpen, label: "📋 Summary", className: "section-summary" },
  "MEMORY HOOKS": { icon: Lightbulb, label: "🧠 Memory Hooks", className: "section-memoryhooks" },
  "CLINICAL APPROACH": { icon: Stethoscope, label: "🩺 Clinical Approach", className: "section-clinical" },
  "KEY POINTS": { icon: List, label: "📌 Key Points", className: "section-keypoints" },
  "EXAM TRAPS": { icon: AlertTriangle, label: "⚠️ Exam Traps", className: "section-examtraps" },
  FLASHCARDS: { icon: HelpCircle, label: "❓ Flashcards", className: "section-flashcards" },
  "REFERENCE NOTE": { icon: FileText, label: "📚 Reference Note", className: "section-reference" },
};

type SectionKey = keyof typeof sectionConfig;

const EVIDENCE_SECTIONS_LEGACY: ReadonlyArray<SectionKey> = [
  "SUMMARY",
  "CLINICAL APPROACH",
  "KEY POINTS",
];

function parseSections(text: string) {
  const sections: { title: SectionKey; content: string }[] = [];
  const keys = Object.keys(sectionConfig) as SectionKey[];
  const sortedKeys = [...keys].sort((a, b) => b.length - a.length);
  const regex = new RegExp(
    `(${sortedKeys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*\\n`,
    "g"
  );

  let lastKey: SectionKey | null = null;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (lastKey !== null) {
      sections.push({ title: lastKey, content: text.slice(lastIndex, match.index).trim() });
    }
    lastKey = match[1] as SectionKey;
    lastIndex = match.index + match[0].length;
  }

  if (lastKey !== null) {
    sections.push({ title: lastKey, content: text.slice(lastIndex).trim() });
  }

  return sections;
}

function renderFormattedContent(content: string) {
  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

// ─── JSON renderer helpers ─────────────────────────────────────────────────

/**
 * Icon per `SectionIconName`. A name this build does not know falls back to
 * the generic mark, so the server can plan an archetype section the client has
 * never heard of and it still renders with a heading and a body.
 */
const SECTION_ICONS: Record<string, LucideIcon> = {
  overview: BookOpen,
  memory: Lightbulb,
  clinical: Stethoscope,
  keypoints: List,
  traps: AlertTriangle,
  flashcards: HelpCircle,
  reference: FileText,
  drug: Pill,
  micro: Bug,
  anatomy: PersonStanding,
  pathway: GitBranch,
  procedure: Scissors,
  data: BarChart3,
  compare: Columns2,
};

const FALLBACK_SECTION_ICON = List;

const sectionIcon = (name: string | undefined): LucideIcon =>
  (name && SECTION_ICONS[name]) || FALLBACK_SECTION_ICON;

/**
 * The bolded label at the head of a line in a prose section
 * ("Mechanism:", "Absorption:", "Rate-limiting enzyme:").
 *
 * This was a fixed alternation of the labels the two disease-shaped sections
 * used. Every archetype writes its own — a drug has Class / Target / Effect, a
 * pathway has Purpose / Steps / Location — so matching a short capitalised
 * phrase followed by a colon keeps them all working without the regex having
 * to learn each new section. The length cap and the requirement that the line
 * *start* with it are what stop an ordinary sentence being mistaken for one.
 */
const SECTION_LABEL_RE = /^([A-Z][A-Za-z][A-Za-z ,/&-]{0,30}?)(\s*[:：])(?=\s|$)/;

type KeywordClickHandler = (keyword: string, rect: DOMRect, anchor: string) => void;

/** Where a selection would be highlighted: one line's anchor, its text, which occurrence. */
interface MarkTarget {
  anchor: string;
  quote: string;
  occurrence: number;
}

/**
 * The part of a selection that falls inside the line (or table cell) it starts
 * in, as a highlight would store it. The line's text element holds exactly its
 * visible words — the enhancement star and the "edited" chip sit outside it —
 * so what is measured here is what renderRich will later search.
 */
function markTarget(range: Range): MarkTarget | null {
  const startEl =
    range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const lineEl = startEl?.closest("[data-enh-anchor]");
  const anchor = lineEl?.getAttribute("data-enh-anchor") ?? "";
  if (!lineEl || !/:\d+$/.test(anchor)) return null;
  const textEl = startEl!.closest("[data-layer-text]") ?? lineEl.querySelector("[data-layer-text]");
  if (!textEl || !lineEl.contains(textEl)) return null;

  const clipped = document.createRange();
  clipped.selectNodeContents(textEl);
  if (range.compareBoundaryPoints(Range.START_TO_START, clipped) > 0) {
    clipped.setStart(range.startContainer, range.startOffset);
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, clipped) < 0) {
    clipped.setEnd(range.endContainer, range.endOffset);
  }
  const raw = clipped.toString();
  const quote = raw.trim();
  if (quote.length < 2) return null;

  const before = document.createRange();
  before.selectNodeContents(textEl);
  before.setEnd(clipped.startContainer, clipped.startOffset);
  const lead = raw.length - raw.trimStart().length;
  return { anchor, quote, occurrence: occurrenceBefore(before.toString() + raw.slice(0, lead), quote) };
}

function anchorFromElement(el: Element | null): string {
  const anchorEl = el?.closest("[data-enh-anchor]");
  if (anchorEl) return anchorEl.getAttribute("data-enh-anchor") ?? "end";
  const sectionEl = el?.closest("[data-enh-section]");
  if (sectionEl) return `${sectionEl.getAttribute("data-enh-section")}:end`;
  return "end";
}

function renderBoldKeyword(
  text: string,
  i: number,
  onKeywordClick?: KeywordClickHandler
) {
  if (!onKeywordClick) {
    return (
      <strong key={i} className="font-semibold text-foreground">
        {text}
      </strong>
    );
  }
  return (
    <span
      key={i}
      className="font-semibold text-foreground cursor-pointer underline-offset-2 hover:underline hover:text-primary/90 transition-colors"
      // Stop propagation so the open menu's outside-click dismissal (a document
      // mousedown listener) doesn't immediately close the menu we're opening.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const el = e.currentTarget as HTMLElement;
        onKeywordClick(text, el.getBoundingClientRect(), anchorFromElement(el));
      }}
    >
      {text}
    </span>
  );
}

/**
 * Locate a collapsed enhancement's source text inside a line's visible text.
 * Falls back to the longest word-bounded prefix when the full selection spans
 * past this line (selections anchor to their *start* line).
 */
function findNeedleMatch(
  visibleLower: string,
  sourceLower: string
): { idx: number; len: number } | null {
  const needle = sourceLower.trim();
  if (!needle) return null;
  let idx = visibleLower.indexOf(needle);
  if (idx >= 0) return { idx, len: needle.length };
  const words = needle.split(/\s+/);
  for (let w = words.length - 1; w >= 1; w--) {
    const prefix = words.slice(0, w).join(" ");
    if (prefix.length < 3) break;
    idx = visibleLower.indexOf(prefix);
    if (idx >= 0) return { idx, len: prefix.length };
  }
  return null;
}

/** Opens the menu for one of the student's own highlights. */
type HighlightClickHandler = (id: string, el: HTMLElement) => void;

/** One marked stretch of a line's visible text. */
interface MarkSpan {
  start: number;
  end: number;
  /** An enhancement's golden mark, or a highlight's reason. */
  kind: "enh" | HighlightIntent;
  key: string;
}

const HIGHLIGHT_TITLES: Record<HighlightIntent, string> = {
  key: "Your highlight: key",
  confusing: "Your highlight: confusing",
  memorize: "Your highlight: to memorize",
};

/**
 * Render a line of text with `**bold**` keywords, the golden mark of the first
 * collapsed enhancement it contains, and the student's own highlights.
 *
 * Marks can overlap — a highlight inside an enhanced passage, two highlights
 * sharing words — so the line is cut at every mark's edges and each piece goes
 * to the narrowest mark covering it; neighbouring pieces of one mark share one
 * <mark>. A bold keyword cut by a mark's edge loses its click, not its weight.
 * The enhancement's ✦ is drawn in CSS (sb-enh-end) so the line's text — what a
 * selection is measured against — is exactly its visible words.
 */
function renderRich(
  text: string,
  baseKey: string,
  onKeywordClick: KeywordClickHandler | undefined,
  collapsed: CollapsedRef[],
  onReopen: ((key: string) => void) | undefined,
  highlights: LayerHighlight[] = [],
  onHighlightClick?: HighlightClickHandler
): React.ReactNode {
  const rawParts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== "");
  const tokens = rawParts.map((part) => {
    const isBold = part.startsWith("**") && part.endsWith("**");
    return { isBold, visible: isBold ? part.slice(2, -2) : part };
  });
  const visible = tokens.map((t) => t.visible).join("");

  const spans: MarkSpan[] = [];
  // The first collapsed source text present in this line.
  if (collapsed.length && onReopen) {
    const lower = visible.toLowerCase();
    for (const c of collapsed) {
      const m = findNeedleMatch(lower, c.sourceText.toLowerCase());
      if (m) {
        spans.push({ start: m.idx, end: m.idx + m.len, kind: "enh", key: c.key });
        break;
      }
    }
  }
  for (const r of highlightRanges(visible, highlights)) {
    spans.push({ start: r.start, end: r.end, kind: r.intent, key: r.id });
  }

  if (!spans.length) {
    return tokens.map((tok, i) =>
      tok.isBold ? (
        renderBoldKeyword(tok.visible, `${baseKey}-${i}` as unknown as number, onKeywordClick)
      ) : (
        <span key={`${baseKey}-${i}`}>{tok.visible}</span>
      )
    );
  }

  // Cut every token at every mark edge, and give each piece its narrowest mark.
  const edges = new Set<number>();
  for (const s of spans) {
    edges.add(s.start);
    edges.add(s.end);
  }
  const pieces: { text: string; bold: boolean; wholeBold: boolean; mark: MarkSpan | null }[] = [];
  let offset = 0;
  for (const tok of tokens) {
    const tStart = offset;
    const tEnd = offset + tok.visible.length;
    offset = tEnd;
    const cuts = [tStart, ...[...edges].filter((e) => e > tStart && e < tEnd).sort((a, b) => a - b), tEnd];
    for (let i = 0; i < cuts.length - 1; i++) {
      const [a, b] = [cuts[i], cuts[i + 1]];
      if (a === b) continue;
      const covering = spans.filter((s) => s.start <= a && s.end >= b);
      const mark = covering.sort((x, y) => x.end - x.start - (y.end - y.start))[0] ?? null;
      pieces.push({
        text: tok.visible.slice(a - tStart, b - tStart),
        bold: tok.isBold,
        wholeBold: tok.isBold && cuts.length === 2,
        mark,
      });
    }
  }

  const renderPiece = (p: (typeof pieces)[number], key: string) =>
    p.bold ? (
      p.wholeBold && !p.mark ? (
        renderBoldKeyword(p.text, key as unknown as number, onKeywordClick)
      ) : (
        <strong key={key} className="font-semibold text-foreground">
          {p.text}
        </strong>
      )
    ) : (
      <span key={key}>{p.text}</span>
    );

  // Group neighbouring pieces that share a mark.
  const out: React.ReactNode[] = [];
  for (let i = 0; i < pieces.length; ) {
    const mark = pieces[i].mark;
    let j = i;
    while (j < pieces.length && pieces[j].mark === mark) j++;
    const children = pieces.slice(i, j).map((p, k) => renderPiece(p, `${baseKey}-p${i + k}`));
    if (!mark) {
      out.push(...children);
    } else if (mark.kind === "enh") {
      const isEnd = !pieces.slice(j).some((p) => p.mark === mark);
      out.push(
        <mark
          key={`${baseKey}-m${i}`}
          style={ENH_MARK_STYLE}
          className={`sb-enh-mark text-foreground${isEnd ? " sb-enh-end" : ""}`}
          role="button"
          tabIndex={0}
          title="Re-open enhancement"
          onClick={(e) => {
            e.stopPropagation();
            onReopen!(mark.key);
          }}
        >
          {children}
        </mark>
      );
    } else {
      out.push(
        <mark
          key={`${baseKey}-m${i}`}
          data-highlight-id={mark.key}
          className={`sb-hl sb-hl-${mark.kind}`}
          title={HIGHLIGHT_TITLES[mark.kind]}
          tabIndex={onHighlightClick ? 0 : undefined}
          onClick={
            onHighlightClick
              ? (e) => {
                  e.stopPropagation();
                  onHighlightClick(mark.key, e.currentTarget);
                }
              : undefined
          }
          onKeyDown={
            onHighlightClick
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onHighlightClick(mark.key, e.currentTarget);
                  }
                }
              : undefined
          }
        >
          {children}
        </mark>
      );
    }
    i = j;
  }
  return out;
}

function renderJsonText(
  text: string,
  anchorPrefix: string,
  onKeywordClick?: KeywordClickHandler,
  renderInline?: (anchor: string) => React.ReactNode,
  collapsedByAnchor?: Record<string, CollapsedRef[]>,
  onReopen?: (key: string) => void,
  pr?: PersonalRender
) {
  const lines = text.split("\n");

  const rendered = lines.map((line, lineIdx) => {
    const original = line.trim();
    if (!original) {
      return <span key={lineIdx} className="block h-2" />;
    }

    const anchor = `${anchorPrefix}:${lineIdx}`;
    if (pr?.skip(anchor)) return null;
    // The student's rewrite of the line, when there is one, is what renders.
    const trimmed = pr ? pr.text(anchor, original) : original;
    const collapsed = collapsedByAnchor?.[anchor] ?? [];
    const highlights = pr?.highlights(anchor) ?? [];
    const edited = pr?.edited(anchor);
    const labelMatch = trimmed.match(SECTION_LABEL_RE);
    const state = layerLineClass(pr, anchor);
    const tick = pr?.known(anchor) ? <KnownTick /> : null;

    let lineNode: React.ReactNode;
    if (labelMatch) {
      const labelPart = labelMatch[1] + labelMatch[2];
      const rest = trimmed.slice(labelPart.length);

      lineNode = (
        <span
          data-enh-anchor={anchor}
          className={`block text-sm leading-relaxed ${lineIdx === 0 ? "mt-0" : "mt-3"}${state}`}
        >
          {tick}
          <span className="font-semibold text-foreground/90">{labelPart}</span>
          <span className="text-muted-foreground" data-layer-text>
            {renderRich(rest, `${anchor}-r`, onKeywordClick, collapsed, onReopen, highlights, pr?.onHighlightClick)}
          </span>
          {edited && <EditedMark source={edited} />}
        </span>
      );
    } else {
      lineNode = (
        <span
          data-enh-anchor={anchor}
          className={`block text-sm text-muted-foreground leading-relaxed${state}`}
        >
          {tick}
          <span data-layer-text>
            {renderRich(trimmed, anchor, onKeywordClick, collapsed, onReopen, highlights, pr?.onHighlightClick)}
          </span>
          {edited && <EditedMark source={edited} />}
        </span>
      );
    }

    return (
      <span key={lineIdx} className="block">
        {pr ? (
          <span className="group/item relative block pr-7">
            {lineNode}
            <span className="absolute right-0 top-0">{pr.menu(anchor, trimmed, true)}</span>
          </span>
        ) : (
          lineNode
        )}
        {renderInline?.(anchor)}
        {pr?.extras(anchor, original, trimmed)}
      </span>
    );
  });

  // Points the student added to this section, after its own lines.
  const added = pr?.additions(anchorPrefix) ?? [];
  if (!added.length) return rendered;
  return [
    ...rendered,
    ...added.map((a) => (
      <span key={`add-${a.id}`} className="mt-3 block text-sm leading-relaxed text-muted-foreground">
        <AdditionRow addition={a} />
      </span>
    )),
  ];
}

// Render an array section (memoryHooks, keyPoints, examTraps)
const LIST_NUMBER_STYLE: React.CSSProperties = {
  flexShrink: 0,
  fontFamily: "var(--font-mono)",
  fontWeight: 500,
  fontSize: 12,
  color: "var(--accent)",
  opacity: 0.7,
  width: 20,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

function renderArraySection(
  items: string[],
  sectionKey?: string,
  renderInline?: (anchor: string) => React.ReactNode,
  collapsedByAnchor?: Record<string, CollapsedRef[]>,
  onReopen?: (key: string) => void,
  pr?: PersonalRender
) {
  const added = (sectionKey && pr?.additions(sectionKey)) || [];
  if ((!Array.isArray(items) || items.length === 0) && !added.length) return null;

  // Numbered as shown, so an item the student removed leaves no gap.
  let shown = 0;
  return (
    <ol className="space-y-2">
      {(items ?? []).map((item, i) => {
        const anchor = sectionKey ? `${sectionKey}:${i}` : "";
        if (sectionKey && pr?.skip(anchor)) return null;
        shown++;
        const collapsed = (sectionKey && collapsedByAnchor?.[anchor]) || [];
        const text = sectionKey && pr ? pr.text(anchor, item) : item;
        const edited = sectionKey ? pr?.edited(anchor) : null;
        return (
          <li
            key={i}
            data-enh-anchor={sectionKey ? anchor : undefined}
            className={`group/item text-sm text-muted-foreground leading-relaxed${sectionKey ? layerLineClass(pr, anchor) : ""}`}
          >
            <span className="flex gap-2.5">
              <span style={LIST_NUMBER_STYLE}>{shown}.</span>
              <span className="flex-1">
                {sectionKey && pr?.known(anchor) && <KnownTick />}
                <span data-layer-text>
                  {renderRich(
                    text,
                    `${sectionKey ?? "arr"}-${i}`,
                    undefined,
                    collapsed,
                    onReopen,
                    sectionKey ? pr?.highlights(anchor) : [],
                    pr?.onHighlightClick
                  )}
                </span>
                {edited && <EditedMark source={edited} />}
              </span>
              {sectionKey && pr && <span className="shrink-0">{pr.menu(anchor, text, true)}</span>}
            </span>
            {sectionKey && renderInline?.(anchor)}
            {sectionKey && pr?.extras(anchor, item, text)}
          </li>
        );
      })}
      {added.map((a) => (
        <li key={`add-${a.id}`} className="text-sm leading-relaxed text-muted-foreground">
          <AdditionRow addition={a} index={++shown} />
        </li>
      ))}
    </ol>
  );
}

// ─── Draft renderers (the section being written) ───────────────────────────
//
// Same markup and classes as renderJsonText / renderArraySection, so the swap
// to the finished renderer when the section closes changes nothing visible —
// the draft just gains its keyword clicks and enhancement anchors.

function renderDraftProse(text: string) {
  const lines = text.split("\n");
  const last = lines.length - 1;

  return lines.map((line, lineIdx) => {
    const trimmed = line.trim();
    const caret = lineIdx === last ? <Caret /> : null;
    if (!trimmed) {
      return (
        <span key={lineIdx} className="block h-2">
          {caret}
        </span>
      );
    }

    const labelMatch = trimmed.match(SECTION_LABEL_RE);
    if (labelMatch) {
      const labelPart = labelMatch[1] + labelMatch[2];
      return (
        <span
          key={lineIdx}
          className={`block text-sm leading-relaxed ${lineIdx === 0 ? "mt-0" : "mt-3"}`}
        >
          <span className="font-semibold text-foreground/90">{labelPart}</span>
          <span className="text-muted-foreground">
            <StreamingWords text={trimmed.slice(labelPart.length)} />
            {caret}
          </span>
        </span>
      );
    }
    return (
      <span key={lineIdx} className="block text-sm text-muted-foreground leading-relaxed">
        <StreamingWords text={trimmed} />
        {caret}
      </span>
    );
  });
}

function renderDraftList(items: string[]) {
  return (
    <ol className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="text-sm text-muted-foreground leading-relaxed">
          <span className="flex gap-2.5">
            <span
              style={{
                flexShrink: 0,
                fontFamily: "var(--font-mono)",
                fontWeight: 500,
                fontSize: 12,
                color: "var(--accent)",
                opacity: 0.7,
                width: 20,
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {i + 1}.
            </span>
            <span className="flex-1">
              <StreamingWords text={item} />
              {i === items.length - 1 && <Caret />}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

// ─── Table sections ────────────────────────────────────────────────────────
//
// Headers come from the plan, never the model, so every row is laid against
// the same columns. On a narrow screen the table scrolls sideways under a
// sticky first column, which is the one that says what the row is about.

const TABLE_CELL_STYLE: React.CSSProperties = {
  padding: "9px 12px",
  verticalAlign: "top",
  textAlign: "left",
};

/**
 * The separator is drawn once per row, on the row, in the collapsed-border
 * model. Drawn per cell it went out of step under the sticky first column —
 * Chromium painted that column's borders at the wrong heights once rows had
 * a hover background.
 */
const TABLE_ROW_STYLE: React.CSSProperties = { borderBottom: "1px solid var(--border)" };

const TABLE_HEAD_STYLE: React.CSSProperties = {
  ...TABLE_CELL_STYLE,
  padding: "8px 12px",
  borderBottom: "1px solid var(--border-strong)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--fg-muted)",
  whiteSpace: "nowrap",
  background: "var(--bg-elevated)",
};

/** The first column stays put while the rest scroll under it. */
const STICKY_COLUMN_STYLE: React.CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 1,
  background: "var(--bg-elevated)",
};

/** Rows with at least one filled cell, each cut or padded to the column count. */
function tableRows(rows: string[][], width: number): string[][] {
  return rows
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => {
      if (row.length <= width) return [...row, ...Array(width - row.length).fill("")];
      // Cells past the last column are the model's overflow, not noise: keep
      // them in the last cell rather than drop what it wrote.
      return [...row.slice(0, width - 1), row.slice(width - 1).join("; ")];
    });
}

function TableFrame({
  columns,
  width,
  children,
}: {
  columns: string[];
  width: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ overflowX: "auto", margin: "0 -4px" }}>
      <table
        className="text-sm leading-relaxed"
        style={{
          width: "100%",
          // Wide enough that a cell holds a short phrase; past the container it
          // scrolls sideways under the sticky first column.
          minWidth: width * 120,
          borderCollapse: "collapse",
        }}
      >
        {columns.length > 0 && (
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={col}
                  scope="col"
                  style={i === 0 ? { ...TABLE_HEAD_STYLE, ...STICKY_COLUMN_STYLE } : TABLE_HEAD_STYLE}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const tableWidth = (columns: string[], rows: string[][]) =>
  columns.length || Math.max(1, ...rows.map((r) => r.length));

const hasNodes = (n: React.ReactNode) => (Array.isArray(n) ? n.some(Boolean) : !!n);

function renderTableSection(
  rawRows: string[][],
  columns: string[],
  sectionKey: string,
  onKeywordClick: KeywordClickHandler,
  renderInline: (anchor: string) => React.ReactNode,
  collapsedByAnchor: Record<string, CollapsedRef[]>,
  onReopen: (key: string) => void,
  pr?: PersonalRender
) {
  const width = tableWidth(columns, rawRows);
  const rows = tableRows(rawRows, width);
  if (!rows.length) return null;

  return (
    <TableFrame columns={columns} width={width}>
      {rows.map((row, r) => {
        const anchor = `${sectionKey}:${r}`;
        if (pr?.skip(anchor)) return null;
        const collapsed = collapsedByAnchor[anchor] ?? [];
        const rowText = row.join(" | ");
        // A row is not edited in place — its cells are the table's shape — so
        // under it go only what the student asked for: an explanation, a card,
        // a note.
        const below = [renderInline(anchor), pr?.extras(anchor, rowText, rowText)];
        return (
          <Fragment key={r}>
            <tr
              data-enh-anchor={anchor}
              className={`group/item transition-colors hover:bg-secondary/40${layerLineClass(pr, anchor)}`}
              style={TABLE_ROW_STYLE}
            >
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={c === 0 ? "font-medium text-foreground" : "text-muted-foreground"}
                  style={c === 0 ? { ...TABLE_CELL_STYLE, ...STICKY_COLUMN_STYLE } : TABLE_CELL_STYLE}
                >
                  {c === 0 && pr?.known(anchor) && <KnownTick />}
                  {cell.trim() ? (
                    <span data-layer-text>
                      {renderRich(cell, `${anchor}-${c}`, onKeywordClick, collapsed, onReopen, pr?.highlights(anchor), pr?.onHighlightClick)}
                    </span>
                  ) : (
                    <span aria-label="Not given" style={{ color: "var(--fg-subtle)" }}>
                      —
                    </span>
                  )}
                  {c === row.length - 1 && pr && <span className="ml-1 inline-block align-middle">{pr.menu(anchor, rowText, false)}</span>}
                </td>
              ))}
            </tr>
            {below.some(hasNodes) && (
              <tr>
                <td colSpan={width} style={{ padding: "0 12px 8px" }}>
                  {below}
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </TableFrame>
  );
}

/** The table being written: cells fill in word by word, caret in the newest. */
function renderDraftTable(rawRows: string[][], columns: string[]) {
  const width = tableWidth(columns, rawRows);
  const rows = tableRows(rawRows, width);
  // The caret goes after the last cell with anything in it.
  const lastRow = rows.length - 1;
  const lastCell = lastRow >= 0 ? rows[lastRow].reduce((at, cell, i) => (cell.trim() ? i : at), 0) : -1;

  return (
    <TableFrame columns={columns} width={width}>
      {rows.map((row, r) => (
        <tr key={r} style={TABLE_ROW_STYLE}>
          {row.map((cell, c) => (
            <td
              key={c}
              className={c === 0 ? "font-medium text-foreground" : "text-muted-foreground"}
              style={c === 0 ? { ...TABLE_CELL_STYLE, ...STICKY_COLUMN_STYLE } : TABLE_CELL_STYLE}
            >
              <StreamingWords text={cell} />
              {r === lastRow && c === lastCell && <Caret />}
            </td>
          ))}
        </tr>
      ))}
    </TableFrame>
  );
}

/**
 * Resolve a saved enhancement (which stores only sourceText) to an inline anchor
 * by locating its source text within the sheet's sections. Returns null if the
 * text can't be found (e.g. the sheet was edited after the enhancement was made).
 */
function resolveSavedAnchor(sheet: GeneratedSheet, sourceText: string): string | null {
  const needle = sourceText.trim().toLowerCase();
  if (!needle) return null;
  const strip = (s: string) => s.replace(/\*\*/g, "").toLowerCase();
  const match = (haystack: string) =>
    findNeedleMatch(strip(haystack), needle) !== null;

  const stringSections: [string, string][] = [
    ["overview", sheet.overview ?? ""],
    ["clinicalApproach", sheet.clinicalApproach ?? ""],
  ];
  for (const [key, value] of stringSections) {
    const lines = value.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() && match(lines[i])) return `${key}:${i}`;
    }
  }

  const arraySections: [string, string[]][] = [
    ["memoryHooks", sheet.memoryHooks ?? []],
    ["keyPoints", sheet.keyPoints ?? []],
    ["examTraps", sheet.examTraps ?? []],
  ];
  for (const [key, items] of arraySections) {
    for (let i = 0; i < items.length; i++) {
      if (match(items[i])) return `${key}:${i}`;
    }
  }
  return null;
}

// ─── Shared sub-components ─────────────────────────────────────────────────

/** Credits the model that wrote the sheet, beside the first section's title. */
function ModelBadge({ model }: { model: ModelUsed }) {
  return (
    <span style={{ display: "inline-flex", marginLeft: 8 }}>
      <ModelCredit used={model} />
    </span>
  );
}

/**
 * Marks a section the retrieved sources back. An icon rather than a labelled
 * pill: it sat on most sections, and the same words on every heading read as
 * noise. The tooltip carries the words; clicking goes to the sources.
 */
function EvidenceBadge({ onClick }: { onClick: () => void }) {
  const label = "Evidence-backed — see the sources";
  return (
    // Its own provider, so the renderer works wherever it is mounted.
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150"
            style={{ color: "var(--accent)", background: "var(--accent-soft)" }}
          >
            <ShieldCheck style={{ width: 13, height: 13 }} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Deck offer (Flashcards section) ─────────────────────────────────────────

/**
 * Keeps the cards written beside the sheet. It turns into its own follow-up in
 * place once used, with the same swap as every other in-place change.
 */
function DeckOffer({ deck }: { deck: SheetDeck }) {
  return (
    <div className="mb-4 flex min-h-[52px] flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3.5 py-2.5">
      <AnimatePresence mode="wait" initial={false}>
        {deck.saved ? (
          <m.div key="saved" {...SWAP} className="flex w-full flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-primary" />
              In your deck — spaced repetition will bring each card back.
            </p>
            <button
              type="button"
              onClick={deck.onReview}
              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              Review in Library →
            </button>
          </m.div>
        ) : (
          <m.div key="offer" {...SWAP} className="flex w-full flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Keep these {deck.count} cards: each comes back just before you'd forget it.
            </p>
            <Button size="sm" onClick={deck.onSave} className="h-8 gap-1.5 text-xs">
              <Layers className="h-3.5 w-3.5" />
              Add {deck.count} cards to my deck
            </Button>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Floating enhance bubble ───────────────────────────────────────────────

interface EnhanceBubbleProps {
  /** Position relative to the document container (which scrolls with content). */
  top: number;
  left: number;
  onAction: (kind: EnhanceKind) => void;
  innerRef?: React.Ref<HTMLDivElement>;
}

// Anchored to the scrolling document container (its parent is `position: relative`),
// so the menu travels with the source text as the user scrolls — no scroll listeners.
const BUBBLE_BUTTON_STYLE: React.CSSProperties = {
  height: 24,
  padding: "0 8px",
  borderRadius: "var(--radius-pill)",
  border: "none",
  background: "transparent",
  fontFamily: "var(--font-sans)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "background var(--dur-micro) var(--ease-out)",
};

const BubbleDivider = () => (
  <span
    style={{ width: 1, height: 14, background: "var(--border-strong)" }}
    aria-hidden
  />
);

// Rendered inside AnimatePresence, so it fades back out when dismissed rather
// than vanishing. Motion owns the transform, hence `x` in place of translateX.
const EnhanceBubble = ({ top, left, onAction, innerRef }: EnhanceBubbleProps) => (
  <m.div
    ref={innerRef}
    initial={{ opacity: 0, y: 4, scale: 0.97 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: 4, scale: 0.97, transition: EXIT }}
    transition={ENTER}
    style={{
      position: "absolute",
      top,
      left,
      x: "-50%",
      zIndex: 60,
      display: "flex",
      alignItems: "center",
      height: 32,
      gap: 2,
      borderRadius: "var(--radius-pill)",
      border: "1px solid var(--border-strong)",
      background: "var(--bg-elevated)",
      padding: "0 6px",
      boxShadow: "var(--shadow-2)",
    }}
    onMouseDown={(e) => e.stopPropagation()}
  >
    <button
      type="button"
      onClick={() => onAction("enhance")}
      style={{ ...BUBBLE_BUTTON_STYLE, color: "var(--accent)" }}
    >
      ✦ Enhance
    </button>
    <BubbleDivider />
    <button
      type="button"
      onClick={() => onAction("expand")}
      style={{ ...BUBBLE_BUTTON_STYLE, color: "var(--fg)" }}
    >
      ↗ Expand
    </button>
    <BubbleDivider />
    <button
      type="button"
      onClick={() => onAction("clinical")}
      style={{ ...BUBBLE_BUTTON_STYLE, color: "var(--accent)" }}
    >
      🔗 Clinical
    </button>
  </m.div>
);

// ─── Inline enhancement block ──────────────────────────────────────────────

interface InlineEnhancementProps {
  enhKey: string;
  enhancement: ActiveEnhancement;
  topic: string;
  isPro: boolean;
  userId: string | null;
  isAnonymous: boolean;
  sheetId?: string;
  /** Pre-loaded result from a saved sheet — when present, render it without re-calling the AI. */
  savedResult?: string;
  onResult?: (key: string, result: EnhancementResult) => void;
  onClose: (key: string) => void;
}

const InlineEnhancement = ({
  enhKey,
  enhancement,
  topic,
  isPro,
  userId,
  isAnonymous,
  sheetId,
  savedResult,
  onResult,
  onClose,
}: InlineEnhancementProps) => {
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  // Only known for a result generated in this session; saved or cached results
  // don't record which model wrote them.
  const [enhanceModel, setEnhanceModel] = useState<ModelUsed | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // enhance reads the shared window but never writes a turn — see the MEMORY
  // note in the medical-notes edge function.
  const { useMemory } = useMemoryPreference();

  const cacheKey = `sb_enhance:${sheetId ?? "unsaved"}:${enhKey}`;
  const mode = kindToMode(enhancement.kind);

  const runEnhance = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const response = await callMedicalNotes(
        {
          enhanceMode: mode,
          itemText: enhancement.sourceText,
          sectionKey: enhancement.anchor,
          sectionItems: [],
          enhanceTopic: topic,
          isPro,
          userId,
          isAnonymous,
          useMemory,
          notes: enhancement.sourceText,
        },
        { signal: abortRef.current.signal }
      );

      if (!response.ok) throw new Error("Enhancement failed");
      setEnhanceModel(parseModelUsed(response.headers));

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            const text = parsed?.choices?.[0]?.delta?.content;
            if (typeof text === "string") {
              accumulated += text;
              setResult(accumulated);
            }
          } catch {
            // skip unparseable chunks
          }
        }
      }

      if (accumulated) {
        try {
          localStorage.setItem(cacheKey, accumulated);
        } catch {
          // quota exceeded
        }
        onResult?.(enhKey, {
          mode,
          sourceText: enhancement.sourceText,
          result: accumulated,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError("Enhancement failed. Try again.");
    } finally {
      setLoading(false);
    }
  }, [enhKey, enhancement, mode, topic, isPro, userId, isAnonymous, useMemory, cacheKey, onResult]);

  useEffect(() => {
    if (loading) {
      startTopProgress();
      return () => finishTopProgress();
    }
  }, [loading]);

  // On mount: prefer a saved result, then the local cache, only call the AI as a last resort.
  useEffect(() => {
    if (savedResult) {
      setResult(savedResult);
      return;
    }
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      setResult(cached);
      return;
    }
    runEnhance();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => onClose(enhKey), 160);
  };

  return (
    <span
      className={`block mt-3 ${closing ? "inline-enh-exit" : "inline-enh-enter"}`}
    >
      <span
        className="block"
        style={{
          borderLeft: "3px solid var(--accent)",
          borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
          background: "var(--accent-soft)",
          padding: "10px 16px 12px",
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--accent)",
            }}
          >
            {kindLabel[enhancement.kind]}
          </span>
          {enhanceModel && (
            <span style={{ marginLeft: "auto" }}>
              <ModelCredit used={enhanceModel} compact />
            </span>
          )}
          <button
            type="button"
            onClick={handleClose}
            aria-label="Dismiss enhancement"
            style={{
              flexShrink: 0,
              marginTop: -2,
              marginRight: -4,
              padding: 4,
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              border: "none",
              color: "var(--fg-muted)",
              cursor: "pointer",
              opacity: 0.6,
              transition: "opacity var(--dur-micro) var(--ease-out)",
            }}
          >
            <X style={{ width: 12, height: 12 }} />
          </button>
        </span>

        {loading && !result && (
          <span className="block space-y-2 pt-1">
            <span
              className="block animate-pulse rounded"
              style={{ height: 10, width: "91.666%", background: "var(--border-strong)" }}
            />
            <span
              className="block animate-pulse rounded"
              style={{ height: 10, width: "75%", background: "var(--border-strong)" }}
            />
            <span
              className="block animate-pulse rounded"
              style={{ height: 10, width: "83.333%", background: "var(--border-strong)" }}
            />
          </span>
        )}
        {result && (
          <span
            style={{
              display: "block",
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              color: "var(--fg-muted)",
              lineHeight: 1.6,
              paddingTop: 4,
            }}
          >
            {renderFormattedContent(result)}
          </span>
        )}
        {error && !loading && (
          <span style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 6 }}>
            <span style={{ fontSize: 12, color: "var(--signal)", flex: 1 }}>{error}</span>
            <button
              type="button"
              onClick={runEnhance}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                color: "var(--accent)",
                background: "none",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
                flexShrink: 0,
              }}
            >
              <RotateCcw style={{ width: 11, height: 11 }} /> Retry
            </button>
          </span>
        )}
      </span>
    </span>
  );
};

// ─── Main component ───────────────────────────────────────────────────────

/** The personal layer's state is the provider's, so the body can read it. */
const OutputSection = (props: OutputSectionProps) => {
  const body = <OutputSectionBody {...props} />;
  const withBranches = props.branches ? <BranchesProvider value={props.branches}>{body}</BranchesProvider> : body;
  return props.personal ? <PersonalProvider value={props.personal}>{withBranches}</PersonalProvider> : withBranches;
};

const OutputSectionBody = ({
  output,
  inputText,
  modeInfo,
  citations,
  citationState,
  onCitationLockedClick,
  citationIsLoggedIn,
  modelUsed,
  isPro = false,
  userId,
  isAnonymous,
  sheetId,
  isStreaming = false,
  streamedKeys,
  liveKey,
  showHeader = true,
  deck,
  rewrites,
}: OutputSectionProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const personal = usePersonal();
  const branches = useBranches();
  const referenceNoteRef = useRef<HTMLDivElement>(null);
  // The section asking, in the student's own words, how it should be rewritten.
  const [customFor, setCustomFor] = useState<string | null>(null);

  // The highlight-to-enhance tip is shown until it is dismissed or the reader
  // enhances something, then never again.
  const [tipSeen, setTipSeen] = useState(() => readFlag(ENHANCE_TIP_KEY));
  const retireTip = useCallback(() => {
    setTipSeen(true);
    writeFlag(ENHANCE_TIP_KEY);
  }, []);

  // Sections this mount has seen waiting. One that then lands gets a single
  // glow; a saved sheet, which never waited, opens without any.
  const seenPendingRef = useRef(new Set<string>());

  const [disclaimerCollapsed, setDisclaimerCollapsed] = useState(() =>
    sessionStorage.getItem("sb_disclaimer_collapsed") === "1"
  );

  // Inline enhancement state
  const [activeEnhancements, setActiveEnhancements] = useState<Record<string, ActiveEnhancement>>(() => {
    // Pre-populate from saved sheet enhancements if present. Each saved
    // enhancement is resolved back to the line it came from and rendered as a
    // collapsed golden highlight, so saved sheets look exactly like the live
    // generator. Unresolvable ones fall back to an expanded block at the end.
    if (!isJsonSheet(output)) return {};
    const parsed = parseStoredSheet(output);
    if (!parsed?.enhancements) return {};
    return Object.fromEntries(
      Object.entries(parsed.enhancements).map(([key, r]) => {
        const resolved = resolveSavedAnchor(parsed, r.sourceText);
        return [
          key,
          {
            sourceText: r.sourceText,
            kind: r.mode,
            anchor: resolved ?? "referenceNote:end",
            isCollapsed: resolved !== null,
            savedResult: r.result,
          } as ActiveEnhancement,
        ];
      })
    );
  });

  const generated: GeneratedSheet | null = isJsonSheet(output) ? parseStoredSheet(output) : null;
  if (generated && generated.overview === undefined && (generated as { summary?: string }).summary !== undefined) {
    generated.overview = (generated as { summary?: string }).summary as string;
  }
  // The student's rewrites in place, unless they are looking at the
  // original. Everything below — lines, anchors, edits — reads this sheet.
  const sheet: GeneratedSheet | null =
    generated && personal && !personal.showOriginal ? withLayerSections(generated, personal.layer) : generated;
  const isJson = sheet !== null;

  // Keyword-click menu state — only used in JSON renderer. `top`/`left` are
  // relative to the document container so the menu scrolls with the content.
  const [keywordPicker, setKeywordPicker] = useState<{ text: string; anchor: string; top: number; left: number } | null>(null);
  const keywordPickerRef = useRef<HTMLDivElement>(null);

  // Convert a viewport rect into a position below the source, relative to the
  // (position: relative) document container, with horizontal clamping so the
  // ~250px menu never spills past the container edges.
  const anchorMenuPos = useCallback((rect: DOMRect) => {
    const c = ref.current?.getBoundingClientRect();
    const rawLeft = rect.left + rect.width / 2 - (c?.left ?? 0);
    return {
      top: rect.bottom - (c?.top ?? 0) + 6,
      left: Math.min(Math.max(125, rawLeft), (c?.width ?? rawLeft + 125) - 125),
    };
  }, []);

  const handleKeywordClick = useCallback(
    (keyword: string, rect: DOMRect, anchor: string) => {
      setKeywordPicker({ text: keyword, anchor, ...anchorMenuPos(rect) });
    },
    [anchorMenuPos]
  );

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (keywordPickerRef.current && !keywordPickerRef.current.contains(e.target as Node)) {
        setKeywordPicker(null);
      }
    }
    if (keywordPicker) {
      document.addEventListener("mousedown", handleOutsideClick);
      return () => document.removeEventListener("mousedown", handleOutsideClick);
    }
  }, [keywordPicker]);

  const addEnhancement = (sourceText: string, kind: EnhanceKind, anchor: string) => {
    // Using the feature is the surest sign the tip has done its job.
    retireTip();
    const key = makeEnhancementKey(sourceText, kind);
    setActiveEnhancements((prev) => ({
      ...prev,
      [key]: { sourceText, kind, anchor },
    }));
  };

  const fireKeywordEnhance = (kind: EnhanceKind) => {
    if (!keywordPicker) return;
    addEnhancement(keywordPicker.text, kind, keywordPicker.anchor);
    setKeywordPicker(null);
  };

  // Selection-to-enhance state. `top`/`left` are container-relative (see above).
  // `mark` is where a highlight of it would anchor, when the student has a
  // layer and the selection starts inside one line.
  const [selection, setSelection] = useState<{
    text: string;
    anchor: string;
    top: number;
    left: number;
    mark: MarkTarget | null;
  } | null>(null);
  const selectionTooltipRef = useRef<HTMLDivElement>(null);
  const personalOn = !!personal && !isStreaming && !personal.readOnly;

  const handleSelectionChange = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setSelection(null);
      return;
    }
    const text = sel.toString().trim();
    // Enhancing wants a phrase; a highlight can be a single term.
    if (personalOn ? text.length < 2 : text.split(/\s+/).length < 3) {
      setSelection(null);
      return;
    }
    if (!ref.current) return;
    const range = sel.getRangeAt(0);
    if (!ref.current.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    const startEl =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const rect = range.getBoundingClientRect();
    setSelection({
      text,
      anchor: anchorFromElement(startEl),
      ...anchorMenuPos(rect),
      mark: personalOn ? markTarget(range) : null,
    });
  }, [anchorMenuPos, personalOn]);

  const fireSelectionEnhance = (kind: EnhanceKind) => {
    if (!selection) return;
    addEnhancement(selection.text, kind, selection.anchor);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const clearSelection = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  // ── The student's own layer: highlights, and AI on a line ─────────────────
  const [highlightMenu, setHighlightMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const highlightMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!highlightMenu) return;
    const onDown = (e: MouseEvent) => {
      if (highlightMenuRef.current && !highlightMenuRef.current.contains(e.target as Node)) setHighlightMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHighlightMenu(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [highlightMenu]);

  /** The line at an anchor as the student currently sees it. */
  const effectiveAt = (p: PersonalApi, s: GeneratedSheet, anchor: string) => {
    const original = originalLine(s, anchor) ?? "";
    return p.showOriginal ? original : p.layer.edits[anchor]?.text ?? original;
  };

  const markSelection = (intent: HighlightIntent) => {
    const target = selection?.mark;
    if (!target || !personal) return;
    personal.guard(() => personal.update((l) => addHighlight(l, { ...target, intent })));
    clearSelection();
  };

  useEffect(() => {
    function handleOutsideSelectionClick(e: MouseEvent) {
      if (
        selectionTooltipRef.current &&
        !selectionTooltipRef.current.contains(e.target as Node)
      ) {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) setSelection(null);
      }
    }
    if (selection) {
      document.addEventListener("mousedown", handleOutsideSelectionClick);
      return () => document.removeEventListener("mousedown", handleOutsideSelectionClick);
    }
  }, [selection]);

  // Escape dismisses any open bubble
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelection(null);
        setKeywordPicker(null);
      }
    }
    if (selection || keywordPicker) {
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
  }, [selection, keywordPicker]);

  // Dismissing an enhancement collapses it into a golden highlight on its source
  // text rather than deleting it, so students never lose track of what they enhanced.
  const closeEnhancement = (key: string) => {
    setActiveEnhancements((prev) => {
      if (!prev[key]) return prev;
      return { ...prev, [key]: { ...prev[key], isCollapsed: true } };
    });
  };

  // Clicking a golden highlight re-opens the enhancement inline.
  const reopenEnhancement = (key: string) => {
    setActiveEnhancements((prev) => {
      if (!prev[key]) return prev;
      return { ...prev, [key]: { ...prev[key], isCollapsed: false } };
    });
  };

  const handleEnhancementResult = useCallback(
    (key: string, result: EnhancementResult) => {
      window.dispatchEvent(
        new CustomEvent("studybuddy:enhancement-saved", {
          detail: { key, result },
        })
      );
    },
    []
  );

  const toggleDisclaimer = () => {
    setDisclaimerCollapsed((prev) => {
      const next = !prev;
      sessionStorage.setItem("sb_disclaimer_collapsed", next ? "1" : "0");
      return next;
    });
  };

  const scrollToReference = () => {
    referenceNoteRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Tracks the identity of the *core* sheet content (ignoring enhancements) so
  // the disclaimer reopens only for a genuinely new sheet — not when an
  // enhancement is saved into the sheet (which also mutates `output`).
  // Scrolling is the page's business: this used to scroll the document into
  // view here, which under a sticky page header yanked the reader down the
  // moment a sheet finished.
  const sheetIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    // Identity tracks `overview`, which grows with every chunk — scrolling on
    // that mid-stream would yank the page under the reader on every section.
    if (isStreaming) return;
    const hasContent = isJson ? !!sheet : parseSections(output).length > 0;
    if (!hasContent) return;
    const identity = isJson ? `${sheet?.topic ?? ""}::${sheet?.overview ?? ""}` : output;
    const isNewSheet = sheetIdentityRef.current !== identity;
    sheetIdentityRef.current = identity;
    if (isNewSheet) {
      setDisclaimerCollapsed(false);
      sessionStorage.removeItem("sb_disclaimer_collapsed");
    }
    // The dashboard's first-deck banner waits for this: a whole sheet seen.
    writeFlag("sb_first_sheet_seen");
  }, [output, isStreaming]);

  // ── Legacy renderer ──────────────────────────────────────────────────────
  if (!isJson) {
    const sections = parseSections(output);

    if (sections.length === 0) {
      return (
        <div ref={ref} className="print-document">
          <div
            className="animate-fade-in"
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-elevated)",
              padding: 24,
            }}
          >
            <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
              {output}
            </div>
          </div>
        </div>
      );
    }

    const hasReferenceSection = sections.some((s) => s.title === "REFERENCE NOTE");

    return (
      <div ref={ref} className="print-document space-y-4">
        <div className="animate-fade-in flex items-center justify-between">
          {modeInfo && <ModeInfoBar modeInfo={modeInfo} />}
          <SaveButton input={inputText || ""} output={output} modeInfo={modeInfo} />
        </div>

        {sections.map(({ title, content }, idx) => {
          const config = sectionConfig[title];
          const Icon = config.icon;
          const isReference = title === "REFERENCE NOTE";
          const showEvidenceBadge =
            citationState === "found" && EVIDENCE_SECTIONS_LEGACY.includes(title);

          return (
            <div
              key={title}
              ref={isReference ? referenceNoteRef : undefined}
              className="animate-fade-in"
              style={{
                ...SECTION_CARD_STYLE,
                animationDelay: `${idx * 200}ms`,
                animationFillMode: "backwards",
              }}
            >
              <div style={SECTION_HEADER_STYLE}>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <div style={SECTION_ICON_STYLE}>
                    <Icon style={{ width: 14, height: 14, color: "var(--accent)" }} />
                  </div>
                  <h3 style={SECTION_TITLE_STYLE}>{config.label}</h3>
                  {showEvidenceBadge && <EvidenceBadge onClick={scrollToReference} />}
                  {title === "SUMMARY" && modelUsed && (
                    <ModelBadge model={modelUsed} />
                  )}
                </div>
                <CopyButton text={content} />
              </div>
              <div style={SECTION_BODY_STYLE}>
                {title === "FLASHCARDS" ? (
                  <FlashcardsSection content={content} />
                ) : (
                  <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {renderFormattedContent(content)}
                  </div>
                )}
                {isReference && citationState && citationState !== "idle" && citationState !== "hidden" && (
                  <div className="mt-3">
                    <CitationBadgeList
                      state={citationState}
                      citations={citations}
                      onLockedClick={onCitationLockedClick}
                      isLoggedIn={citationIsLoggedIn}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {!hasReferenceSection && citationState && citationState !== "idle" && citationState !== "hidden" && (
          <div className="animate-fade-in" style={SECTION_CARD_STYLE}>
            <div style={SECTION_HEADER_STYLE}>
              <div className="flex items-center gap-2.5">
                <div style={SECTION_ICON_STYLE}>
                  <FileText style={{ width: 14, height: 14, color: "var(--accent)" }} />
                </div>
                <h3 style={SECTION_TITLE_STYLE}>📚 Reference Note</h3>
              </div>
            </div>
            <div style={SECTION_BODY_STYLE}>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                Based on standard medical references and clinical guidelines.
              </p>
              <CitationBadgeList
                state={citationState}
                citations={citations}
                onLockedClick={onCitationLockedClick}
                isLoggedIn={citationIsLoggedIn}
              />
            </div>
          </div>
        )}

        {renderDisclaimer(disclaimerCollapsed, toggleDisclaimer)}
      </div>
    );
  }

  // ── JSON renderer ────────────────────────────────────────────────────────
  // The sheet's own plan when it has one, the legacy six otherwise. The plan
  // arrives in a __meta frame ahead of the model's first byte, so the shape is
  // settled before any content lands and the skeleton never reflows.
  const sectionOrder = renderOrder(sheet);

  // One recall question per section, drawn from the deck. The deck arrives at
  // the end of the stream, so these appear once the sheet is whole — which is
  // also when a reader is ready to be asked.
  const recallCards = isStreaming ? null : assignRecallCards(sheet);

  // Every section keeps its slot for the whole generation, so the document
  // never changes shape — placeholders are filled in rather than replaced.
  // A section renders its content only once its JSON has closed; before that
  // it would show half a sentence and then reflow.
  const isReady = (key: string) => !isStreaming || !!streamedKeys?.includes(key);
  // The parser names the key in flight when the caller passes it on. Without
  // it, sections arrive in order, so the first one not yet complete is in flight.
  const liveSection =
    isStreaming && liveKey && sectionOrder.some((s) => s.key === liveKey) ? liveKey : undefined;
  const writingKey = isStreaming
    ? liveSection ?? sectionOrder.find((spec) => !isReady(spec.key))?.key
    : undefined;

  // Group active enhancements by anchor so they can be injected inline.
  // Open ones render as inline blocks; collapsed ones render as golden
  // highlights wrapped around their source text.
  const enhancementsByAnchor: Record<string, [string, ActiveEnhancement][]> = {};
  const collapsedByAnchor: Record<string, CollapsedRef[]> = {};
  for (const [key, enh] of Object.entries(activeEnhancements)) {
    (enhancementsByAnchor[enh.anchor] ??= []).push([key, enh]);
    if (enh.isCollapsed) {
      (collapsedByAnchor[enh.anchor] ??= []).push({ key, sourceText: enh.sourceText });
    }
  }

  const renderEnhancements = (anchor: string): React.ReactNode => {
    const entries = enhancementsByAnchor[anchor];
    if (!entries?.length) return null;
    return entries
      .filter(([, enh]) => !enh.isCollapsed)
      .map(([key, enh]) => (
        <InlineEnhancement
          key={key}
          enhKey={key}
          enhancement={enh}
          topic={sheet.topic ?? inputText ?? ""}
          isPro={isPro}
          userId={userId ?? null}
          isAnonymous={isAnonymous ?? false}
          sheetId={sheetId ?? inputText}
          savedResult={enh.savedResult}
          onResult={handleEnhancementResult}
          onClose={closeEnhancement}
        />
      ));
  };

  /**
   * What goes under a line: its open enhancements, then its branches. Null
   * when there is neither, so a table adds no empty row for it.
   */
  const renderInline = (anchor: string): React.ReactNode => {
    const enhancements = renderEnhancements(anchor);
    const chips = !isStreaming && lineHasBranches(branches, anchor) ? <LineBranches key="branches" anchor={anchor} /> : null;
    if (!chips) return enhancements;
    return enhancements ? [enhancements, chips] : chips;
  };

  // ── The student's layer, as each line needs it ──────────────────────────
  // Not while the sheet is still arriving: its lines are still being written.
  const titleOf = (anchor: string) => sectionOrder.find((s) => s.key === anchorSection(anchor))?.title ?? "";
  const isTableAnchor = (anchor: string) => isTableRows(sectionBody(sheet, anchorSection(anchor)));
  const p = personal && !isStreaming ? personal : null;
  const highlightsByAnchor: Record<string, LayerHighlight[]> = {};
  for (const h of p?.layer.highlights ?? []) (highlightsByAnchor[h.anchor] ??= []).push(h);
  const pr: PersonalRender | undefined = p
    ? {
        text: (a, o) => (p.showOriginal ? o : p.layer.edits[a]?.text ?? o),
        edited: (a) => (p.showOriginal ? null : p.layer.edits[a]?.source ?? null),
        skip: (a) =>
          (p.layer.hidden.includes(a) && !p.showOriginal) || (p.hideKnown && p.layer.known.includes(a)),
        removed: (a) => p.showOriginal && p.layer.hidden.includes(a),
        known: (a) => p.layer.known.includes(a),
        highlights: (a) => highlightsByAnchor[a] ?? [],
        onHighlightClick: p.readOnly
          ? undefined
          : (id, el) => setHighlightMenu({ id, ...anchorMenuPos(el.getBoundingClientRect()) }),
        menu: (a, eff, canEdit) =>
          p.readOnly ? null : <ItemMenu anchor={a} effective={eff} sectionTitle={titleOf(a)} canEdit={canEdit} />,
        extras: (a, o, eff) =>
          p.layer.notes.some((n) => n.anchor === a) ||
          p.suggestion?.anchor === a ||
          p.editing === a ||
          p.noting === a ||
          p.asking === a ? (
            <PersonalExtras anchor={a} original={o} effective={eff} sectionTitle={titleOf(a)} />
          ) : null,
        additions: (s) => (p.showOriginal ? [] : p.layer.additions.filter((x) => x.section === s)),
      }
    : undefined;

  const aiOnSelection = (choice: AiChoice) => {
    const target = selection?.mark;
    if (!target || !p) return;
    p.runSuggestion({
      anchor: target.anchor,
      action: choice.action,
      label: choice.label,
      style: choice.action === "rewrite" ? choice.style : undefined,
      original: effectiveAt(p, sheet, target.anchor),
      // The whole line is what's rewritten; the selection is where to look.
      focus: target.quote,
      sectionTitle: titleOf(target.anchor),
    });
    clearSelection();
  };

  const menuHighlight = highlightMenu ? p?.layer.highlights.find((h) => h.id === highlightMenu.id) ?? null : null;
  const highlightAi = (action: "explain" | "card") => {
    if (!menuHighlight || !p) return;
    p.runSuggestion({
      anchor: menuHighlight.anchor,
      action,
      label: action === "card" ? "New flashcard" : "Explained",
      original: effectiveAt(p, sheet, menuHighlight.anchor),
      focus: menuHighlight.quote,
      sectionTitle: titleOf(menuHighlight.anchor),
    });
    setHighlightMenu(null);
  };

  // The cards the student made from this sheet, after the ones written with it.
  const myCards = p && !p.showOriginal ? p.layer.cards.map((c) => ({ tag: "Mine", question: c.question, answer: c.answer })) : [];

  // ── Rewrites ───────────────────────────────────────────────────────────
  const isContentKey = (key: string) => key !== "flashcards" && key !== "referenceNote";

  /** A rewrite mid-write, in the draft renderers. */
  const renderDraftBody = (spec: SheetSectionSpec, body: SectionBody) =>
    isTableRows(body)
      ? renderDraftTable(body, spec.columns ?? [])
      : Array.isArray(body)
      ? renderDraftList(bodyLines(body))
      : spec.kind !== "prose"
      ? renderDraftList([body])
      : renderDraftProse(body);

  /** The label on a rewritten section. */
  const rewriteLabel = (style?: string) =>
    style === "custom" ? "your way" : REGEN_CHOICES.find((c) => c.style === style)?.label.toLowerCase() ?? "rewritten";

  return (
    <LazyMotion features={domAnimation} strict>
    <MotionConfig reducedMotion="user">
    <div
      ref={ref}
      className="print-document relative space-y-4"
      onMouseUp={handleSelectionChange}
      onTouchEnd={handleSelectionChange}
    >
      {showHeader ? (
        <div className="animate-fade-in flex items-center justify-between">
          {modeInfo && <ModeInfoBar modeInfo={modeInfo} />}
          <SaveButton
            input={inputText || ""}
            output={output}
            modeInfo={modeInfo}
            disabled={isStreaming}
          />
        </div>
      ) : (
        // The page's own header is outside the printed document, so the
        // print carries its title here.
        <h1 className="hidden text-xl font-semibold print:block">
          {sheet.topicEmoji ? `${sheet.topicEmoji} ` : ""}
          {sheet.topic || inputText}
        </h1>
      )}

      {p && <LayerBar />}

      {sectionOrder.map((spec, idx) => {
        const key = spec.key;
        const Icon = sectionIcon(spec.icon);
        const isReference = key === "referenceNote";
        const ready = isReady(key);
        const writing = key === writingKey;
        const showEvidenceBadge =
          ready && citationState === "found" && !!spec.evidenceBacked;
        if (!ready) seenPendingRef.current.add(key);
        const landed = ready && seenPendingRef.current.has(key);

        const body = sectionBody(sheet, key);
        // The draft of the section in flight, once it has any words to show.
        const draft =
          !ready && key === liveSection && key !== "flashcards"
            ? key === "referenceNote"
              ? sheet.referenceNote || undefined
              : Array.isArray(body)
              ? body.length
                ? body
                : undefined
              : body?.trim()
              ? body
              : undefined
            : undefined;
        const copyText =
          key === "flashcards"
            ? (sheet.flashcards ?? [])
                .map((c) => `Q: [${c.tag}] ${c.question}\nA: ${c.answer}`)
                .join("\n\n")
            : isTableRows(body)
            ? [spec.columns?.join(" | "), ...bodyLines(body)].filter(Boolean).join("\n")
            : Array.isArray(body)
            ? bodyLines(body).map((item, i) => `${i + 1}. ${item}`).join("\n")
            : body ?? "";

        // A rewrite: running (its draft stands in for the section), or kept
        // (the heading says so, and the menu can take it back).
        const job = rewrites?.jobs[key];
        const rewriting = job?.action === "regenerate" && job.status === "running";
        const rewriteDraft = rewriting ? rewrites?.drafts[key] : undefined;
        const kept = p && !p.showOriginal ? p.layer.sections[key] : undefined;
        const rewritten = kept?.kind === "rewrite" ? kept : undefined;

        return (
          <div
            key={key}
            ref={isReference ? referenceNoteRef : undefined}
            data-section-key={key}
            // Clears the app nav and the sheet's sticky topic bar on a jump.
            className={`group/section animate-fade-in scroll-mt-[calc(var(--nav-h,64px)+100px)]${landed ? " section-landed" : ""}`}
            style={{
              ...SECTION_CARD_STYLE,
              // A section that hasn't landed keeps a neutral edge, so the
              // accent lighting up is the signal that its content arrived.
              borderLeft: `3px solid ${
                ready || writing ? "var(--accent)" : "var(--border)"
              }`,
              // Mid-stream the cards mount together when the plan arrives,
              // before any content: a short stagger lets them rise in one
              // after another. A saved sheet opens with the longer one.
              animationDelay: isStreaming ? `${idx * 60}ms` : `${idx * 200}ms`,
              animationFillMode: "backwards",
            }}
          >
            <div style={SECTION_HEADER_STYLE}>
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <div style={SECTION_ICON_STYLE}>
                  <Icon
                    style={{
                      width: 14,
                      height: 14,
                      color: ready || writing ? "var(--accent)" : "var(--fg-subtle)",
                    }}
                  />
                </div>
                <h3
                  style={{
                    ...SECTION_TITLE_STYLE,
                    color: ready || writing ? "var(--fg)" : "var(--fg-muted)",
                  }}
                >
                  {spec.title}
                  {idx === 0 && sheet.topicEmoji && (
                    <span className="ml-2 text-base">{sheet.topicEmoji}</span>
                  )}
                </h3>
                {showEvidenceBadge && <EvidenceBadge onClick={scrollToReference} />}
                {ready && idx === 0 && modelUsed && <ModelBadge model={modelUsed} />}
                {rewritten && (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Rewritten · {rewriteLabel(rewritten.style)}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {ready ? (
                  <>
                    {/* A check says a section has arrived — news only while
                        the sheet is still arriving. On a finished sheet every
                        heading would carry one. */}
                    {isStreaming && (
                      <m.span
                        initial={{ scale: 0.3, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={SPRING_POP}
                        style={{ display: "inline-flex" }}
                      >
                        <Check aria-label="Section loaded" className="h-3.5 w-3.5 text-primary/50" />
                      </m.span>
                    )}
                    <span className="transition-opacity duration-200 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/section:opacity-100 [@media(hover:hover)]:group-focus-within/section:opacity-100">
                      <CopyButton text={copyText} compact />
                    </span>
                    {!isStreaming && rewrites && isContentKey(key) && (
                      <SectionMenu
                        title={spec.title}
                        disabled={!rewrites.enabled || !!job && job.status === "running"}
                        onRewrite={(style) => rewrites.rewrite(key, style)}
                        onCustom={() => setCustomFor(key)}
                        onUndo={rewritten ? () => rewrites.undoRewrite(key) : undefined}
                      />
                    )}
                  </>
                ) : (
                  // Marks where the next content lands. Only the dot pulses —
                  // animating the whole card would be a distraction to read past.
                  <span
                    aria-label={writing ? "Writing section" : "Waiting"}
                    className={writing ? "animate-pulse" : undefined}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: writing ? "var(--accent)" : "var(--border-strong)",
                      margin: "0 9px",
                    }}
                  />
                )}
              </div>
            </div>

            <AutoHeight>
            <div style={SECTION_BODY_STYLE} data-enh-section={key}>
              {customFor === key && rewrites && (
                <CustomRewrite
                  onSubmit={(instruction) => {
                    setCustomFor(null);
                    rewrites.rewrite(key, "custom", instruction);
                  }}
                  onCancel={() => setCustomFor(null)}
                />
              )}
              {rewriting ? (
                <div aria-busy="true" className="text-sm text-muted-foreground leading-relaxed">
                  <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                    Rewriting — {job?.label ?? "your way"}…
                  </p>
                  {hasBody(rewriteDraft) ? renderDraftBody(spec, rewriteDraft!) : <SectionSkeleton variant="sheet-body" />}
                </div>
              ) : !ready && draft !== undefined ? (
                <div aria-busy="true" className="text-sm text-muted-foreground leading-relaxed">
                  {isTableRows(draft)
                    ? renderDraftTable(draft, spec.columns ?? [])
                    : Array.isArray(draft)
                    ? renderDraftList(bodyLines(draft))
                    : spec.kind !== "prose"
                    ? renderDraftList([draft])
                    : renderDraftProse(draft)}
                </div>
              ) : !ready ? (
                <SectionSkeleton variant="sheet-body" />
              ) : key === "flashcards" ? (
                <>
                  {deck && deck.count > 0 && <DeckOffer deck={deck} />}
                  <FlashcardsSection cards={[...(sheet.flashcards ?? []), ...myCards]} />
                </>
              ) : key !== "referenceNote" && spec.kind === "prose" ? (
                <div className="text-sm text-muted-foreground leading-relaxed">
                  {renderJsonText(
                    typeof body === "string" ? body : "",
                    key,
                    handleKeywordClick,
                    renderInline,
                    collapsedByAnchor,
                    reopenEnhancement,
                    pr
                  )}
                </div>
              ) : key === "referenceNote" ? (
                <>
                  <div className="text-sm text-muted-foreground leading-relaxed">
                    {sheet.referenceNote}
                  </div>

                  {citationState && citationState !== "idle" && citationState !== "hidden" && (
                    <div className="mt-3">
                      <CitationBadgeList
                        state={citationState}
                        citations={citations}
                        onLockedClick={onCitationLockedClick}
                        isLoggedIn={citationIsLoggedIn}
                      />
                    </div>
                  )}

                  {/* The passages the sheet was built on, here rather than in
                      a panel of their own after the end of the sheet. */}
                  {!isStreaming && (sheet.sources?.length ?? 0) > 0 && (
                    <div className="mt-5 border-t border-border pt-4">
                      <SheetSources sources={sheet.sources ?? []} query={inputText} embedded />
                    </div>
                  )}
                </>
              ) : isTableRows(body) ? (
                // By the shape that arrived, not only the plan's kind: a model
                // that wrote rows under a list heading still gets a table, and
                // one that wrote items under a table heading falls to the list.
                renderTableSection(
                  body,
                  spec.columns ?? [],
                  key,
                  handleKeywordClick,
                  renderInline,
                  collapsedByAnchor,
                  reopenEnhancement,
                  pr
                )
              ) : (
                renderArraySection(
                  bodyLines(body),
                  key,
                  renderInline,
                  collapsedByAnchor,
                  reopenEnhancement,
                  pr
                )
              )}
              {ready && renderInline(`${key}:end`)}
              {ready && !rewriting && branches && <PrintBranches sectionKey={key} />}
              {ready && p && key !== "flashcards" && key !== "referenceNote" && (
                <SectionFooter
                  sectionKey={key}
                  canAdd={!isTableRows(body)}
                  knownHidden={p.hideKnown ? p.layer.known.filter((a) => anchorSection(a) === key).length : 0}
                />
              )}
              {recallCards?.has(key) && <RecallCheck card={recallCards.get(key)!} />}
            </div>
            </AutoHeight>
          </div>
        );
      })}

      {/* Fallback: selections that couldn't be anchored to a specific line */}
      {enhancementsByAnchor["end"]?.length ? (
        <div className="space-y-1">{renderInline("end")}</div>
      ) : null}

      {/* The last line of the document, under its Sources. */}
      {renderDisclaimer(disclaimerCollapsed, toggleDisclaimer)}

      <EnhanceTip show={!isStreaming && !tipSeen} onDismiss={retireTip} />

      {/* Anchored action menu — selection (below the highlighted text). With a
          personal layer it also marks the passage and runs AI on its line. */}
      <AnimatePresence>
        {selection &&
          (p && !p.readOnly ? (
            <SelectionToolbar
              key="selection"
              innerRef={selectionTooltipRef}
              top={selection.top}
              left={selection.left}
              onEnhance={fireSelectionEnhance}
              canMark={!!selection.mark}
              canRewrite={!!selection.mark && !isTableAnchor(selection.mark.anchor)}
              locked={!p.entitled}
              onHighlight={markSelection}
              onAi={aiOnSelection}
            />
          ) : (
            <EnhanceBubble
              key="selection"
              innerRef={selectionTooltipRef}
              top={selection.top}
              left={selection.left}
              onAction={fireSelectionEnhance}
            />
          ))}
      </AnimatePresence>

      {/* What clicking one of the student's own highlights offers. */}
      <AnimatePresence>
        {highlightMenu && menuHighlight && p && (
          <HighlightMenu
            key="highlight"
            innerRef={highlightMenuRef}
            top={highlightMenu.top}
            left={highlightMenu.left}
            intent={menuHighlight.intent}
            editable={p.editable}
            onIntent={(intent) => {
              p.update((l) => setHighlightIntent(l, menuHighlight.id, intent));
              setHighlightMenu(null);
            }}
            onExplain={() => highlightAi("explain")}
            onCard={() => highlightAi("card")}
            onRemove={() => {
              p.update((l) => removeHighlight(l, menuHighlight.id));
              setHighlightMenu(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* Anchored action menu — bold keyword click (below the keyword) */}
      <AnimatePresence>
        {keywordPicker && !selection && (
          <EnhanceBubble
            key="keyword"
            innerRef={keywordPickerRef}
            top={keywordPicker.top}
            left={keywordPicker.left}
            onAction={fireKeywordEnhance}
          />
        )}
      </AnimatePresence>
    </div>
    </MotionConfig>
    </LazyMotion>
  );
};

// ─── Shared disclaimer (used by both renderers) ─────────────────────────────
//
// The first-sheet nudge that used to sit above it is gone: its "Generate
// flashcards" opened the Flashcards page to make a new deck, beside a sheet
// that already has one. The Sheets page ends on its own next-steps card.

function renderDisclaimer(disclaimerCollapsed: boolean, toggleDisclaimer: () => void) {
  return (
    <>
      <div
        className="animate-fade-in"
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
          paddingTop: 4,
          marginTop: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, minWidth: 0 }}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            style={{
              width: 13,
              height: 13,
              color: "var(--fg-subtle)",
              marginTop: 1,
              flexShrink: 0,
            }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {!disclaimerCollapsed && (
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--fg-subtle)",
                lineHeight: 1.5,
                letterSpacing: "0.04em",
              }}
            >
              AI-generated · May contain errors · Not a substitute for clinical judgment
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={toggleDisclaimer}
          aria-label={disclaimerCollapsed ? "Expand disclaimer" : "Collapse disclaimer"}
          style={{
            flexShrink: 0,
            background: "none",
            border: "none",
            color: "var(--fg-subtle)",
            cursor: "pointer",
            padding: 2,
          }}
        >
          {disclaimerCollapsed ? (
            <ChevronDown style={{ width: 13, height: 13 }} />
          ) : (
            <ChevronUp style={{ width: 13, height: 13 }} />
          )}
        </button>
      </div>
    </>
  );
}

export default OutputSection;
