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
}

/**
 * How much of a sheet actually rests on retrieved guideline context.
 *
 * Retrieval is not binary: the library routinely covers a topic's
 * pathophysiology but not its management. `partial` exists so a sheet can
 * never present model-generated advice under a "Verified sources" badge.
 */
export type GroundingLevel = "full" | "partial" | "none";

/** The sheet sections the model can report as uncovered by the context. */
export type SheetSectionKey =
  | "overview"
  | "clinicalApproach"
  | "keyPoints"
  | "examTraps"
  | "memoryHooks"
  | "flashcards";

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
