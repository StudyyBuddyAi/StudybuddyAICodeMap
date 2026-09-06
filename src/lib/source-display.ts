import type { SheetSource } from "@/types/generated-sheet";

/**
 * Turns a raw retrieved chunk into something a student can read as a citation.
 *
 * Everything here is display-time repair of ingestion artefacts. The chunks in
 * `guideline_chunks` were produced by a pipeline that lives outside this repo,
 * and three of its habits leak straight into the UI if left alone:
 *
 *  1. `section_title` is a heading *stack* joined on "›" that mixes real
 *     headings with running heads, printed page numbers, figure captions,
 *     author bylines and truncated sentence fragments.
 *  2. `content` keeps the PDF's hard line wraps, its running headers, and (for
 *     the Nelson volume) a per-download ClinicalKey watermark carrying a real
 *     person's name and email address.
 *  3. `metadata.page_start` is a PDF page index, never the page number printed
 *     on the page. The offset differs per document — for the Nelson volume it
 *     is ~2217, for Harrison's the range runs past 9500 for a book that prints
 *     to ~4000. It is therefore NEVER rendered; the printed page is parsed out
 *     of the document's own running header instead, and when no header carries
 *     one, no page is shown at all.
 *
 * Every function here is pure and total: given garbage it returns null rather
 * than a guess. A source row with no heading and no page is a correct outcome,
 * not a bug — silence beats a fragment.
 */

// ── Document names ───────────────────────────────────────────────────────────

/**
 * Repairs a document name built out of the original PDF's filename.
 *
 * The ingestion pipeline writes `guideline_name` straight from the file it
 * read, so the raw values carry underscores, a trailing "PDF", and — for two
 * of the books — the name of the site the PDF was downloaded from. Rendering
 * those verbatim is a large part of why a real textbook reads as a scraped
 * blob.
 *
 * Purely mechanical: no per-document knowledge, and a name it cannot improve
 * comes back untouched.
 */
export function cleanDocumentName(raw: string): string {
  const cleaned = raw
    // Leading bracketed source tag: "[Medicalstudyzone.com] Pathoma 2023 PDF".
    .replace(/^\s*\[[^\]]*\]\s*/, "")
    // Leading host name, with or without a separating space:
    // "OceanofPDF.comNelson_textbook_of_pediatrics…".
    .replace(/^\s*(?:www\.)?[A-Za-z0-9-]+\.(?:com|org|net)\s*/i, "")
    .replace(/_+/g, " ")
    .replace(/\s*\bPDF\b\s*$/i, "")
    .replace(/\s+-\s+/g, " — ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : raw;
}

// ── Heading detection ────────────────────────────────────────────────────────

/** Short function words that may appear lowercase inside a real title. */
const TITLE_STOPWORDS = new Set([
  "and", "the", "of", "in", "for", "with", "to", "a", "an", "on", "by",
  "from", "or", "at", "as", "its", "into", "over", "under", "via",
]);

/**
 * "Chris A. Liacouras" — a contributor byline, not a section heading.
 *
 * The middle initial is required. Without it this also matches any two-word
 * title ("Gastrointestinal Bleeding", "Acute Pancreatitis"), and rejecting
 * real chapter headings to catch the occasional byline is much the worse
 * trade: a byline slipping through is cosmetic, a missing chapter is not.
 */
const BYLINE_RE = /^[A-Z][a-z]+\s+[A-Z]\.\s+[A-Z][a-z']+$/;

/** Ingestion noise that disqualifies a segment outright. */
const NOISE_RE = /\bwww\.|\.com\b|\.org\b|Downloaded for /i;

/**
 * True when a "›" segment reads as a heading rather than as a sentence
 * fragment sliced out of the running text.
 *
 * The discriminating signal is lowercase content words: a title may contain
 * lowercase function words ("Hypoxia and Cyanosis", "Decision-Making in
 * Clinical Medicine") but never a lowercase content word, whereas a fragment
 * is almost entirely lowercase content words ("development process and safety
 * monitoring systems if they are to").
 */
export function looksLikeHeading(segment: string): boolean {
  const s = segment.trim();
  if (s.length < 2 || s.length > 80) return false;
  if (NOISE_RE.test(s)) return false;
  if (BYLINE_RE.test(s)) return false;
  // A heading never starts mid-sentence.
  if (/^[a-z]/.test(s)) return false;

  const words = s.split(/\s+/);
  if (words.length > 12) return false;

  // Small-caps running heads ("CYANOSIS", "IV. BENIGN AND MALIGNANT HTN").
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) return true;

  return !words.some((w) => {
    const bare = w.replace(/[^A-Za-z-]/g, "");
    return (
      bare.length >= 4 &&
      /^[a-z]/.test(bare) &&
      !TITLE_STOPWORDS.has(bare.toLowerCase())
    );
  });
}

