/**
 * How a section's body is shaped, which is what the renderer dispatches on.
 * `prose` is one string with `\n`-separated labelled lines; `list` is an array
 * of one-liners; `table` is an array of rows, each an array of cells under the
 * spec's `columns`.
 */
export type SectionKind = "prose" | "list" | "table";

/** A section body as it arrives: prose, list items, or table rows. */
export type SectionBody = string | string[] | string[][];

/**
 * Icon vocabulary shared by the server (which names one per planned section)
 * and the renderer (which maps the name to a component). A name the renderer
 * does not know falls back to a generic mark rather than rendering nothing, so
 * the server can add archetype sections without a client release.
 */
export type SectionIconName =
  | "overview"
  | "memory"
  | "clinical"
  | "keypoints"
  | "traps"
  | "flashcards"
  | "reference"
  | "drug"
  | "micro"
  | "anatomy"
  | "pathway"
  | "procedure"
  | "data"
  | "compare";

/**
 * One planned section: what to call it, how to render it, and where it sits.
 *
 * The plan is resolved server-side from the request's settings and sent ahead
 * of the model's first byte, so the document's shape is known before any
 * content arrives and never reflows. The model is told to fill these keys and
 * nothing else.
 */
export interface SheetSectionSpec {
  /** Top-level JSON key the model writes this section's body under. */
  key: string;
  /** Heading shown to the reader, e.g. "Adverse Effects". */
  title: string;
  kind: SectionKind;
  icon?: SectionIconName;
  /** Whether a "verified sources" badge may appear on this section. */
  evidenceBacked?: boolean;
  /** `table` only — the column headers, fixed by the server. */
  columns?: string[];
}

export interface Flashcard {
  tag: string;        // e.g. "Next Step", "Diagnosis", "Mechanism", "Complication"
  question: string;   // full question text, tag already stripped
  answer: string;     // answer text
}

export interface EnhancementResult {
  mode: "expand" | "clinical";
  sourceText: string;
  result: string;
  createdAt: string;
}

export interface SheetSource {
  id: string;
  guidelineName: string;
  sectionTitle: string | null;
  sourceUrl: string | null;
  similarity: number;
  content: string;
  // ── Locator fields, all optional: absent on every sheet saved before the
  // 20260905000000 migration taught match_guideline_chunks to return them, and
  // absent per-chunk for documents whose ingestion run recorded no metadata.
  // src/lib/source-display.ts degrades to showing no location at all rather
  // than guessing. `pageStart`/`pageEnd` are PDF page indices, not printed page
  // numbers — read the note on RagChunk in supabase/functions/_shared/rag.ts.
  chunkIndex?: number | null;
  totalChunks?: number | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  // ── Model-proposed labels, validated against the raw chunk before they are
  // ever set (src/lib/source-labels.ts). Present only when the label survived
  // that check, so display code can trust them and fall back to the mechanical
  // repair in src/lib/source-display.ts whenever they are absent.
  /** Human-readable title of the work, e.g. "Nelson Textbook of Pediatrics, 22nd Edition". */
  book?: string;
  /** Where in the book the passage sits, e.g. "Chapter 415 — Portal Hypertension". */
  chapter?: string;
  /** Contents-page entry for this one passage, e.g. "Transfusion thresholds in acute bleeding". */
  section?: string;
}

/**
 * How much of a sheet actually rests on retrieved guideline context.
 *
 * Retrieval is not binary: the library routinely covers a topic's
 * pathophysiology but not its management. `partial` exists so a sheet can
 * never present model-generated advice under a "Verified sources" badge.
 */
export type GroundingLevel = "full" | "partial" | "none";

/**
 * A section key the model can report as uncovered by the context.
 *
 * Open rather than a union: which sections a sheet has depends on its plan, so
 * a drug sheet reports "adverseEffects" and a pathway sheet "cofactors". The
 * plan supplies the reader-facing label — see `sectionLabel` in
 * src/lib/grounding.ts.
 */
export type SheetSectionKey = string;

