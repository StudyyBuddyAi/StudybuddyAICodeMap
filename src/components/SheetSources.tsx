import { useState } from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import type { GeneratedSheet, SheetSource } from "@/types/generated-sheet";
import {
  cleanDocumentName,
  cleanExcerpt,
  formatLocation,
  highlightQuery,
  matchStrength,
  MATCH_STRENGTH_LABELS,
  orderSources,
  resolveLocation,
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

const STRENGTH_STYLES: Record<
  ReturnType<typeof matchStrength>,
  { color: string; background: string }
> = {
  strong: { color: "var(--accent)", background: "var(--accent-soft)" },
  good: { color: "var(--fg-muted)", background: "var(--bg-elevated)" },
  related: { color: "var(--fg-muted)", background: "transparent" },
};

interface SourceRowProps {
  source: SheetSource;
  /** The topic the sheet was generated from, used to highlight why this matched. */
  query: string;
}

const SourceRow = ({ source, query }: SourceRowProps) => {
  const [expanded, setExpanded] = useState(false);

  const location = formatLocation(resolveLocation(source));
  const excerpt = cleanExcerpt(source.content);
  const strength = matchStrength(source.similarity);
  const strengthStyle = STRENGTH_STYLES[strength];
  const segments = highlightQuery(excerpt.text, query);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 14px 10px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--fg)",
              lineHeight: 1.4,
            }}
          >
            {cleanDocumentName(source.guidelineName)}
          </div>
          {/* Absent whenever the chunk's heading stack held nothing a reader
              could check. An unlabelled passage is better than a fabricated
              or truncated citation. */}
          {location && (
            <div
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 11.5,
                color: "var(--fg-muted)",
                marginTop: 2,
                lineHeight: 1.4,
              }}
            >
              {location}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span
            title={`Similarity to your topic: ${(source.similarity * 100).toFixed(1)}%`}
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 10.5,
              fontWeight: 600,
              padding: "3px 8px",
              borderRadius: 999,
              border: "1px solid var(--border)",
              whiteSpace: "nowrap",
              ...strengthStyle,
            }}
          >
            {MATCH_STRENGTH_LABELS[strength]}
          </span>
          {source.sourceUrl && (
            <a
              href={source.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the original document"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 26,
                height: 26,
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                color: "var(--fg-muted)",
              }}
            >
              <ExternalLink style={{ width: 12, height: 12 }} />
            </a>
          )}
        </div>
      </div>

      {/* The passage itself, set as a quotation rather than as a data field —
          clamped to three lines so the evidence is visible without a click. */}
      <blockquote
        style={{
          margin: 0,
          padding: "0 14px 12px 14px",
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
            ...(expanded
              ? {}
              : {
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical" as const,
                  overflow: "hidden",
                }),
          }}
        >
          {excerpt.startsMidSentence && "… "}
          {segments.map((segment, i) =>
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

      <div style={{ padding: "0 14px 12px" }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            padding: 0,
            border: "none",
            background: "none",
            color: "var(--accent)",
            fontFamily: "var(--font-sans)",
            fontSize: 11.5,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {expanded ? "Show less" : "Read the full passage"}
        </button>
      </div>
    </div>
  );
};

interface SheetSourcesProps {
  sheet: GeneratedSheet;
  /**
   * What the reader asked for. Used only to highlight the overlapping terms in
   * each excerpt; omit it and the passages render unhighlighted.
   */
  query?: string;
}

/**
 * The passages the retrieval step pulled out of the library before the sheet
 * was written, presented as citations rather than as raw chunks.
 *
 * All of the repair work — heading normalisation, page recovery, watermark and
 * running-head stripping, line unwrapping — lives in src/lib/source-display.ts
 * and is applied at display time. Nothing here rewrites what was retrieved.
 * Only meaningful for grounded sheets; self-hides when `sheet.sources` is empty.
 */
const SheetSources = ({ sheet, query }: SheetSourcesProps) => {
  const sources = orderSources(sheet.sources ?? []);
  if (sources.length === 0) return null;

  const documentCount = new Set(sources.map((s) => s.guidelineName)).size;

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
              {sources.length} {sources.length === 1 ? "passage" : "passages"} from{" "}
              {documentCount} {documentCount === 1 ? "book" : "books"}, retrieved before the
              sheet was written
            </p>
          </div>
        </div>
      </div>
      <div style={{ ...BODY_STYLE, display: "flex", flexDirection: "column", gap: 10 }}>
        {sources.map((source, i) => (
          <SourceRow key={source.id || i} source={source} query={query ?? sheet.topic ?? ""} />
        ))}
      </div>
    </div>
  );
};

export default SheetSources;
