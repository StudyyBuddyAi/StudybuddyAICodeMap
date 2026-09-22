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

// ── Visual aid ─────────────────────────────────────────────────────────────
// One optional visual per sheet, planned after the sheet is written by the
// sheet-visual edge function (supabase/functions/_shared/sheet-visual-plan.ts)
// — never by the model that wrote the sheet. Flowcharts and charts render
// straight from this data; an image is only a plan until the student asks for
// it — see supabase/functions/generate-sheet-image.

/** Mirrors IMAGE_VIEWS in supabase/functions/_shared/sheet-image-key.ts. */
export type ImageView = "gross" | "histology" | "cross-section" | "schematic";

/** Sections a visual may sit under. Flashcards and the reference note never get one. */
export type VisualPlacement = Exclude<SheetSectionKey, "flashcards">;

export type FlowchartNodeShape = "start" | "step" | "decision" | "end";

export interface FlowchartNode {
  /** The model's own id — only used to resolve edges, never rendered or put into mermaid syntax. */
  id: string;
  label: string;
  shape: FlowchartNodeShape;
}

export interface FlowchartEdge {
  from: string;
  to: string;
  label?: string;
}

/**
 * Nodes and edges rather than mermaid source: the model fills in labels, and
 * the syntax is built (and escaped) client-side in src/lib/sheet-visual-mermaid.ts,
 * so a stray bracket or quote in a label can't break the diagram.
 */
export interface VisualFlowchartSpec {
  direction: "TD" | "LR";
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
}

export interface VisualChartSeries {
  name: string;
  values: number[];
}

export interface VisualChartSpec {
  chartType: "line" | "bar";
  xLabels: string[];
  series: VisualChartSeries[];
  yLabel?: string;
}

export interface VisualSpecBase {
  /** Short caption shown above the rendered visual. */
  title: string;
  /** Which section this augments — rendered at the end of that section's card. */
  placement: VisualPlacement;
}

/** The diagram half: drawn from the sheet's own data, free and instant. */
export type VisualSpec =
  | (VisualSpecBase & { kind: "flowchart"; flowchart: VisualFlowchartSpec })
  | (VisualSpecBase & { kind: "chart"; chart: VisualChartSpec });

/**
 * The illustration half: a plan for an AI-drawn picture, kept separate from the
 * diagram because it costs money per new subject and is the least reliable
 * thing on the sheet. Nothing is drawn until the student asks.
 */
export interface IllustrationSpec {
  /** Caption, e.g. "Renal corpuscle histology". */
  title: string;
  /** How it is drawn. With the sheet topic this is the whole image request and its cache key. */
  view: ImageView;
  /** Display only ("brachial plexus — schematic"); never sent to the image model. */
  subject: string;
  /** Alt text. */
  alt: string;
}

export type VisualKind = VisualSpec["kind"];

/** Set once a requested image exists — kept apart from the model's `visual`
 *  plan so a pending or failed image never alters the plan itself. */
export interface VisualImageResult {
  url: string;
  provider: string; // e.g. "openrouter/google/gemini-3.1-flash-image"
  generatedAt: string; // ISO timestamp
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
  /** The planned diagram. Absent until the student asks for one, or when none fits. */
  visual?: VisualSpec;
  /** The planned illustration. Absent until the student asks, or when the topic has nothing to draw. */
  illustration?: IllustrationSpec;
  /** Present only once the illustration has actually been generated. */
  visualImage?: VisualImageResult;
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
