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
export const MemorialWords = ({ card, as: Heading = "h2" }: { card: MemorialCard; as?: "h2" | "h3" }) => (
  <div className="mem-words">
    <Heading className="mem-names">
      <MemText>{card.names}</MemText>
    </Heading>
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

/** Previous / next, with the cards named between them (a count on a phone). */
export const DeckNav = ({
  cards,
  index,
  onPrev,
  onNext,
  onPick,
  className = "",
}: {
  cards: MemorialCard[];
  index: number;
  onPrev: () => void;
  onNext: () => void;
  onPick?: (i: number) => void;
  className?: string;
}) => (
  <div className={`mem-nav ${className}`}>
    <button type="button" className="mem-arrow" onClick={onPrev} aria-label="Previous card">
      <ArrowLeft className="h-4 w-4" aria-hidden />
    </button>
    {onPick ? (
      <ul className="mem-tabs">
        {cards.map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              className="mem-tab"
              aria-current={i === index ? "true" : undefined}
              onClick={() => onPick(i)}
            >
              <span className="mem-tab-long">{c.label}</span>
              <span className="mem-tab-short">{c.short}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : (
      <p className="mem-count">
        {index + 1} of {cards.length}
      </p>
    )}
    <button type="button" className="mem-arrow" onClick={onNext} aria-label="Next card">
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
