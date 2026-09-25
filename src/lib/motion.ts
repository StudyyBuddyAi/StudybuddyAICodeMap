/**
 * Motion tokens for everything Motion animates.
 *
 * They mirror --ease-out and --dur-* in styles/openmed-tokens.css, so a card
 * fading in through a CSS keyframe and a label sliding in through Motion move
 * on the same curve at the same pace — one voice rather than a dozen tunings.
 *
 * Durations are for things that come and go on their own schedule: a view, a
 * panel, a row. Springs are for things that answer the reader or the stream —
 * a check landing, an indicator following the scroll, a bar filling — where a
 * fixed duration reads as mechanical and a retarget mid-flight has to stay
 * smooth.
 */

/** cubic-bezier(0.2, 0.8, 0.2, 1) — the design system's --ease-out. */
export const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;

/** Seconds, matching --dur-micro / --dur-base / --dur-slow. */
export const DURATION = {
  /** Small state changes: a label swapping, a button's content. */
  micro: 0.16,
  /** Things entering or leaving: a view, a panel, a row. */
  base: 0.24,
  /** Larger moves the eye should follow: a reveal, a long travel. */
  slow: 0.42,
} as const;

/** Entering: settle in over the base duration. */
export const ENTER = { duration: DURATION.base, ease: EASE_OUT };

/** Leaving: quicker than entering, so whatever replaces it never waits long. */
export const EXIT = { duration: DURATION.micro, ease: EASE_OUT };

/** A height or size change the eye should follow. */
export const RESIZE = { duration: DURATION.base, ease: EASE_OUT };

/**
 * A whole block opening or closing in the page, moving everything below it.
 * Its content fades on the quick exit while the space closes at the slow pace,
 * so what is below glides into place rather than dropping. For `transition`
 * on an element animating both opacity and height.
 */
export const FOLD = { duration: DURATION.slow, ease: EASE_OUT, opacity: EXIT };

/** Small confirmations that pop in: a check, a chip. */
export const SPRING_POP = { type: "spring", stiffness: 520, damping: 24 } as const;

/** Indicators that travel between positions: the "you are here" bar. */
export const SPRING_GLIDE = { type: "spring", stiffness: 420, damping: 38 } as const;

/** Progress bars, which retarget every time a section lands. */
export const SPRING_BAR = { type: "spring", stiffness: 140, damping: 26 } as const;

/**
 * The one enter/exit for views, panels and rows: rise a few pixels into place,
 * leave by fading with a slight lift. Spread onto an `m` element inside
 * AnimatePresence.
 */
export const RISE = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: ENTER },
  exit: { opacity: 0, y: -4, transition: EXIT },
};

/** A text swap in place — status lines, labels — where travel would distract. */
export const SWAP = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: ENTER },
  exit: { opacity: 0, y: -6, transition: EXIT },
};