// ── Locator parsing ──────────────────────────────────────────────────────────

export interface SourceLocation {
  /** Reader-facing heading, e.g. "Chapter 428 — The Common Cold". */
  heading: string | null;
  /** Page number as printed in the book, or null when none could be verified. */
  page: number | null;
  /** Sub-section number when the stack carried one, e.g. "559.6". */
  section: string | null;
}

const EMPTY_LOCATION: SourceLocation = { heading: null, page: null, section: null };

/** Rejects page numbers outside any plausible printed range. */
function plausiblePage(n: number): number | null {
  return Number.isInteger(n) && n >= 1 && n <= 9999 ? n : null;
}

/**
 * The ingestion pipeline mangles the "▶" glyph used as a separator in several
 * of these books' running heads into a bare "u". Both spellings appear.
 */
const SEP = "[u▶»›]";

/** `Chapter 428 u The Common Cold 2551` — chapter head with printed page. */
const NELSON_CHAPTER_RE = new RegExp(
  `^Chapter\\s+(\\d+(?:\\.\\d+)?)\\s+${SEP}\\s+(.+?)(?:\\s+(\\d{2,4}))?$`
);

/** `2552 Part XVII u The Respiratory System` — verso running head. */
const NELSON_PART_RE = new RegExp(
  `^(\\d{2,4})\\s+Part\\s+([IVXL]+)\\s+${SEP}\\s+(.+)$`
);

/** `40 Hypoxia and Cyanosis` — Harrison's chapter head, no page. */
const HARRISON_CHAPTER_RE = /^(\d{1,3})\s+([A-Z].*)$/;

/** `220 FUNDAMENTALS OF PATHOLOGY` — page number then an all-caps running head. */
const PAGE_THEN_CAPS_RE = /^(\d{2,4})\s+([A-Z][A-Z\s&,'-]{4,})$/;

/** `559.6 Membranoproliferative` — a sub-section number, usually truncated. */
const SUBSECTION_RE = /^(\d{1,4}\.\d+)\s+/;

/** First Aid prints `SECTION III 547` in its running head, sometimes as `SEC TION`. */
const FIRST_AID_PAGE_RE = /SEC\s?TION\s+[IVXL]+\s+(\d{2,4})/;

/**
 * Parses one "›" segment. Returns partial information — the caller merges the
 * best result across every segment of the stack.
 */
function parseSegment(segment: string): SourceLocation {
  const s = segment.trim();
  if (!s || NOISE_RE.test(s)) return EMPTY_LOCATION;

  const nelsonChapter = NELSON_CHAPTER_RE.exec(s);
  if (nelsonChapter) {
    const [, num, rawTitle, rawPage] = nelsonChapter;
    const title = rawTitle.trim();
    return {
      heading: looksLikeHeading(title) ? `Chapter ${num} — ${title}` : `Chapter ${num}`,
      page: rawPage ? plausiblePage(Number(rawPage)) : null,
      section: null,
    };
  }

  const nelsonPart = NELSON_PART_RE.exec(s);
  if (nelsonPart) {
    const [, rawPage, roman, rawTitle] = nelsonPart;
    const title = rawTitle.trim();
    return {
      heading: looksLikeHeading(title) ? `Part ${roman} — ${title}` : `Part ${roman}`,
      page: plausiblePage(Number(rawPage)),
      section: null,
    };
  }

  const pageThenCaps = PAGE_THEN_CAPS_RE.exec(s);
  if (pageThenCaps) {
    return {
      heading: toTitleCase(pageThenCaps[2].trim()),
      page: plausiblePage(Number(pageThenCaps[1])),
      section: null,
    };
  }

  const harrison = HARRISON_CHAPTER_RE.exec(s);
  if (harrison && looksLikeHeading(harrison[2])) {
    return { heading: `Chapter ${harrison[1]} — ${harrison[2].trim()}`, page: null, section: null };
  }

  // A sub-section number is worth keeping even though the title beside it is
  // usually sliced mid-word ("559.6 Membranoproliferative"): the number alone
  // is an exact, checkable locator, the truncated title is not.
  const subsection = SUBSECTION_RE.exec(s);
  if (subsection) {
    return { heading: null, page: null, section: subsection[1] };
  }

  if (looksLikeHeading(s)) {
    return { heading: s, page: null, section: null };
  }

  return EMPTY_LOCATION;
}

/** `FUNDAMENTALS OF PATHOLOGY` reads better as `Fundamentals of Pathology`. */
function toTitleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) =>
      i > 0 && TITLE_STOPWORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(" ");
}

