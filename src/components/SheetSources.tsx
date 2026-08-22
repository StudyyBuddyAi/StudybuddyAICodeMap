import { useState } from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import type { GeneratedSheet, SheetSource } from "@/types/generated-sheet";

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

interface SourceRowProps {
  source: SheetSource;
  index: number;
}

const SourceRow = ({ source, index }: SourceRowProps) => {
  const [expanded, setExpanded] = useState(false);

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
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 700,
              color: "var(--accent)",
              background: "var(--accent-soft)",
              padding: "2px 7px",
              borderRadius: 4,
              flexShrink: 0,
            }}
          >
            Source {index + 1}
          </span>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>
            {source.guidelineName}
          </span>
          {source.sectionTitle && (
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 11,
                color: "var(--fg-muted)",
                background: "var(--bg-elevated)",
                padding: "1px 6px",
                borderRadius: 4,
              }}
            >
              {source.sectionTitle}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                fontWeight: 700,
                color: "var(--fg-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Similarity
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>
              {(source.similarity * 100).toFixed(1)}%
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, borderLeft: "1px solid var(--border)", paddingLeft: 10 }}>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: expanded ? "var(--accent-soft)" : "transparent",
                color: expanded ? "var(--accent)" : "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {expanded ? "Hide excerpt" : "View excerpt"}
            </button>
            {source.sourceUrl && (
              <a
                href={source.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open original guideline document"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                  color: "var(--fg-muted)",
                }}
              >
                <ExternalLink style={{ width: 13, height: 13 }} />
              </a>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div
          className="animate-slide-down"
          style={{
            borderTop: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            padding: "14px 16px",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              color: "var(--fg-muted)",
              lineHeight: 1.65,
              margin: 0,
              whiteSpace: "pre-wrap",
            }}
          >
            {source.content}
          </p>
        </div>
      )}
    </div>
  );
};

interface SheetSourcesProps {
  sheet: GeneratedSheet;
}

/**
 * Renders the guideline chunks medical-notes retrieved for this sheet
 * (sorted highest-similarity first). Only meaningful for grounded sheets —
 * callers should skip rendering this when `sheet.sources` is empty.
 */
const SheetSources = ({ sheet }: SheetSourcesProps) => {
  const sources = [...(sheet.sources ?? [])].sort((a, b) => b.similarity - a.similarity);
  if (sources.length === 0) return null;

  return (
    <div data-section-key="sources" className="animate-fade-in scroll-mt-20" style={CARD_STYLE}>
      <div style={HEADER_STYLE}>
        <div className="flex items-center gap-2.5">
          <div style={ICON_STYLE}>
            <BookOpen style={{ width: 14, height: 14, color: "var(--accent)" }} />
          </div>
          <h3 style={TITLE_STYLE}>📚 Guideline Sources</h3>
        </div>
      </div>
      <div style={{ ...BODY_STYLE, display: "flex", flexDirection: "column", gap: 10 }}>
        {sources.map((source, i) => (
          <SourceRow key={source.id || i} source={source} index={i} />
        ))}
      </div>
    </div>
  );
};

export default SheetSources;
