import type { CSSProperties } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { DEFAULT_PHOTO_ASPECT, type MemorialTribute } from "@/content/memorial";

/**
 * Text with any [bracketed] placeholder marked as one, so a draft never
 * passes for the family's own words.
 */
export const MemText = ({ children }: { children: string }) => (
  <>
    {children.split(/(\[[^\]]+\])/).map((part, i) =>
      /^\[[^\]]+\]$/.test(part) ? (
        <span key={i} className="mem-ph">
          {part}
        </span>
      ) : (
        part
      ),
    )}
  </>
);

/** A tribute's photo as a print, in the photo's own shape. Nothing at all until there is one. */
export const TributePrint = ({ tribute, className = "" }: { tribute: MemorialTribute; className?: string }) =>
  tribute.photo ? (
    <div
      className={`mem-print ${className}`}
      style={{ "--ar": String(tribute.photoAspect ?? DEFAULT_PHOTO_ASPECT) } as CSSProperties}
    >
      <img src={tribute.photo} alt={tribute.name} draggable={false} />
    </div>
  ) : null;

/** The name, the years and the words, exactly as written. */
export const TributeWords = ({ tribute }: { tribute: MemorialTribute }) => (
  <div className="tribute-words">
    <h2 className="tribute-name">
      <MemText>{tribute.name}</MemText>
    </h2>
    <p className="tribute-years">
      <MemText>{tribute.years}</MemText>
    </p>
    <div className="tribute-text">
      {tribute.paragraphs.map((p, i) => (
        <p key={i}>
          <MemText>{p}</MemText>
        </p>
      ))}
    </div>
  </div>
);

/**
 * A black mourning ribbon: one band looped over the top, the right-hand band
 * crossing over the left with a gap cut around it so the loop reads at 14px.
 */
export const RibbonMark = ({ size = 16, className = "" }: { size?: number; className?: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true" focusable="false">
    <path
      d="M7.2 21.4 13.4 11.6C15.3 8.6 15 3.2 12 3.2S8.7 8.6 10.6 11.6L16.8 21.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
    />
    <path d="M11.5 13 16.8 21.4" fill="none" stroke="var(--mem-ribbon-gap, var(--bg))" strokeWidth="5.4" />
    <path d="M11.2 12.5 16.8 21.4" fill="none" stroke="currentColor" strokeWidth="3" />
  </svg>
);

/** Previous / next, and which tribute of how many is showing. */
export const DeckNav = ({
  index,
  count,
  onPrev,
  onNext,
  className = "",
}: {
  index: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}) => (
  <div className={`mem-nav ${className}`}>
    <button type="button" className="mem-arrow" onClick={onPrev} aria-label="Previous">
      <ArrowLeft className="h-4 w-4" aria-hidden />
    </button>
    <p className="mem-count">
      {index + 1} of {count}
    </p>
    <button type="button" className="mem-arrow" onClick={onNext} aria-label="Next">
      <ArrowRight className="h-4 w-4" aria-hidden />
    </button>
  </div>
);

/** Says whose tribute is showing, for screen readers, without moving focus. */
export const DeckStatus = ({ tributes, index }: { tributes: MemorialTribute[]; index: number }) => (
  <p className="sr-only" aria-live="polite" aria-atomic="true">
    {`${index + 1} of ${tributes.length}: ${tributes[index].name}`}
  </p>
);
