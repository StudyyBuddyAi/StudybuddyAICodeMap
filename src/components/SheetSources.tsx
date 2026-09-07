import { useState } from "react";
import { BookOpen, ChevronRight, ExternalLink } from "lucide-react";
import type { SheetSource } from "@/types/generated-sheet";
import {
  cleanExcerpt,
  groupSources,
  highlightQuery,
  matchStrength,
  MATCH_STRENGTH_LABELS,
  passageLead,
  resolveLocation,
  type SourceBook,
  type SourceChapter,
} from "@/lib/source-display";

const CARD_STYLE: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderLeft: "3px solid var(--accent)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-elevated)",
  overflow: "hidden",
};

const HEADER_STYLE: React.CSSProperties = {
  padding: "20px 24px 8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const BODY_STYLE: React.CSSProperties = { padding: "4px 24px 20px" };

const ICON_STYLE: React.CSSProperties = {
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

const TITLE_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: "-0.004em",
  color: "var(--fg)",
  margin: 0,
};

const STRENGTH_COLORS: Record<ReturnType<typeof matchStrength>, string> = {
  strong: "var(--accent)",
  good: "var(--fg-muted)",
  related: "var(--fg-muted)",
};

// ── One passage: a contents row that opens to reveal the text ────────────────

interface PassageRowProps {
  source: SheetSource;
  query: string;
  /** Last row in its chapter — drops the divider so the group closes cleanly. */
  isLast: boolean;
}

const PassageRow = ({ source, query, isLast }: PassageRowProps) => {
  const [open, setOpen] = useState(false);

  const excerpt = cleanExcerpt(source.content);
  const page = resolveLocation(source).page;
  const strength = matchStrength(source.similarity);

  // What the row is called before it is opened. The validated model label is a
  // proper contents entry; without one we fall back to the passage's own
  // opening words, which is blunter but never says anything the text doesn't.
  const label = source.section ?? passageLead(excerpt.text);

  return (
    <div style={{ borderBottom: isLast && !open ? "none" : "1px solid var(--border)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 12px",
          border: "none",
          background: open ? "var(--bg-elevated)" : "transparent",
          textAlign: "left",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        <ChevronRight
          style={{
            width: 13,
            height: 13,
            flexShrink: 0,
            color: "var(--fg-muted)",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 150ms ease",
          }}
        />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: "var(--font-sans)",
            fontSize: 12.5,
            color: open ? "var(--fg)" : "var(--fg-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {page && (
          <span
            style={{
              flexShrink: 0,
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--fg-muted)",
            }}
          >
            p.&nbsp;{page}
          </span>
        )}
        <span
          title={`Similarity to your topic: ${(source.similarity * 100).toFixed(1)}%`}
          style={{
            flexShrink: 0,
            fontFamily: "var(--font-sans)",
            fontSize: 10,
            fontWeight: 600,
            color: STRENGTH_COLORS[strength],
            width: 78,
            textAlign: "right",
          }}
        >
          {MATCH_STRENGTH_LABELS[strength]}
        </span>
      </button>

      {open && (
        <blockquote
          className="animate-slide-down"
          style={{
            margin: 0,
            padding: "2px 14px 14px 35px",
            background: "var(--bg-elevated)",
          }}
        >
          <p
            style={{
              margin: 0,
              paddingLeft: 12,
              borderLeft: "2px solid var(--border)",
              fontFamily: "var(--font-serif, var(--font-sans))",
              fontSize: 13,
              color: "var(--fg-muted)",
              lineHeight: 1.7,
              whiteSpace: "pre-line",
            }}
          >
            {excerpt.startsMidSentence && "… "}
            {highlightQuery(excerpt.text, query).map((segment, i) =>
              segment.hit ? (
                <mark
                  key={i}
                  style={{
                    background: "var(--accent-soft)",
                    color: "var(--fg)",
                    padding: "0 2px",
                    borderRadius: 2,
                  }}
                >
                  {segment.text}
                </mark>
              ) : (
                <span key={i}>{segment.text}</span>
              )
            )}
            {excerpt.endsMidSentence && " …"}
          </p>
        </blockquote>
      )}
    </div>
  );
};

// ── One chapter within a book ───────────────────────────────────────────────

