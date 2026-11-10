import { useMemo, useState, type AnimationEvent } from "react";
import type { MemorialCard, MemorialContent } from "@/content/memorial";
import { DeckNav, DeckStatus, MemText, MemorialPhoto, MemorialWords } from "../parts";
import { useDeck, useMedia } from "../use-deck";

const TURN_MS = 900;

/** The left-hand page: the photo held by four album corners, its name under it. */
const PhotoPage = ({ card }: { card: MemorialCard }) => (
  <div className="alb-inner alb-inner--photo">
    <div className="alb-mount">
      <MemorialPhoto card={card} className="alb-photo" />
      <span className="alb-corner alb-corner--tl" aria-hidden="true" />
      <span className="alb-corner alb-corner--tr" aria-hidden="true" />
      <span className="alb-corner alb-corner--bl" aria-hidden="true" />
      <span className="alb-corner alb-corner--br" aria-hidden="true" />
    </div>
    <p className="alb-caption">{card.label}</p>
  </div>
);

/** The right-hand page: the words. */
const WordsPage = ({ card }: { card: MemorialCard }) => (
  <div className="alb-inner alb-inner--words">
    <MemorialWords card={card} />
  </div>
);

/**
 * D: a family album, one spread per person, its pages turned like paper.
 * Like the Books of Remembrance, which turn a page every day so each name is
 * shown in its turn, the album opens on a different spread each day. A phone
 * shows one page at a time.
 */
const AlbumVersion = ({ content }: { content: MemorialContent }) => {
  const { cards } = content;
  const n = cards.length;
  const today = useMemo(() => Math.floor(Date.now() / 86_400_000) % n, [n]);
  const wide = useMedia("(min-width: 768px)");
  const still = useMedia("(prefers-reduced-motion: reduce)");
  const turns = wide && !still;
  const deck = useDeck(n, { initial: today, lockMs: turns ? TURN_MS : 0 });
  // The move whose leaf has landed; a leaf is drawn until its move has.
  const [landed, setLanded] = useState(0);
  const leaf = turns && deck.turn !== landed;

  const from = cards[deck.from];
  const to = cards[deck.index];
  // While a leaf turns, the pages under it already show where it is going.
  const left = leaf && deck.dir === 1 ? from : to;
  const right = leaf && deck.dir === -1 ? from : to;

  const onLanded = (e: AnimationEvent) => {
    if (e.target === e.currentTarget) setLanded(deck.turn);
  };

  return (
    <div className="alb">
      <div className="alb-head">
        <h1 className="mem-dedication">
          <MemText>{content.dedication}</MemText>
        </h1>
        <p className="mem-signature">
          <MemText>{content.signature}</MemText>
        </p>
      </div>

      <section aria-roledescription="carousel" aria-label="In memory">
        <DeckStatus cards={cards} index={deck.index} />
        <div
          className="alb-book"
          data-single={wide ? undefined : true}
          role="group"
          aria-roledescription="slide"
          aria-label={`${deck.index + 1} of ${n}: ${to.label}`}
          {...deck.swipe}
        >
          <div className="alb-page alb-page--left">
            <div key={wide ? left.id : `l${deck.turn}`} className={wide ? "" : "alb-fade"}>
              <PhotoPage card={left} />
            </div>
          </div>
          <div className="alb-page alb-page--right">
            <div key={wide ? right.id : `r${deck.turn}`} className={wide ? "" : "alb-fade"}>
              <WordsPage card={right} />
            </div>
          </div>
          {leaf && (
            <div
              key={deck.turn}
              className={`alb-leaf alb-leaf--${deck.dir === 1 ? "next" : "prev"}`}
              onAnimationEnd={onLanded}
              aria-hidden="true"
            >
              <div className="alb-face alb-face--front">
                {deck.dir === 1 ? <WordsPage card={from} /> : <PhotoPage card={from} />}
              </div>
              <div className="alb-face alb-face--back">
                {deck.dir === 1 ? <PhotoPage card={to} /> : <WordsPage card={to} />}
              </div>
            </div>
          )}
        </div>
        <DeckNav
          cards={cards}
          index={deck.index}
          onPrev={deck.prev}
          onNext={deck.next}
          onPick={deck.pick}
          className="alb-nav"
        />
        <p className="alb-note">The album opens on a different page each day.</p>
      </section>
    </div>
  );
};

export default AlbumVersion;
