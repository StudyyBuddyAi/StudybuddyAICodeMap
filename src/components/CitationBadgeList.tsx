import { ExternalLink, Lock, BookOpen } from "lucide-react";
import type { CitationResult } from "@/lib/citation";
import { sanitizeUrl } from "@/lib/url";

export interface CitationBadgeListProps {
  state: "loading" | "found" | "locked" | "hidden";
  citations?: CitationResult[];
  onLockedClick?: () => void;
  isLoggedIn?: boolean;
}

function truncate(text: string, max = 60): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

const CitationBadgeList = ({
  state,
  citations,
  onLockedClick,
  isLoggedIn,
}: CitationBadgeListProps) => {
  if (state === "hidden") return null;

  if (state === "loading") {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/50 bg-background/40 animate-pulse">
        <div className="h-3 w-3 rounded-full bg-muted-foreground/30" />
        <div className="h-3 w-32 rounded bg-muted-foreground/20" />
      </div>
    );
  }

  if (state === "locked") {
    return (
      <button
        type="button"
        onClick={onLockedClick}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/50 bg-background/40 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer"
      >
        <Lock className="h-3 w-3" />
        <span>
          {isLoggedIn
            ? "Upgrade to Pro to cite sources"
            : "Sign in to access cited generations"}
        </span>
      </button>
    );
  }

  if (state === "found" && citations && citations.length > 0) {
    const c = citations[0];
    const safeUrl = sanitizeUrl(c.url);

    if (!safeUrl) {
      return (
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/50 bg-background/40 text-xs text-muted-foreground max-w-full">
          <BookOpen className="h-3 w-3 shrink-0" />
          <span className="font-semibold text-foreground/85 shrink-0">
            PubMed
          </span>
          <span className="opacity-50">·</span>
          <span className="truncate">{truncate(c.title)}</span>
        </div>
      );
    }

    return (
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/50 bg-background/40 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors max-w-full"
      >
        <BookOpen className="h-3 w-3 shrink-0" />
        <span className="font-semibold text-foreground/85 shrink-0">
          PubMed
        </span>
        <span className="opacity-50">·</span>
        <span className="truncate">{truncate(c.title)}</span>
        <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
      </a>
    );
  }

  return null;
};

export default CitationBadgeList;