/** Trailing words that prove a line is running text, not a heading. */
const TRAILING_CONNECTIVE_RE = /(?:,|\b(?:and|or|but|with|the|of|in|to|a|an|for|by)\.?)$/i;

/**
 * Some books (Pathoma especially) carry no usable heading in `section_title`
 * but open the chunk with the printed heading itself — "IV. BENIGN AND
 * MALIGNANT HTN", "D. Pathogenesis". Used only as a last resort, and guarded
 * hard: a mid-sentence first line such as "98-2), and" or "103). In persons
 * with chronic hypoxemia secondary to" must never be mistaken for a heading.
 */
function headingFromContent(content: string): string | null {
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine.length < 3 || firstLine.length > 60) return null;
  // Must open with a letter, optionally behind a list enumerator.
  if (!/^(?:[IVXL]{1,5}\.|[A-Z]\.|\d{1,2}\.)?\s*[A-Za-z]/.test(firstLine)) return null;
  if (TRAILING_CONNECTIVE_RE.test(firstLine)) return null;
  return looksLikeHeading(firstLine) ? firstLine : null;
}

/**
 * Resolves where in its book a retrieved passage sits.
 *
 * `pageStart`/`pageEnd` from the ingestion metadata are deliberately ignored
 * for display — see the note at the top of this file. The page returned here
 * is always one the book itself printed, parsed from a running header.
 */
export function resolveLocation(source: SheetSource): SourceLocation {
  const segments = (source.sectionTitle ?? "").split("›");

  let heading: string | null = null;
  let page: number | null = null;
  let section: string | null = null;

  for (const segment of segments) {
    const parsed = parseSegment(segment);
    // The stack runs outermost-first, so the first real heading is the most
    // specific reliable one; later segments are progressively more truncated.
    if (parsed.heading && !heading) heading = parsed.heading;
    if (parsed.page && !page) page = parsed.page;
    if (parsed.section && !section) section = parsed.section;
  }

  // First Aid ships no section titles at all — its running head is inline in
  // the chunk text instead.
  if (!page) {
    const inline = FIRST_AID_PAGE_RE.exec(source.content);
    if (inline) page = plausiblePage(Number(inline[1]));
  }

  if (!heading) heading = headingFromContent(source.content);

  return { heading, page, section };
}

