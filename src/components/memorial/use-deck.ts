import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

export interface DeckMove {
  index: number;
  /** The card that was showing before this move. */
  from: number;
  /** 1 forward, -1 back. */
  dir: 1 | -1;
  /** Counts moves, so an animation keyed on it replays every time. */
  turn: number;
}

/**
 * A deck that goes round: after the last card comes the first again, so no
 * card is ever the end. Arrow keys anywhere on the page move it (except in a
 * text field), and a sideways swipe on touch does too. `lockMs` holds the
 * deck still while a version's own animation plays out.
 */
export function useDeck(count: number, { initial = 0, lockMs = 0 } = {}) {
  const [move, setMove] = useState<DeckMove>({ index: initial, from: initial, dir: 1, turn: 0 });
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
  const pick = useCallback(
    (i: number) => {
      if (i === (move.index + 1) % count) next();
      else if (i === (move.index - 1 + count) % count) prev();
      else go(i, i > move.index ? 1 : -1);
    },
    [go, next, prev, move.index, count],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  const start = useRef<{ x: number; y: number } | null>(null);
  const swipe = {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType !== "mouse") start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0) next();
        else prev();
      }
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };

  return { ...move, count, next, prev, pick, swipe };
}

/** Matches a media query and follows it as the window changes. */
export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}
