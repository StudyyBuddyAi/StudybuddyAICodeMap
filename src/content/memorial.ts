/**
 * The memorial at /in-memory: one dedication line and one card per person.
 *
 * Every [bracketed] string is a placeholder for the founder's own words, and
 * the page shows it as one (muted, dotted underline) so nothing reads as
 * finished by mistake. Photos go in public/memorial/ and are referenced by
 * path; until a card has one, the page draws a quiet empty frame.
 */
export type MemorialCardId = "parents" | "brother" | "classmates";

export interface MemorialCard {
  id: MemorialCardId;
  /** How the deck names the card: its tab, its slide label, its photo's alt text. */
  label: string;
  /** The same, short enough for a phone's tab row. */
  short: string;
  /** Set large, beside the photo. */
  names: string;
  /** One short line under the names. */
  line: string;
  /** The words beside the photo, one string per paragraph. */
  text: string[];
  /** Classmates only: the names, listed like a class register. */
  roll?: string[];
  /** A path under public/ (e.g. "/memorial/parents.jpg"), or null for the empty frame. */
  photo: string | null;
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
