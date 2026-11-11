import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

export interface DeckMove {
  index: number;
  /** The one that was showing before this move. */
  from: number;
  /** 1 forward, -1 back. */
  dir: 1 | -1;
  /** Counts moves; 0 until the first one. */
  turn: number;
}

/**
 * A deck that goes round: after the last comes the first again, so none is
 * ever the end. Arrow keys anywhere on the page move it (except in a text
 * field), and so does a sideways swipe on a touch screen. `lockMs` holds the
 * deck still while its animation plays out.
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

  // Touch only: with a mouse, dragging is how you select the words.
  const start = useRef<{ x: number; y: number } | null>(null);
  const swipe = {
    onPointerDown: (e: PointerEvent) => {
      start.current = e.pointerType === "touch" ? { x: e.clientX, y: e.clientY } : null;
    },
    onPointerUp: (e: PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) next();
        else prev();
      }
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };

  return { ...move, count, next, prev, swipe };
}
