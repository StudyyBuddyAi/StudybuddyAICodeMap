import { useEffect, useRef, useState, type AnimationEvent } from "react";
import type { MemorialContent } from "@/content/memorial";
import { DeckNav, DeckStatus, MemText, TributeCollage, TributeWords } from "./parts";
import { useDeck } from "./use-deck";

const TURN_MS = 820;

/**
 * The tributes, one sheet each, lying in a pile. Next slides the top sheet
 * out to the side and tucks it under the others; back draws the bottom one
 * out and lays it on top. None is ever put away: every sheet stays in the
 * pile. Each sheet is as long as its own tribute: the top one sets the
 * pile's height and the ones under it match it.
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

  // Turning from the end of a long tribute brings the next one in from its top.
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!deck.turn || !section.current) return;
    const top = section.current.getBoundingClientRect().top;
    if (top < 0) {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: window.scrollY + top - 16, behavior: still ? "auto" : "smooth" });
    }
  }, [deck.turn]);

  return (
    <div className="memorial">
      <h1 className="mem-heading">
        <MemText>{content.heading}</MemText>
      </h1>

      <section ref={section} className="tributes" aria-roledescription="carousel" aria-label="Memorial">
        <DeckStatus tributes={tributes} index={deck.index} />
        <DeckNav index={deck.index} count={n} onPrev={deck.prev} onNext={deck.next} className="tribute-nav" />
        <div className="tribute-pile" data-photos={tributes.some((t) => t.photos.length) || undefined} {...deck.swipe}>
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
                <div className="tribute-sheet" data-photos={t.photos.length ? true : undefined}>
                  <TributeCollage tribute={t} eager={i === 0} />
                  <TributeWords tribute={t} />
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default MemorialDeck;