/** Renders a location as a single citation line, or null when nothing is known. */
export function formatLocation(location: SourceLocation): string | null {
  const parts: string[] = [];
  if (location.heading) parts.push(location.heading);
  if (location.section) parts.push(`§${location.section}`);
  // Non-breaking space: "p." must never wrap away from its page number.
  if (location.page) parts.push(`p.\u00a0${location.page}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ── Excerpt cleaning ─────────────────────────────────────────────────────────

/**
 * The Nelson volume was downloaded through ClinicalKey, which stamps every
 * page with the downloading account's name and email. Those lines are sitting
 * in the chunk text and would otherwise be rendered to our users verbatim.
 */
const WATERMARK_RES: readonly RegExp[] = [
  /Downloaded for [\s\S]*?All rights reserved\./gi,
  /Downloaded for [\s\S]*?without permission\./gi,
  /Downloaded for [\s\S]*?personal use only\./gi,
  /Downloaded for [^\n]*/gi,
];

/** Running heads and imprint footers that survived ingestion. */
const RUNNING_HEAD_RES: readonly RegExp[] = [
  // First Aid: "NEUROLOGY AND SPECIAL SENSES ▶ NEUROLOGY—OTOLOGY SEC TION III 547"
  /[A-Z][A-Z—–\s,'-]{4,}▶[A-Z—–\s,'-]{4,}SEC\s?TION\s+[IVXL]+\s+\d{2,4}/g,
  /SEC\s?TION\s+[IVXL]+\s+\d{2,4}/g,
  // Pathoma imprint footer, with or without the page numbers around it.
  /\d{0,4}\s*FUNDAMENTALS OF PATHOLOGY\s*\d{0,4}\s*(?:Www\.Medicalstudyzone\.com)?/gi,
  /Www\.Medicalstudyzone\.com/gi,
];

/** A line that begins a list item or an all-caps heading keeps its own line. */
const KEEPS_OWN_LINE_RE = /^(?:[A-Z]\.|[IVXL]+\.|\d+\.|[-•▪])\s|^[A-Z][A-Z\s]{3,}$/;

export interface CleanedExcerpt {
  text: string;
  /** The chunk was sliced out of a longer sentence; render a leading ellipsis. */
  startsMidSentence: boolean;
  /** The chunk was cut before its sentence ended; render a trailing ellipsis. */
  endsMidSentence: boolean;
}

/**
 * Repairs a chunk into something that reads like a quotation from a book.
 *
 * The important part is unwrapping the PDF's hard line breaks: rendering them
 * faithfully (as the old `white-space: pre-wrap` did) is most of why an
 * excerpt reads as machine output rather than as prose.
 */
export function cleanExcerpt(raw: string): CleanedExcerpt {
  let text = raw;
  for (const re of [...WATERMARK_RES, ...RUNNING_HEAD_RES]) {
    text = text.replace(re, " ");
  }

  // Unwrap hard wraps: a newline between two body lines becomes a space, but a
  // blank line, a list item, or an all-caps heading keeps its break.
  const lines = text.split(/\r?\n/);
  let unwrapped = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") {
      unwrapped = unwrapped.replace(/\s+$/, "") + "\n\n";
      continue;
    }
    if (unwrapped === "" || unwrapped.endsWith("\n")) {
      unwrapped += line;
    } else if (KEEPS_OWN_LINE_RE.test(line)) {
      unwrapped += "\n" + line;
    } else {
      unwrapped += " " + line;
    }
  }

  text = unwrapped
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Everything was noise. Fall back to the raw chunk rather than show nothing —
  // a messy excerpt is still evidence, an empty one is a broken UI.
  if (text.length < 24) {
    return {
      text: raw.trim(),
      startsMidSentence: false,
      endsMidSentence: false,
    };
  }

  return {
    text,
    startsMidSentence: /^[a-z(]/.test(text),
    endsMidSentence: !/[.!?:"'”)]$/.test(text),
  };
}

// ── Match strength ───────────────────────────────────────────────────────────

export type MatchStrength = "strong" | "good" | "related";

export const MATCH_STRENGTH_LABELS: Record<MatchStrength, string> = {
  strong: "Strong match",
  good: "Good match",
  related: "Related",
};

/**
 * Buckets cosine similarity into words.
 *
 * A one-decimal percentage invites a non-technical reader to treat it as "how
 * true this passage is", which it is not — it is how close two embeddings sit.
 * The exact figure stays available on hover for anyone who wants it.
 */
export function matchStrength(similarity: number): MatchStrength {
  if (similarity >= 0.75) return "strong";
  if (similarity >= 0.66) return "good";
  return "related";
}

// ── Query highlighting ───────────────────────────────────────────────────────

const HIGHLIGHT_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "what", "when", "which",
  "are", "was", "were", "has", "have", "had", "its", "into", "how", "why",
  "management", "treatment", "diagnosis", "patient", "patients",
]);

export interface ExcerptSegment {
  text: string;
  hit: boolean;
}

/**
 * Splits an excerpt into plain and matched segments so the reader can see why
 * a passage was retrieved. Showing the overlap is what turns "trust me" into
 * something checkable at a glance.
 */
export function highlightQuery(text: string, query: string): ExcerptSegment[] {
  const terms = Array.from(
    new Set(
      (query ?? "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4 && !HIGHLIGHT_STOPWORDS.has(t))
    )
  );
  if (terms.length === 0) return [{ text, hit: false }];

  // Longest first, so "hypertension" wins over "hyper" on an overlap.
  terms.sort((a, b) => b.length - a.length);
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");

  const segments: ExcerptSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), hit: false });
    segments.push({ text: match[0], hit: true });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), hit: false });
  return segments.length > 0 ? segments : [{ text, hit: false }];
}

// ── Index rows ───────────────────────────────────────────────────────────────

/** Trailing fragments that make a truncated lead read as cut off mid-thought. */
const TRAILING_PARTIAL_RE = /[\s,;:(]+\S*$/;

/**
 * A short descriptor of what a passage opens with, for the contents row when
 * nothing better is available.
 *
 * This is the passage's own first words, trimmed at a word boundary — not a
 * summary. Deliberately so: a generated one-line gloss of a medical passage
 * that drifts from the text underneath it would be worse than a blunt quote.
 */
export function passageLead(text: string, maxChars = 72): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxChars) return flat;

  const cut = flat.slice(0, maxChars);
  const trimmed = cut.replace(TRAILING_PARTIAL_RE, "");
  return (trimmed.length >= maxChars * 0.5 ? trimmed : cut).trimEnd() + "…";
}

export interface SourceChapter {
  /** Chapter or section heading shared by these passages; null when unknown. */
  heading: string | null;
  passages: SheetSource[];
}

export interface SourceBook {
  /** Display title of the work. */
  title: string;
  /** Raw guideline_name, kept so callers can still key off the true document. */
  rawName: string;
  chapters: SourceChapter[];
  passageCount: number;
}

/**
 * Reshapes a flat passage list into the book -> chapter -> passage tree the
 * source list renders as a contents page.
 *
 * Retrieval routinely returns eight passages from one chapter of one book. Flat,
 * that renders as eight near-identical headers; grouped, it reads as a single
 * citation with eight page references under it. Books are ordered by their best
 * match, chapters and passages in book order where positions are known.
 */
export function groupSources(sources: readonly SheetSource[]): SourceBook[] {
  const books = new Map<string, SourceBook>();

  for (const source of orderSources(sources)) {
    const rawName = source.guidelineName;
    let book = books.get(rawName);
    if (!book) {
      book = {
        title: source.book ?? cleanDocumentName(rawName),
        rawName,
        chapters: [],
        passageCount: 0,
      };
      books.set(rawName, book);
    }
    // A label on any one passage names the whole book — retrieval can return
    // the same document with the label resolved on only some of its chunks.
    if (source.book && book.title !== source.book) book.title = source.book;
    book.passageCount++;

    const heading = source.chapter ?? resolveLocation(source).heading;
    const last = book.chapters[book.chapters.length - 1];
    if (last && last.heading === heading) {
      last.passages.push(source);
    } else {
      book.chapters.push({ heading, passages: [source] });
    }
  }

  return [...books.values()];
}

// ── Ordering ─────────────────────────────────────────────────────────────────

/**
 * Orders passages the way a bibliography would: by document, then by position
 * within that document, so consecutive passages from one book read in book
 * order instead of jumping around by similarity score. Documents themselves
 * are ordered by their single best match.
 */
export function orderSources(sources: readonly SheetSource[]): SheetSource[] {
  const bestByDoc = new Map<string, number>();
  for (const s of sources) {
    const best = bestByDoc.get(s.guidelineName);
    if (best === undefined || s.similarity > best) {
      bestByDoc.set(s.guidelineName, s.similarity);
    }
  }

  return [...sources].sort((a, b) => {
    if (a.guidelineName !== b.guidelineName) {
      const diff = (bestByDoc.get(b.guidelineName) ?? 0) - (bestByDoc.get(a.guidelineName) ?? 0);
      if (diff !== 0) return diff;
      return a.guidelineName.localeCompare(b.guidelineName);
    }
    // Within one document, book order — but only when both positions are
    // known. Legacy sheets carry no chunkIndex and fall back to similarity.
    if (typeof a.chunkIndex === "number" && typeof b.chunkIndex === "number") {
      return a.chunkIndex - b.chunkIndex;
    }
    return b.similarity - a.similarity;
  });
}
