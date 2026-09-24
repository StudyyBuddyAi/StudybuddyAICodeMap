import { useRef, useEffect, useState, useCallback } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
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
  Sparkles,
  Stethoscope,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import CopyButton from "@/components/CopyButton";
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
  parseStoredSheet,
  isJsonSheet,
} from "@/types/generated-sheet";
import { renderOrder, sectionBody } from "@/lib/sheet-plan";
import {
  AnimatePresence,
  LazyMotion,
  MotionConfig,
  domAnimation,
  m,
  useScroll,
  useSpring,
} from "motion/react";
import { AutoHeight, Caret, StreamingWords } from "@/components/StreamingText";
import SheetProgress, { type GenerationStatus } from "@/components/SheetProgress";

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
   * What the live generation has reported so far. When given, the sticky bar
   * shows generation progress while streaming, then settles back to the hint.
   */
  generationStatus?: GenerationStatus;
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

/**
 * Render a line of text with `**bold**` keywords AND a golden highlight wrapped
 * around the source text of the first matching collapsed enhancement. Clicking
 * the highlight re-opens the enhancement inline.
 */
function renderRich(
  text: string,
  baseKey: string,
  onKeywordClick: KeywordClickHandler | undefined,
  collapsed: CollapsedRef[],
  onReopen: ((key: string) => void) | undefined
): React.ReactNode {
  const rawParts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== "");
  const tokens = rawParts.map((part) => {
    const isBold = part.startsWith("**") && part.endsWith("**");
    return { isBold, visible: isBold ? part.slice(2, -2) : part };
  });

  const renderToken = (
    tok: { isBold: boolean; visible: string },
    key: string
  ): React.ReactNode =>
    tok.isBold ? (
      renderBoldKeyword(tok.visible, key as unknown as number, onKeywordClick)
    ) : (
      <span key={key}>{tok.visible}</span>
    );

  // Find the first collapsed source text present in this line.
  let range: { start: number; end: number; key: string } | null = null;
  if (collapsed.length && onReopen) {
    const visible = tokens.map((t) => t.visible).join("");
    const lower = visible.toLowerCase();
    for (const c of collapsed) {
      const m = findNeedleMatch(lower, c.sourceText.toLowerCase());
      if (m) {
        range = { start: m.idx, end: m.idx + m.len, key: c.key };
        break;
      }
    }
  }

  if (!range) {
    return tokens.map((t, i) => renderToken(t, `${baseKey}-${i}`));
  }

  const before: React.ReactNode[] = [];
  const inside: React.ReactNode[] = [];
  const after: React.ReactNode[] = [];
  let offset = 0;
  tokens.forEach((tok, i) => {
    const tStart = offset;
    const tEnd = offset + tok.visible.length;
    offset = tEnd;
    if (tEnd <= range!.start) {
      before.push(renderToken(tok, `${baseKey}-b${i}`));
      return;
    }
    if (tStart >= range!.end) {
      after.push(renderToken(tok, `${baseKey}-a${i}`));
      return;
    }
    if (tok.isBold) {
      // Keep bold tokens atomic — drop them whole inside the highlight.
      inside.push(
        <strong key={`${baseKey}-i${i}`} className="font-semibold text-foreground">
          {tok.visible}
        </strong>
      );
      return;
    }
    const ls = Math.max(0, range!.start - tStart);
    const le = Math.min(tok.visible.length, range!.end - tStart);
    const pre = tok.visible.slice(0, ls);
    const mid = tok.visible.slice(ls, le);
    const post = tok.visible.slice(le);
    if (pre) before.push(<span key={`${baseKey}-bp${i}`}>{pre}</span>);
    if (mid) inside.push(<span key={`${baseKey}-m${i}`}>{mid}</span>);
    if (post) after.push(<span key={`${baseKey}-ap${i}`}>{post}</span>);
  });

  return (
    <>
      {before}
      <mark
        style={ENH_MARK_STYLE}
        className="sb-enh-mark text-foreground"
        role="button"
        tabIndex={0}
        title="Re-open enhancement"
        onClick={(e) => {
          e.stopPropagation();
          onReopen!(range!.key);
        }}
      >
        {inside}
        <sup
          aria-hidden
          style={{ fontSize: "0.6em", color: "rgba(234,179,8,0.95)", marginLeft: "1px" }}
        >
          ✦
        </sup>
      </mark>
      {after}
    </>
  );
}