/**
 * The model's own declaration of which sections it had to write from general
 * medical knowledge. Only the model knows this, so it must report it — but the
 * server can only ever weaken the claim, never strengthen it. See
 * `reconcileGroundingLevel` in src/lib/grounding.ts.
 */
export interface SourceCoverage {
  level: GroundingLevel;
  uncovered: SheetSectionKey[];
}

export interface GeneratedSheet {
  topic?: string; // normalized topic name, e.g. "Heart Failure"
  /**
   * The sections this sheet was built to contain, in reading order. Absent on
   * every sheet saved before the plan existed, and on any response whose
   * `__meta` frame did not arrive — `resolvePlan` falls back to the legacy six
   * in both cases, so an unplanned sheet renders exactly as it always did.
   */
  plan?: SheetSectionSpec[];
  /**
   * Section bodies by key. Populated by `normalize` from every top-level key
   * that is not reserved metadata, so a section the legacy interface never
   * named still survives parsing instead of being silently dropped.
   *
   * The six legacy fields below are kept in step with this map for the code
   * that still reads them by name (export, grounding, the flashcard save).
   */
  sections?: Record<string, SectionBody>;
  overview: string;
  memoryHooks: string[];
  clinicalApproach: string;
  keyPoints: string[];
  examTraps: string[];
  flashcards: Flashcard[];
  referenceNote: string;
  // emoji picked by the AI for the topic — extracted from flashcards block
  topicEmoji?: string;
  enhancements?: Record<string, EnhancementResult>; // key = enhancementKey(sourceText, mode)
  /** @deprecated Legacy boolean from before three-level grounding. Read-only —
   *  only ever present on rows saved before this field existed. New sheets
   *  write `groundingLevel` instead. See `resolveGroundingLevel`. */
  grounded?: boolean;
  sources?: SheetSource[];
  // Three-level grounding metadata (replaces the boolean `grounded` above).
  // All absent on legacy sheets and on rows saved before this field existed.
  groundingLevel?: GroundingLevel;
  sourceCoverage?: SourceCoverage;
  // Raw retrieval count captured at generation time — persisted so a reloaded
  // sheet can still distinguish "nothing retrieved" from "retrieved but the
  // model judged it not relevant" (both reconcile to groundingLevel "none").
  retrievedChunks?: number;
  /**
   * Written by the premium writer (X-Is-Premium). A premium sheet is
   * personalizable whatever the student's plan — the free premium generation
   * is the Pro experience. Unlocks the manual parts only: see `premiumGrant`.
   */
  premium?: boolean;
  /**
   * The server's proof that this sheet was streamed as premium to a student
   * without Pro (premium_sheet_grants). The AI actions send it, and the server
   * checks it; a client flag alone unlocks nothing that costs anything.
   */
  premiumGrant?: string;
}

// Lightweight type used when loading a saved sheet from study_history.
// The output column stores JSON.stringify(GeneratedSheet).
// Old rows (pre-migration) store raw text blobs — use isJsonSheet() to
// distinguish them.
export type StoredSheetOutput = string;

/**
 * Returns true if the stored output string is a JSON-serialised
 * GeneratedSheet (post-migration). Returns false for legacy text blobs.
 */
export function isJsonSheet(output: string): boolean {
  return output.trimStart().startsWith("{");
}

/**
 * Safely parse a stored output string into a GeneratedSheet.
 * Returns null if parsing fails or the value is a legacy blob.
 */
export function parseStoredSheet(output: string): GeneratedSheet | null {
  if (!isJsonSheet(output)) return null;
  try {
    return JSON.parse(output) as GeneratedSheet;
  } catch {
    return null;
  }
}

/**
 * Generates a stable cache key for an enhancement result.
 * Used for both localStorage and the enhancements map in saved sheets.
 */
export function enhancementKey(sourceText: string, mode: "expand" | "clinical"): string {
  const snippet = sourceText.trim().slice(0, 40).replace(/\s+/g, "_");
  return `${mode}:${snippet}`;
}
