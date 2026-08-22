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
  // Grounding metadata from medical-notes' __meta SSE frame. Absent on legacy
  // sheets and on sheets generated with grounding turned off.
  grounded?: boolean;
  sources?: SheetSource[];
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
