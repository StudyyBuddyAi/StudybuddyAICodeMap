import { ArrowLeft, ArrowRight, ImageIcon } from "lucide-react";
import type { MemorialCard } from "@/content/memorial";

/**
 * Text with its [bracketed] placeholders marked as placeholders, so a draft
 * never passes for the founder's own words.
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

/** A card's photo, or the quiet empty frame that holds its place. */
export const MemorialPhoto = ({ card, className = "" }: { card: MemorialCard; className?: string }) =>
  card.photo ? (
    <div className={`mem-photo ${className}`}>
      <img src={card.photo} alt={card.label} draggable={false} />
    </div>
  ) : (
    <div className={`mem-photo mem-photo--empty ${className}`} role="img" aria-label={`${card.label}: photo to come`}>
      <span className="mem-photo-hint" aria-hidden="true">
        <ImageIcon className="h-5 w-5" strokeWidth={1.5} />
        <span>Photo · {card.short}</span>
      </span>
    </div>
  );

/** The names, the line under them, the words and, for the classmates, their register. */
export const MemorialWords = ({ card }: { card: MemorialCard }) => (
  <div className="mem-words">
    <h2 className="mem-names">
      <MemText>{card.names}</MemText>
    </h2>
    <p className="mem-line">
      <MemText>{card.line}</MemText>
    </p>
    <div className="mem-text">
      {card.text.map((p, i) => (
        <p key={i}>
          <MemText>{p}</MemText>
        </p>
      ))}
    </div>
    {card.roll && (
      <ul className="mem-roll" aria-label="Their names">
        {card.roll.map((name, i) => (
          <li key={i}>
            <MemText>{name}</MemText>
          </li>
        ))}
      </ul>
    )}
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

/** Previous / next, and which card of how many is showing. */
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
    <button type="button" className="mem-arrow" onClick={onPrev} aria-label="Previous photo">
      <ArrowLeft className="h-4 w-4" aria-hidden />
    </button>
    <p className="mem-count">
      {index + 1} of {count}
    </p>
    <button type="button" className="mem-arrow" onClick={onNext} aria-label="Next photo">
      <ArrowRight className="h-4 w-4" aria-hidden />
    </button>
  </div>
);

/** Says which card is showing, for screen readers, without moving focus. */
export const DeckStatus = ({ cards, index }: { cards: MemorialCard[]; index: number }) => (
  <p className="sr-only" aria-live="polite" aria-atomic="true">
    {`${index + 1} of ${cards.length}: ${cards[index].label}`}
  </p>
);
