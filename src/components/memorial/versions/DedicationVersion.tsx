import type { MemorialContent } from "@/content/memorial";
import { DeckNav, DeckStatus, MemText, MemorialPhoto, MemorialWords } from "../parts";
import { useDeck } from "../use-deck";

/**
 * A: the page a textbook opens with. One line of dedication, centred, then
 * the cards as a small stack of sheets: the top sheet stays where it is and
 * its words and photo turn over in place, so nothing is ever pushed away.
 */
const DedicationVersion = ({ content }: { content: MemorialContent }) => {
  const { cards } = content;
  const deck = useDeck(cards.length);
  const card = cards[deck.index];

  return (
    <div className="ded">
      <h1 className="mem-dedication ded-title">
        <MemText>{content.dedication}</MemText>
      </h1>
      <p className="mem-signature">
        <MemText>{content.signature}</MemText>
      </p>

      <section className="ded-deck" aria-roledescription="carousel" aria-label="In memory">
        <DeckStatus cards={cards} index={deck.index} />
        <div className="ded-stack" {...deck.swipe}>
          <div
            className="ded-sheet"
            role="group"
            aria-roledescription="slide"
            aria-label={`${deck.index + 1} of ${cards.length}: ${card.label}`}
          >
            <div key={deck.turn} className="ded-slide" data-dir={deck.dir} data-first={deck.turn === 0 || undefined}>
              <MemorialPhoto card={card} className="ded-photo" />
              <MemorialWords card={card} />
            </div>
          </div>
        </div>
        <DeckNav
          cards={cards}
          index={deck.index}
          onPrev={deck.prev}
          onNext={deck.next}
          onPick={deck.pick}
          className="ded-nav"
        />
      </section>
    </div>
  );
};

export default DedicationVersion;
