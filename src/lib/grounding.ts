import type {
  GeneratedSheet,
  GroundingLevel,
  SheetSectionKey,
  SourceCoverage,
} from "@/types/generated-sheet";

const LEVELS: readonly GroundingLevel[] = ["full", "partial", "none"];

/** Sections that exist on every sheet regardless of which plan it got. */
const FIXED_SECTION_LABELS: Record<string, string> = {
  flashcards: "Flashcards",
  referenceNote: "Reference note",
};

/**
 * Label for one `SourceCoverage.uncovered` entry, used in GroundingNotice.
 *
 * The sheet's sections vary by topic now, so there is no fixed list to look
 * them up in. The plan carries the reader-facing title, and a key with no plan
 * entry is de-camel-cased rather than dropped — a sheet must not silently stop
 * reporting a section as ungrounded just because this build cannot name it.
 */
export function sectionLabel(
  key: string,
  plan?: readonly { key: string; title: string }[]
): string {
  const planned = plan?.find((s) => s.key === key);
  if (planned) return planned.title;
  if (FIXED_SECTION_LABELS[key]) return FIXED_SECTION_LABELS[key];
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

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
  // Any non-empty string key is kept. This used to be filtered against the six
  // legacy section names, which would now silently drop a drug sheet reporting
  // "adverseEffects" as ungrounded — turning an honest partial claim into a
  // stronger one than the model made.
  const uncovered = uncoveredRaw.filter(
    (k): k is SheetSectionKey => typeof k === "string" && k.trim().length > 0
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
