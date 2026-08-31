/**
 * Categorical colour — hues that encode *identity*, not status.
 *
 * Everything else in the app takes colour from the semantic tokens in
 * index.css (`--success` / `--warning` / `--danger` / `--info`). These two
 * palettes are the deliberate exception: they distinguish one deck or one card
 * tag from another, and collapsing them onto semantic tokens would make every
 * deck avatar identical and destroy the affordance.
 *
 * This file is the single allowlisted home for that exception — the CI colour
 * check exempts it by path, so a raw palette class appearing anywhere else is
 * still a failure.
 *
 * Both palettes carry an explicit dark variant. A `-400` text shade on a 10%
 * alpha fill landed near 2:1 on the light cream ground, so light mode uses a
 * deeper text shade and dark mode a lighter one, over a fill opaque enough to
 * hold either.
 */

/** Deck avatars. Chosen by hashing the topic name, so a deck keeps its colour. */
export const DECK_PALETTE = [
  { bg: "bg-slate-500/20", text: "text-slate-600 dark:text-slate-300" },
  { bg: "bg-violet-500/20", text: "text-violet-600 dark:text-violet-300" },
  { bg: "bg-teal-500/20", text: "text-teal-600 dark:text-teal-300" },
  { bg: "bg-rose-500/20", text: "text-rose-600 dark:text-rose-300" },
  { bg: "bg-amber-500/20", text: "text-amber-600 dark:text-amber-300" },
  { bg: "bg-sky-500/20", text: "text-sky-600 dark:text-sky-300" },
] as const;

/** Stable colour for a topic, so the same deck looks the same across sessions. */
export function deckColor(topic: string): (typeof DECK_PALETTE)[number] {
  let h = 0;
  for (let i = 0; i < topic.length; i++) {
    h = (h * 31 + topic.charCodeAt(i)) >>> 0;
  }
  return DECK_PALETTE[h % DECK_PALETTE.length];
}