function renderJsonText(
  text: string,
  anchorPrefix: string,
  onKeywordClick?: KeywordClickHandler,
  renderInline?: (anchor: string) => React.ReactNode,
  collapsedByAnchor?: Record<string, CollapsedRef[]>,
  onReopen?: (key: string) => void
) {
  const lines = text.split("\n");

  return lines.map((line, lineIdx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return <span key={lineIdx} className="block h-2" />;
    }

    const anchor = `${anchorPrefix}:${lineIdx}`;
    const collapsed = collapsedByAnchor?.[anchor] ?? [];
    const labelMatch = trimmed.match(SECTION_LABEL_RE);

    let lineNode: React.ReactNode;
    if (labelMatch) {
      const labelPart = labelMatch[1] + labelMatch[2];
      const rest = trimmed.slice(labelPart.length);

      lineNode = (
        <span
          data-enh-anchor={anchor}
          className={`block text-sm leading-relaxed ${lineIdx === 0 ? "mt-0" : "mt-3"}`}
        >
          <span className="font-semibold text-foreground/90">{labelPart}</span>
          <span className="text-muted-foreground">
            {renderRich(rest, `${anchor}-r`, onKeywordClick, collapsed, onReopen)}
          </span>
        </span>
      );
    } else {
      lineNode = (
        <span
          data-enh-anchor={anchor}
          className="block text-sm text-muted-foreground leading-relaxed"
        >
          {renderRich(trimmed, anchor, onKeywordClick, collapsed, onReopen)}
        </span>
      );
    }

    return (
      <span key={lineIdx} className="block">
        {lineNode}
        {renderInline?.(anchor)}
      </span>
    );
  });
}

