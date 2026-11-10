import { useCallback, useEffect, useRef, useState } from "react";
import type { MemorialContent } from "@/content/memorial";
import { DeckNav, DeckStatus, MemText, MemorialPhoto, MemorialWords } from "../parts";
import { useMedia } from "../use-deck";

/** A paper clip, drawn as one wire: the photo is clipped to the card. */
const PaperClip = () => (
  <svg className="ic-clip" viewBox="0 0 16 44" aria-hidden="true" focusable="false">
    <path
      d="M11 14V35a4.5 4.5 0 0 1-9 0V9a6 6 0 0 1 12 0v24a2.5 2.5 0 0 1-5 0V14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * C: the app's own material. Each person is an index card (ruled lines, the
 * red header rule), laid side by side; the neighbours show at the edges, so
 * it is plain there is more to see. Scroll, swipe or use the arrows.
 */
const IndexCardsVersion = ({ content }: { content: MemorialContent }) => {
  const { cards } = content;
  const n = cards.length;
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const still = useMedia("(prefers-reduced-motion: reduce)");

  const scrollToCard = useCallback(
    (i: number) => {
      const t = track.current;
      const el = t?.children[i] as HTMLElement | undefined;
      if (!t || !el) return;
      t.scrollTo({ left: el.offsetLeft - (t.clientWidth - el.clientWidth) / 2, behavior: still ? "auto" : "smooth" });
    },
    [still],
  );
  const next = useCallback(() => scrollToCard((active + 1) % n), [scrollToCard, active, n]);
  const prev = useCallback(() => scrollToCard((active - 1 + n) % n), [scrollToCard, active, n]);

  // The card nearest the middle of the track is the one showing.
  useEffect(() => {
    const t = track.current;
    if (!t) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const mid = t.scrollLeft + t.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      Array.from(t.children).forEach((child, i) => {
        const el = child as HTMLElement;
        const d = Math.abs(el.offsetLeft + el.clientWidth / 2 - mid);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setActive(best);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    t.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      t.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  return (
    <div className="ic">
      <div className="ic-head">
        <h1 className="mem-dedication">
          <MemText>{content.dedication}</MemText>
        </h1>
        <p className="mem-signature">
          <MemText>{content.signature}</MemText>
        </p>
      </div>

      <section aria-roledescription="carousel" aria-label="In memory">
        <DeckStatus cards={cards} index={active} />
        <div ref={track} className="ic-track">
          {cards.map((c, i) => (
            <article
              key={c.id}
              className="ic-card"
              data-active={i === active || undefined}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${n}: ${c.label}`}
              onClick={i === active ? undefined : () => scrollToCard(i)}
            >
              <div className="ic-photo-wrap">
                <PaperClip />
                <MemorialPhoto card={c} className="ic-photo" />
              </div>
              <div className="ic-body">
                <MemorialWords card={c} />
                {/* The card's blue rules carry on to its bottom edge, written on or not. */}
                <div className="ic-fill" aria-hidden="true" />
              </div>
            </article>
          ))}
        </div>
        <DeckNav
          cards={cards}
          index={active}
          onPrev={prev}
          onNext={next}
          onPick={scrollToCard}
          className="ic-nav"
        />
      </section>
    </div>
  );
};

export default IndexCardsVersion;
