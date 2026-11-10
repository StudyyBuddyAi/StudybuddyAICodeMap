import { useCallback, useEffect, useRef, useState } from "react";

export interface DeckMove {
  index: number;
  /** The card that was showing before this move. */
  from: number;
  /** 1 forward, -1 back. */
  dir: 1 | -1;
  /** Counts moves; 0 until the first one. */
  turn: number;
}

/**
 * A deck that goes round: after the last card comes the first again, so no
 * card is ever the end. Arrow keys anywhere on the page move it (except in a
 * text field). `lockMs` holds the deck still while its animation plays out.
 */
export function useDeck(count: number, { lockMs = 0 } = {}) {
  const [move, setMove] = useState<DeckMove>({ index: 0, from: 0, dir: 1, turn: 0 });
  const lockUntil = useRef(0);

  const go = useCallback(
    (to: number, dir: 1 | -1) => {
      if (to === move.index) return;
      const now = performance.now();
      if (now < lockUntil.current) return;
      lockUntil.current = now + lockMs;
      setMove({ index: to, from: move.index, dir, turn: move.turn + 1 });
    },
    [move, lockMs],
  );

  const next = useCallback(() => go((move.index + 1) % count, 1), [go, move.index, count]);
  const prev = useCallback(() => go((move.index - 1 + count) % count, -1), [go, move.index, count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      // The target is not always an element (a key event sent to the window).
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  return { ...move, count, next, prev };
}