// Render an array section (memoryHooks, keyPoints, examTraps)
function renderArraySection(
  items: string[],
  sectionKey?: string,
  renderInline?: (anchor: string) => React.ReactNode,
  collapsedByAnchor?: Record<string, CollapsedRef[]>,
  onReopen?: (key: string) => void
) {
  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <ol className="space-y-2">
      {items.map((item, i) => {
        const anchor = sectionKey ? `${sectionKey}:${i}` : "";
        const collapsed = (sectionKey && collapsedByAnchor?.[anchor]) || [];
        return (
          <li
            key={i}
            data-enh-anchor={sectionKey ? anchor : undefined}
            className="text-sm text-muted-foreground leading-relaxed"
          >
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
                {renderRich(item, `${sectionKey ?? "arr"}-${i}`, undefined, collapsed, onReopen)}
              </span>
            </span>
            {sectionKey && renderInline?.(anchor)}
          </li>
        );
      })}
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

function EvidenceBadge({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="This section is backed by peer-reviewed sources — see below"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: "var(--radius-pill)",
        border: "1px solid var(--border)",
        borderLeft: "2px solid var(--accent)",
        background: "var(--accent-soft)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 500,
        color: "var(--accent)",
        cursor: "pointer",
        marginLeft: 8,
        transition: "background var(--dur-micro) var(--ease-out)",
      }}
    >
      <Zap style={{ width: 10, height: 10 }} />
      Evidence-backed
    </button>
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
    exit={{ opacity: 0, y: 4, scale: 0.97, transition: { duration: 0.12 } }}
    transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
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

const OutputSection = ({
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
  generationStatus,
}: OutputSectionProps) => {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const referenceNoteRef = useRef<HTMLDivElement>(null);

  // How far through the document the reader is, eased so the bar glides.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const readingProgress = useSpring(scrollYProgress, { stiffness: 200, damping: 30, mass: 0.4 });

  // The progress line holds its "ready" state for a moment after the stream
  // ends, so the finish is seen, before the bar settles back to the hint.
  const [statusVisible, setStatusVisible] = useState(isStreaming);
  useEffect(() => {
    if (isStreaming) {
      setStatusVisible(true);
      return;
    }
    const t = window.setTimeout(() => setStatusVisible(false), 2200);
    return () => window.clearTimeout(t);
  }, [isStreaming]);
  const showStatus = !!generationStatus && statusVisible;

  // Sections this mount has seen waiting. One that then lands gets a single
  // glow; a saved sheet, which never waited, opens without any.
  const seenPendingRef = useRef(new Set<string>());
  const [showNudge, setShowNudge] = useState(() => !localStorage.getItem("sb_first_sheet_seen"));

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

  const sheet: GeneratedSheet | null = isJsonSheet(output) ? parseStoredSheet(output) : null;
  if (sheet && sheet.overview === undefined && (sheet as { summary?: string }).summary !== undefined) {
    sheet.overview = (sheet as { summary?: string }).summary as string;
  }
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
  const [selection, setSelection] = useState<{ text: string; anchor: string; top: number; left: number } | null>(null);
  const selectionTooltipRef = useRef<HTMLDivElement>(null);

  const handleSelectionChange = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setSelection(null);
      return;
    }
    const text = sel.toString().trim();
    if (text.split(/\s+/).length < 3) {
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
    setSelection({ text, anchor: anchorFromElement(startEl), ...anchorMenuPos(rect) });
  }, [anchorMenuPos]);

  const fireSelectionEnhance = (kind: EnhanceKind) => {
    if (!selection) return;
    addEnhancement(selection.text, kind, selection.anchor);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
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

  useEffect(() => {
    if (showNudge) localStorage.setItem("sb_first_sheet_seen", "1");
  }, [showNudge]);

  // Tracks the identity of the *core* sheet content (ignoring enhancements) so we
  // only scroll-to-top for a genuinely new sheet — not when an enhancement is
  // saved into the sheet (which also mutates `output`).
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
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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

        {renderNudgeAndDisclaimer(showNudge, setShowNudge, inputText, disclaimerCollapsed, toggleDisclaimer, navigate)}
      </div>
    );
  }

  // ── JSON renderer ────────────────────────────────────────────────────────
  // The sheet's own plan when it has one, the legacy six otherwise. The plan
  // arrives in a __meta frame ahead of the model's first byte, so the shape is
  // settled before any content lands and the skeleton never reflows.
  const sectionOrder = renderOrder(sheet);

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

  // Flashcards arrive in their own frame at the end rather than as a section
  // the parser reports, so progress is counted over everything else.
  const progressSections = sectionOrder.filter((s) => s.key !== "flashcards");
  const readyFraction = progressSections.length
    ? progressSections.filter((s) => isReady(s.key)).length / progressSections.length
    : 0;

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

  const renderInline = (anchor: string): React.ReactNode => {
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

  return (
    <LazyMotion features={domAnimation} strict>
    <MotionConfig reducedMotion="user">
    <div
      ref={ref}
      className="print-document relative space-y-4"
      onMouseUp={handleSelectionChange}
      onTouchEnd={handleSelectionChange}
    >
      {/* Sticky bar below the top nav. While a sheet generates it reports the
          progress; afterwards it carries the highlight-to-enhance hint. Its
          bottom edge is a progress bar either way: sections written, then how
          far the reader has scrolled. */}
      <div
        className="sticky animate-fade-in"
        style={{
          top: "var(--nav-h, 64px)",
          zIndex: 20,
          overflow: "hidden",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          background: "color-mix(in srgb, var(--bg) 90%, transparent)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          padding: "6px 12px",
          marginBottom: 4,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.02em",
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {showStatus ? (
            <m.div
              key="status"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              <SheetProgress
                sections={progressSections}
                readyKeys={streamedKeys ?? []}
                liveKey={liveKey}
                status={generationStatus!}
                done={!isStreaming}
              />
            </m.div>
          ) : (
            <m.div
              key="hint"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <Sparkles style={{ width: 12, height: 12, color: "var(--accent)", flexShrink: 0 }} />
              <span style={{ color: "var(--fg-muted)" }}>
                Highlight any text to expand or get a clinical tie
              </span>
            </m.div>
          )}
        </AnimatePresence>

        {showStatus ? (
          <m.div
            aria-hidden
            initial={false}
            animate={{ scaleX: isStreaming ? readyFraction : 1 }}
            transition={{ type: "spring", stiffness: 120, damping: 24 }}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 2,
              transformOrigin: "0 50%",
              // --sb-accent, not --accent: the landing page's stylesheet
              // redefines --accent as an HSL triplet on :root, which leaves a
              // raw var(--accent) colour invalid once it has loaded.
              background: "hsl(var(--sb-accent))",
            }}
          />
        ) : (
          <m.div
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 2,
              transformOrigin: "0 50%",
              scaleX: readingProgress,
              background: "hsl(var(--sb-accent))",
              opacity: 0.55,
            }}
          />
        )}
      </div>

      {/* Mode header + Save */}
      <div className="animate-fade-in flex items-center justify-between">
        {modeInfo && <ModeInfoBar modeInfo={modeInfo} />}
        <SaveButton
          input={inputText || ""}
          output={output}
          modeInfo={modeInfo}
          disabled={isStreaming}
        />
      </div>

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
            : Array.isArray(body)
            ? body.map((item, i) => `${i + 1}. ${item}`).join("\n")
            : body ?? "";

        return (
          <div
            key={key}
            ref={isReference ? referenceNoteRef : undefined}
            data-section-key={key}
            className={`animate-fade-in scroll-mt-20${landed ? " section-landed" : ""}`}
            style={{
              ...SECTION_CARD_STYLE,
              // A section that hasn't landed keeps a neutral edge, so the
              // accent lighting up is the signal that its content arrived.
              borderLeft: `3px solid ${
                ready || writing ? "var(--accent)" : "var(--border)"
              }`,
              // Mid-stream the cards are already mounted and fill in one by
              // one, so the stagger is real — replaying it would just delay
              // each card into invisibility for its share of the offset.
              animationDelay: isStreaming ? "0ms" : `${idx * 200}ms`,
              animationFillMode: "backwards",
            }}
          >
            <div style={SECTION_HEADER_STYLE}>
              <div className="flex items-center gap-2.5 flex-wrap">
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
              </div>
              <div className="flex items-center gap-1">
                {ready ? (
                  <>
                    <m.span
                      initial={{ scale: 0.3, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{
                        type: "spring",
                        stiffness: 520,
                        damping: 20,
                        delay: landed ? 0 : idx * 0.2 + 0.35,
                      }}
                      style={{ display: "inline-flex" }}
                    >
                      <Check aria-label="Section loaded" className="h-3.5 w-3.5 text-primary/50" />
                    </m.span>
                    <CopyButton text={copyText} />
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
              {!ready && draft !== undefined ? (
                <div aria-busy="true" className="text-sm text-muted-foreground leading-relaxed">
                  {Array.isArray(draft)
                    ? renderDraftList(draft)
                    : spec.kind === "list"
                    ? renderDraftList([draft])
                    : renderDraftProse(draft)}
                </div>
              ) : !ready ? (
                <SectionSkeleton variant="sheet-body" />
              ) : key === "flashcards" ? (
                <FlashcardsSection cards={sheet.flashcards ?? []} />
              ) : key !== "referenceNote" && spec.kind === "prose" ? (
                <div className="text-sm text-muted-foreground leading-relaxed">
                  {renderJsonText(
                    typeof body === "string" ? body : "",
                    key,
                    handleKeywordClick,
                    renderInline,
                    collapsedByAnchor,
                    reopenEnhancement
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
                </>
              ) : (
                renderArraySection(
                  Array.isArray(body) ? body : [],
                  key,
                  renderInline,
                  collapsedByAnchor,
                  reopenEnhancement
                )
              )}
              {ready && renderInline(`${key}:end`)}
            </div>
            </AutoHeight>
          </div>
        );
      })}

      {/* Fallback: selections that couldn't be anchored to a specific line */}
      {enhancementsByAnchor["end"]?.length ? (
        <div className="space-y-1">{renderInline("end")}</div>
      ) : null}

      {/* The nudge says the sheet is ready, so it waits until it actually is. */}
      {renderNudgeAndDisclaimer(
        showNudge && !isStreaming,
        setShowNudge,
        inputText,
        disclaimerCollapsed,
        toggleDisclaimer,
        navigate
      )}

      {/* Anchored action menu — selection (below the highlighted text) */}
      <AnimatePresence>
        {selection && (
          <EnhanceBubble
            key="selection"
            innerRef={selectionTooltipRef}
            top={selection.top}
            left={selection.left}
            onAction={fireSelectionEnhance}
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

// ─── Shared nudge + disclaimer (used by both renderers) ────────────────────

function renderNudgeAndDisclaimer(
  showNudge: boolean,
  setShowNudge: (v: boolean) => void,
  inputText: string | undefined,
  disclaimerCollapsed: boolean,
  toggleDisclaimer: () => void,
  navigate: NavigateFunction
) {
  return (
    <>
      {showNudge && (
        <div className="mt-4 animate-fade-in">
          <div
            style={{
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border)",
              borderLeft: "3px solid var(--accent)",
              background: "var(--bg-elevated)",
              padding: "20px 24px",
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 14,
                fontWeight: 500,
                color: "var(--fg)",
                marginBottom: 6,
              }}
            >
              Your first sheet is ready
            </p>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                color: "var(--fg-muted)",
                lineHeight: 1.55,
                marginBottom: 16,
              }}
            >
              Now lock it in — generate a flashcard deck and start drilling with spaced
              repetition.
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                justifyContent: "center",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  const topic = (inputText || "").trim();
                  if (!topic) return;
                  setShowNudge(false);
                  // The `studybuddy:generate-flashcards` listener lives in
                  // FlashcardsGenerator, which is not mounted on /sheets — the
                  // event went nowhere. Take the user to the page that has it.
                  navigate("/flashcards", { state: { topic } });
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  height: 36,
                  padding: "0 20px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid transparent",
                  background: "var(--fg)",
                  color: "var(--bg)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                <Layers style={{ width: 14, height: 14 }} />
                Generate flashcards
              </button>
              <button
                type="button"
                onClick={() => setShowNudge(false)}
                style={{
                  height: 36,
                  padding: "0 16px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--fg-muted)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}

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
