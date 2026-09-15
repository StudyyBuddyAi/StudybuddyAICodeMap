import type {
  GeneratedSheet,
  GroundingLevel,
  SheetSectionKey,
  SourceCoverage,
} from "@/types/generated-sheet";

const LEVELS: readonly GroundingLevel[] = ["full", "partial", "none"];
const SECTION_KEYS: readonly SheetSectionKey[] = [
  "overview",
  "clinicalApproach",
  "keyPoints",
  "examTraps",
  "memoryHooks",
  "flashcards",
  "figures",
];

/** Human-readable labels for `SourceCoverage.uncovered`, used in GroundingNotice. */
export const SECTION_LABELS: Record<SheetSectionKey, string> = {
  overview: "Overview",
  clinicalApproach: "Clinical approach",
  keyPoints: "Key points",
  examTraps: "Exam traps",
  memoryHooks: "Memory hooks",
  flashcards: "Flashcards",
  figures: "Figures",
};

/** Fixed referenceNote string for level "none" — no variation permitted. */
export const REFERENCE_NOTE_NONE =
  "Not covered by our reference library — written from general medical knowledge. Verify before exam or clinical use.";

/**
 * Validates a raw `sourceCoverage` value parsed from the model's JSON output.
 * Never throws — returns null for anything missing, malformed, or carrying an
 * unrecognized level, so the caller can fall back to "partial" per A3.
 */
export function parseSourceCoverage(raw: unknown): SourceCoverage | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const level = obj.level;
  if (typeof level !== "string" || !LEVELS.includes(level as GroundingLevel)) return null;
  const uncoveredRaw = Array.isArray(obj.uncovered) ? obj.uncovered : [];
  const uncovered = uncoveredRaw.filter(
    (k): k is SheetSectionKey => typeof k === "string" && SECTION_KEYS.includes(k as SheetSectionKey)
  );
  return { level: level as GroundingLevel, uncovered };
}

/**
 * Reconciles the model's self-reported coverage against retrieval truth.
 * Retrieval can only weaken the model's claim, never strengthen it:
 * - zero retrieved chunks -> "none", whatever the model said
 * - chunks present but coverage missing/malformed -> "partial", never "full"
 * - chunks present and valid coverage -> the model's own (possibly downgraded) level
 */
export function reconcileGroundingLevel(
  retrievedChunks: number,
  coverage: SourceCoverage | null
): GroundingLevel {
  if (retrievedChunks === 0) return "none";
  if (!coverage) return "partial";
  return coverage.level;
}

/**
 * Grounding as it must be *presented* when the sheet carries figures.
 *
 * A figure is synthesised structure, never retrieved text, so it can never ride
 * a "full" badge — GroundingNotice hides itself on "full", which would leave a
 * generated diagram silently vouched for by the sheet around it.
 *
 * This deliberately does not mutate the sheet's stored `groundingLevel`. That
 * value describes the prose sections and is what a saved flashcard deck
 * inherits (SheetGenerator's save path reads it via `resolveGroundingLevel`);
 * clamping it at the source would mislabel a fully grounded deck as partial.
 * Presentation is clamped here, at the point of display, and nowhere else.
 *
 * Note this is a client-side rule by necessity: the edge function streams the
 * model's JSON straight through without parsing it, so it has no opportunity to
 * rewrite sourceCoverage without buffering the whole response and destroying
 * the incremental section reveal.
 */
export function presentedGrounding(
  level: GroundingLevel | null,
  coverage: SourceCoverage | null,
  hasFigures: boolean
): { level: GroundingLevel | null; coverage: SourceCoverage | null } {
  if (!hasFigures || level === null) return { level, coverage };

  const presentedLevel: GroundingLevel = level === "full" ? "partial" : level;
  const uncovered = coverage?.uncovered ?? [];

  return {
    level: presentedLevel,
    coverage: {
      level: presentedLevel,
      uncovered: uncovered.includes("figures") ? uncovered : [...uncovered, "figures"],
    },
  };
}

/**
 * Read path for a sheet already saved (possibly under the old boolean
 * `grounded` field). Returns null when there is nothing to show — legacy rows
 * saved before grounding existed at all render no badge and no notice, exactly
 * as they did before this feature.
 */
export function resolveGroundingLevel(sheet: GeneratedSheet): GroundingLevel | null {
  if (sheet.groundingLevel) return sheet.groundingLevel;
  if (typeof sheet.grounded === "boolean") return sheet.grounded ? "full" : "none";
  return null;
}

/**
 * Grounding level for a freshly generated flashcard deck.
 *
 * Cards have no `sourceCoverage` block — each card reports for itself via the
 * [Grounded]/[General] sourcing tag. Retrieval is still the ceiling: zero
 * retrieved chunks forces "none" no matter what the model tagged, and chunks
 * that produced no grounded card are also "none" (the library matched the
 * query but nothing in it survived into a card).
 */
export function groundingLevelFromCards(
  retrievedChunks: number,
  cards: readonly { grounded: boolean }[]
): GroundingLevel {
  if (retrievedChunks === 0 || cards.length === 0) return "none";
  const groundedCount = cards.filter((c) => c.grounded).length;
  if (groundedCount === 0) return "none";
  return groundedCount === cards.length ? "full" : "partial";
}
