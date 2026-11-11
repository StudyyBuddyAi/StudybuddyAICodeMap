import { useState, type AnimationEvent } from "react";
import type { MemorialContent } from "@/content/memorial";
import { DeckNav, DeckStatus, MemText, TributePrint, TributeWords } from "./parts";
import { useDeck } from "./use-deck";

const TURN_MS = 820;

/**
 * The tributes, one sheet each, lying in a pile. Next slides the top sheet
 * out to the side and tucks it under the others; back draws the bottom one
 * out and lays it on top. None is ever put away: every sheet stays in the
 * pile. A photo, once there is one, lies on its sheet as a print.
 */
const MemorialDeck = ({ content }: { content: MemorialContent }) => {
  const { tributes } = content;
  const n = tributes.length;
  const deck = useDeck(n, { lockMs: TURN_MS });
  // The move whose sheet has settled; until then the moving sheets keep their words.
  const [landed, setLanded] = useState(0);
  const moving = deck.turn !== landed;
  const onLanded = (e: AnimationEvent) => {
    if (e.target === e.currentTarget) setLanded(deck.turn);
  };

  return (
    <div className="memorial">
      <h1 className="mem-heading">
        <MemText>{content.heading}</MemText>
      </h1>

      <section className="tributes" aria-roledescription="carousel" aria-label="Memorial">
        <DeckStatus tributes={tributes} index={deck.index} />
        <div className="tribute-pile" data-photos={tributes.some((t) => t.photo) || undefined} {...deck.swipe}>
          {tributes.map((t, i) => {
            const depth = (i - deck.index + n) % n;
            const top = depth === 0;
            const tucking = moving && deck.dir === 1 && i === deck.from;
            const untucking = moving && deck.dir === -1 && i === deck.index;
            // Back: the sheet that was on top keeps its words until the one drawn out covers it.
            const yielding = moving && deck.dir === -1 && i === deck.from;
            return (
              <article
                key={t.id}
                className={`tribute${tucking ? " is-tucking" : ""}${untucking ? " is-untucking" : ""}${yielding ? " is-yielding" : ""}`}
                data-depth={Math.min(depth, 3)}
                aria-hidden={top ? undefined : true}
                onAnimationEnd={tucking || untucking ? onLanded : undefined}
                {...(top ? { role: "group", "aria-roledescription": "slide", "aria-label": `${i + 1} of ${n}: ${t.name}` } : {})}
              >
                <div className="tribute-sheet" data-photo={t.photo ? true : undefined}>
                  <TributePrint tribute={t} className="tribute-print" />
                  <TributeWords tribute={t} />
                </div>
              </article>
            );
          })}
        </div>
        <DeckNav index={deck.index} count={n} onPrev={deck.prev} onNext={deck.next} className="tribute-nav" />
      </section>
    </div>
  );
};

export default MemorialDeck;
