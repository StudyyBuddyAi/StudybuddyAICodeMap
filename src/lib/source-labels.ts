import type { SheetSource } from "@/types/generated-sheet";

/**
 * Validates the book/chapter labels a model proposed for retrieved passages.
 *
 * The labels are a presentation nicety: they turn
 * "OceanofPDF.comNelson_textbook_of_pediatrics_22nd_edition_-_Robert_M_Kliegman"
 * into "Nelson Textbook of Pediatrics, 22nd Edition". But a model asked to
 * tidy a citation will happily invent one, and an invented citation on a
 * medical study sheet is worse than no citation at all — it manufactures
 * provenance a student may act on.
 *
 * So every label is checked back against the chunk it claims to describe, and
 * anything unverifiable is dropped rather than shown. A dropped label costs
 * nothing: src/lib/source-display.ts still renders the mechanically repaired
 * name and heading underneath.
 */

export interface SourceLabel {
  id: string;
  book?: string | null;
  chapter?: string | null;
  section?: string | null;
}

const MAX_BOOK_CHARS = 120;
const MAX_CHAPTER_CHARS = 90;
const MAX_SECTION_CHARS = 80;

/**
 * Fraction of a section label's distinctive words that must occur in the
 * passage. Not 100%: a contents-style entry legitimately adds connective
 * wording ("in", "of", "acute") and may inflect a term the passage uses
 * ("bleeding" / "bleeds"). Two thirds is enough to catch a label that has
 * drifted onto a different topic while allowing normal paraphrase.
 */
const SECTION_OVERLAP_MIN = 2 / 3;

/** Words too generic to prove a proposed title refers to the same document. */
const GENERIC_TOKENS = new Set([
  "pdf", "book", "textbook", "edition", "medical", "medicine", "the", "and",
  "for", "with", "vol", "volume", "part", "com", "www", "org", "net", "full",
  "final", "copy", "scan", "print", "ebook",
]);

/** Lowercased alphanumeric words of 4+ characters, generic ones removed. */
function significantTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t))
  );
}

/**
 * A proposed title must still be recognisably the same document.
 *
 * Requiring one shared distinctive word lets the model expand and recapitalise
 * a mangled filename ("Nelson_textbook_of_pediatrics_22nd_edition" ->
 * "Nelson Textbook of Pediatrics, 22nd Edition") while refusing to let it
 * replace an opaque code with a title it merely inferred from the content
 * ("PsychReproRenalRes" -> "First Aid for the USMLE Step 1"). We genuinely do
 * not know that, so we must not print it.
 */
export function bookNameIsSupported(proposed: string, rawName: string): boolean {
  const rawTokens = significantTokens(rawName);
  if (rawTokens.size === 0) return false;
  for (const token of significantTokens(proposed)) {
    if (rawTokens.has(token)) return true;
  }
  return false;
}

/**
 * Every number in a chapter label must already appear in the heading or the
 * passage. This is the guard that stops "Chapter 415" from becoming a
 * plausible-looking "Chapter 12 — Portal Hypertension".
 */
export function chapterIsSupported(proposed: string, sectionTitle: string, content: string): boolean {
  const haystack = `${sectionTitle} ${content}`;
  const numbers = proposed.match(/\d+/g) ?? [];
  return numbers.every((n) => new RegExp(`\\b${n}\\b`).test(haystack) || haystack.includes(n));
}

/**
 * A section label is the one field that paraphrases rather than quotes, so it
 * is the one that can quietly drift onto a topic the passage never covers —
 * which, on a medical sheet, would mislabel evidence a student then acts on.
 *
 * Requiring most of its distinctive words to come from the passage keeps the
 * label a description of what is actually there. Stemming is deliberately
 * crude (trailing s/es/ing) — this is a drift check, not a linguistics problem.
 */
export function sectionIsSupported(proposed: string, sectionTitle: string, content: string): boolean {
  const haystack = stems(`${sectionTitle} ${content}`);
  if (haystack.size === 0) return false;

  const words = [...stems(proposed)];
  if (words.length === 0) return false;

  const hits = words.filter((w) => haystack.has(w)).length;
  return hits / words.length >= SECTION_OVERLAP_MIN;
}

/** Lowercased 4+ character words, crudely stemmed, generic ones removed. */
function stems(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t))
      .map((t) => t.replace(/(?:ies|es|ing|s)$/, ""))
  );
}

function sanitize(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  // Collapse whitespace and strip characters that would let a label break the
  // single-line citation it renders into.
  const cleaned = value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (cleaned.length === 0 || cleaned.length > maxChars) return null;
  if (/^(null|none|unknown|n\/a)$/i.test(cleaned)) return null;
  return cleaned;
}

/**
 * Merges validated labels into the retrieved sources.
 *
 * Labels for ids that were not retrieved are ignored outright, so a model
 * echoing back an invented passage cannot add a row to the source list. Returns
 * a new array; the input is untouched.
 */
export function applySourceLabels(
  sources: readonly SheetSource[],
  labels: readonly SourceLabel[]
): SheetSource[] {
  if (labels.length === 0) return [...sources];

  const byId = new Map<string, SourceLabel>();
  for (const label of labels) {
    if (label && typeof label.id === "string") byId.set(label.id, label);
  }

  return sources.map((source) => {
    const label = byId.get(source.id);
    if (!label) return source;

    const bookCandidate = sanitize(label.book, MAX_BOOK_CHARS);
    const chapterCandidate = sanitize(label.chapter, MAX_CHAPTER_CHARS);
    const sectionCandidate = sanitize(label.section, MAX_SECTION_CHARS);

    const book =
      bookCandidate && bookNameIsSupported(bookCandidate, source.guidelineName)
        ? bookCandidate
        : undefined;
    const chapter =
      chapterCandidate &&
      chapterIsSupported(chapterCandidate, source.sectionTitle ?? "", source.content)
        ? chapterCandidate
        : undefined;
    const section =
      sectionCandidate &&
      sectionIsSupported(sectionCandidate, source.sectionTitle ?? "", source.content)
        ? sectionCandidate
        : undefined;

    if (!book && !chapter && !section) return source;
    return {
      ...source,
      ...(book ? { book } : {}),
      ...(chapter ? { chapter } : {}),
      ...(section ? { section } : {}),
    };
  });
}