const ChapterGroup = ({ chapter, query }: { chapter: SourceChapter; query: string }) => (
  <div style={{ marginTop: 10 }}>
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 10,
        padding: "0 2px 5px",
      }}
    >
      {/* No heading is a real outcome, not a gap: it means nothing in the
          chunk's own metadata could place it, and inventing one would be
          worse than leaving the passages listed under the book alone. */}
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          fontWeight: 600,
          color: chapter.heading ? "var(--fg)" : "var(--fg-muted)",
          fontStyle: chapter.heading ? "normal" : "italic",
        }}
      >
        {chapter.heading ?? "Location not recorded"}
      </span>
      <span
        style={{
          flexShrink: 0,
          fontFamily: "var(--font-sans)",
          fontSize: 10.5,
          color: "var(--fg-muted)",
        }}
      >
        {chapter.passages.length}{" "}
        {chapter.passages.length === 1 ? "passage" : "passages"}
      </span>
    </div>

    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      {chapter.passages.map((source, i) => (
        <PassageRow
          key={source.id || i}
          source={source}
          query={query}
          isLast={i === chapter.passages.length - 1}
        />
      ))}
    </div>
  </div>
);

// ── One book ────────────────────────────────────────────────────────────────

const BookGroup = ({ book, query }: { book: SourceBook; query: string }) => {
  const sourceUrl = book.chapters.flatMap((c) => c.passages).find((p) => p.sourceUrl)?.sourceUrl;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h4
          style={{
            margin: 0,
            fontFamily: "var(--font-serif, var(--font-sans))",
            fontSize: 13.5,
            fontWeight: 600,
            color: "var(--fg)",
            letterSpacing: "-0.004em",
          }}
        >
          {book.title}
        </h4>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the original document"
            style={{ display: "inline-flex", color: "var(--fg-muted)" }}
          >
            <ExternalLink style={{ width: 12, height: 12 }} />
          </a>
        )}
      </div>
      {book.chapters.map((chapter, i) => (
        <ChapterGroup key={chapter.heading ?? `unplaced-${i}`} chapter={chapter} query={query} />
      ))}
    </div>
  );
};

interface SheetSourcesProps {
  /**
   * The retrieved passages. A sheet reads these off its own `sources`; a deck
   * reads them off the `grounding_metadata` written when it was generated. The
   * payload is identical either way — one retrieval, one shape — so both
   * render through this one component.
   */
  sources: readonly SheetSource[];
  /**
   * What the reader asked for: the sheet's notes, or the deck's topic. Used
   * only to highlight the overlapping terms in an opened excerpt; omit it and
   * passages render unhighlighted.
   */
  query?: string;
}

/**
 * The library passages a sheet or a flashcard deck was built on, presented as a
 * contents page: book, then chapter, then one line per passage, with the
 * retrieved text folded away until the reader asks for it.
 *
 * Retrieval routinely returns eight passages from a single chapter of a single
 * book. Listed flat with their text showing, that reads as eight walls of
 * duplicated prose; listed as an index, it reads as one citation with eight
 * references under it — which is what it actually is.
 *
 * All repair of the underlying chunks happens in src/lib/source-display.ts, and
 * the model-proposed book/chapter/section labels are validated in
 * src/lib/source-labels.ts before they ever reach this component. Self-hides
 * when there is nothing to show.
 */
const SheetSources = ({ sources, query }: SheetSourcesProps) => {
  const books = groupSources(sources);
  if (books.length === 0) return null;

  const passageCount = books.reduce((n, b) => n + b.passageCount, 0);

  return (
    <div data-section-key="sources" className="animate-fade-in scroll-mt-20" style={CARD_STYLE}>
      <div style={HEADER_STYLE}>
        <div className="flex items-center gap-2.5">
          <div style={ICON_STYLE}>
            <BookOpen style={{ width: 14, height: 14, color: "var(--accent)" }} />
          </div>
          <div>
            <h3 style={TITLE_STYLE}>Where this came from</h3>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 11.5,
                color: "var(--fg-muted)",
                margin: "2px 0 0",
              }}
            >
              {passageCount} {passageCount === 1 ? "passage" : "passages"} from {books.length}{" "}
              {books.length === 1 ? "book" : "books"} · open any line to read it
            </p>
          </div>
        </div>
      </div>
      <div style={{ ...BODY_STYLE, display: "flex", flexDirection: "column", gap: 18 }}>
        {books.map((book) => (
          <BookGroup key={book.rawName} book={book} query={query ?? ""} />
        ))}
      </div>
    </div>
  );
};

export default SheetSources;
