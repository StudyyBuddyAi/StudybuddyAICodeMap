import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { DEFAULT_PHOTO_ASPECT, type MemorialContent } from "@/content/memorial";
import { DeckNav, DeckStatus, MemText, MemorialPhoto, MemorialWords } from "./parts";
import { useDeck } from "./use-deck";

const TUCK_MS = 760;
/** How far the top print has to travel before letting go moves it to the back. */
const DRAG_TO_TUCK = 80;
const REST_TILT = -1.6;
// Out to the left by default, into the margin and away from the words.
const REST = { side: -1 as 1 | -1, from: `rotate(${REST_TILT}deg)` };

const pose = (dx: number) => `translate(${dx}px, ${-Math.abs(dx) * 0.04}px) rotate(${REST_TILT + dx / 28}deg)`;

/**
 * The photographs themselves, in a pile, with the words for the top one
 * beside it. The top print slides out to the side and is tucked under the
 * others; going back draws the bottom one out and lays it on top. Nothing is
 * thrown away: every print stays in the pile. Drag or tap the top print, use
 * the arrows, or the arrow keys.
 */
const MemorialPrints = ({ content }: { content: MemorialContent }) => {
  const { cards } = content;
  const n = cards.length;
  const deck = useDeck(n, { lockMs: TUCK_MS });
  const [dragX, setDragX] = useState<number | null>(null);
  const drag = useRef<{ x: number; id: number } | null>(null);
  // Which side the next tuck leaves from, and the pose it leaves from.
  const [exit, setExit] = useState(REST);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragX(0);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) setDragX(e.clientX - drag.current.x);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    const dx = e.clientX - drag.current.x;
    drag.current = null;
    setDragX(null);
    const tap = Math.abs(dx) < 4;
    if (tap || Math.abs(dx) >= DRAG_TO_TUCK) {
      setExit(tap ? REST : { side: dx < 0 ? -1 : 1, from: pose(dx) });
      deck.next();
    }
  };
  const onCancel = () => {
    drag.current = null;
    setDragX(null);
  };

  const card = cards[deck.index];

  return (
    <div className="prints">
      <div className="prints-head">
        <h1 className="mem-dedication">
          <MemText>{content.dedication}</MemText>
        </h1>
        <p className="mem-signature">
          <MemText>{content.signature}</MemText>
        </p>
      </div>

      <section className="prints-body" aria-roledescription="carousel" aria-label="In memory">
        <DeckStatus cards={cards} index={deck.index} />
        <div className="prints-pile">
          {cards.map((c, i) => {
            const depth = (i - deck.index + n) % n;
            const top = depth === 0;
            const tucking = deck.turn > 0 && deck.dir === 1 && i === deck.from;
            const untucking = deck.turn > 0 && deck.dir === -1 && i === deck.index;
            const style: CSSProperties & Record<string, string> = {
              "--side": String(tucking ? exit.side : -1),
              "--from": tucking ? exit.from : REST.from,
            };
            if (top && dragX !== null) {
              style.transform = pose(dragX);
              style.transition = "none";
            }
            return (
              <div
                key={c.id}
                className={`print${tucking ? " is-tucking" : ""}${untucking ? " is-untucking" : ""}`}
                data-depth={Math.min(depth, 3)}
                style={style}
                aria-hidden={top ? undefined : true}
                onAnimationEnd={tucking ? () => setExit(REST) : undefined}
                {...(top
                  ? { role: "group", "aria-roledescription": "slide", "aria-label": `${deck.index + 1} of ${n}: ${c.label}` }
                  : {})}
              >
                <div
                  className="print-paper"
                  style={{ "--ar": String(c.photoAspect ?? DEFAULT_PHOTO_ASPECT) } as CSSProperties}
                  {...(top
                    ? { onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onCancel }
                    : {})}
                >
                  <MemorialPhoto card={c} className="print-photo" />
                </div>
              </div>
            );
          })}
        </div>

        <div className="prints-side">
          <div key={deck.turn} className="prints-caption">
            <MemorialWords card={card} />
          </div>
          <DeckNav index={deck.index} count={n} onPrev={deck.prev} onNext={deck.next} className="prints-nav" />
          <p className="prints-hint">Drag the photo aside, or tap it, to see the next one.</p>
        </div>
      </section>
    </div>
  );
};

export default MemorialPrints;
