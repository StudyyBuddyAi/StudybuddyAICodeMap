/**
 * Ceilings on what a medical-notes request may send into a prompt.
 *
 * The writer's context holds 262k tokens, and before these a single request
 * could fill it: explain mode passed `notes` to the writer whole, and explain,
 * Expand and Clinical had no daily limit either. Branch, section, personalize
 * and deck-source requests carry a sheet and are bounded by their own parsers
 * (SECTION_LIMITS, BRANCH_LIMITS); these are the plain fields every mode reads.
 *
 * Set well above anything the app sends. The longest sheet topic on record is
 * 173 characters and the longest card a student can ask to explain 604
 * (2026-11-08); `notes` takes the topic rule the deck and QBank already apply
 * (validate-topic.ts). Expand and Clinical send whatever the student
 * highlighted, and one item of a saved sheet runs to 4,573 characters, so the
 * highlight gets the same 5,000.
 */
import { TOPIC_MAX_LENGTH } from "./validate-topic.ts";

export const NOTES_FIELD_LIMITS = {
  notes: TOPIC_MAX_LENGTH,
  /** What the student highlighted for Expand or Clinical — up to a whole item. */
  itemText: TOPIC_MAX_LENGTH,
  enhanceTopic: 300,
  sectionKey: 120,
  /** The card a sheet is asked to focus on. */
  focusCard: 1_000,
  examMode: 80,
  difficulty: 80,
} as const;

/** The other items of a section, sent beside an enhanced one (the page keeps 30). */
export const SECTION_ITEMS_LIMIT = { items: 60, chars: 1_000 } as const;

/**
 * Explain, Expand and Clinical answer in a paragraph — measured at 50–240
 * tokens, under prompts that cap them at 180 words. Their budget was the full
 * sheet's 8,192; this keeps five times the longest reply measured.
 */
export const ASSIST_MAX_TOKENS = 1_200;

/** The first field over its ceiling, or null when the request is within all of them. */
export function oversizedNotesField(body: Record<string, unknown>): string | null {
  for (const [field, max] of Object.entries(NOTES_FIELD_LIMITS)) {
    const value = body[field];
    if (typeof value === "string" && value.length > max) return field;
  }
  const items = body.sectionItems;
  if (Array.isArray(items)) {
    if (items.length > SECTION_ITEMS_LIMIT.items) return "sectionItems";
    if (items.some((item) => typeof item === "string" && item.length > SECTION_ITEMS_LIMIT.chars)) return "sectionItems";
  }
  return null;
}
