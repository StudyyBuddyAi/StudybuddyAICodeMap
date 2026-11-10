/**
 * The memorial at /in-memory: one dedication line and one card per person.
 *
 * Every [bracketed] string is a placeholder for the founder's own words, and
 * the page shows it as one (muted, dotted underline) so nothing reads as
 * finished by mistake. Photos go in public/memorial/ and are referenced by
 * path; until a card has one, the page draws a quiet empty frame.
 *
 * The memorial goes live (route and entry points, in production) only once
 * this file is complete: no placeholder left and a photo on every card. See
 * `memorialComplete` below and src/components/memorial/memorial-live.ts.
 */
export type MemorialCardId = "parents" | "brother" | "classmates";

export interface MemorialCard {
  id: MemorialCardId;
  /** How the deck names the card: its slide label and its photo's alt text. */
  label: string;
  /** The same, short, for the empty photo frame. */
  short: string;
  /** Set large, beside the photo. */
  names: string;
  /** One short line under the names. */
  line: string;
  /** The words beside the photo, one string per paragraph. */
  text: string[];
  /** Classmates only: their names, listed like a class register. */
  roll?: string[];
  /** A path under public/ (e.g. "/memorial/parents.jpg"), or null for the empty frame. */
  photo: string | null;
  /**
   * The photo's width ÷ height, so its print keeps the photo's own shape: a
   * landscape class photo lies as a landscape print, never cropped to fit.
   * Leave it out for the portrait default, 4:5.
   */
  photoAspect?: number;
}

export interface MemorialContent {
  dedication: string;
  signature: string;
  cards: MemorialCard[];
}

export const MEMORIAL: MemorialContent = {
  dedication: "In memory of my family and the classmates I lost in the war.",
  signature: "[Your name]",
  cards: [
    {
      id: "parents",
      label: "My mother and father",
      short: "Mother and father",
      names: "[Mother’s name] and [Father’s name]",
      line: "[A short line under their names]",
      text: ["[Your words about your mother and father. A few sentences or a few paragraphs.]"],
      photo: null,
    },
    {
      id: "brother",
      label: "My brother",
      short: "Brother",
      names: "[Brother’s name]",
      line: "[A short line under his name]",
      text: ["[Your words about your brother.]"],
      photo: null,
    },
    {
      id: "classmates",
      label: "My classmates",
      short: "Classmates",
      names: "[Your class or year]",
      line: "[A short line about them]",
      text: ["[Your words about your classmates.]"],
      roll: ["[Name]", "[Name]", "[Name]", "[Name]"],
      photo: null,
    },
  ],
};

/** The portrait shape a print takes when its card gives none. */
export const DEFAULT_PHOTO_ASPECT = 4 / 5;

export const hasPlaceholder = (s: string) => /\[[^\]]+\]/.test(s);

/** True once every word is the founder's own and every card has its photo. */
export function memorialComplete(content: MemorialContent): boolean {
  const words = [
    content.dedication,
    content.signature,
    ...content.cards.flatMap((c) => [c.names, c.line, ...c.text, ...(c.roll ?? [])]),
  ];
  return !words.some(hasPlaceholder) && content.cards.every((c) => !!c.photo);
}
