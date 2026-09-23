import type {
  GeneratedSheet,
  SectionIconName,
  SectionKind,
  SheetSectionSpec,
} from "@/types/generated-sheet";

/**
 * The sheet's section plan.
 *
 * A sheet used to be six fixed sections in a fixed order, named in five
 * different places: the prompt's JSON skeleton, the parser's allowlist, the
 * renderer's config, the exporter and the scorer. Adding a seventh meant
 * editing all five, and a section the model invented on its own was discarded
 * by the parser before anything could show it.
 *
 * The plan replaces that. It is resolved server-side from the request's
 * settings and sent ahead of the model's first byte, so:
 *   - the document's shape is known before any content arrives (no reflow),
 *   - the model is told which keys to fill rather than proposing them, so it
 *     cannot emit a plan that fails to parse or disagrees with its own bodies,
 *   - the renderer, the exporter and the scorer all read one list.
 *
 * `flashcards` and `referenceNote` are deliberately NOT in the plan. They are
 * separate contracts — the deck feeds the FSRS library and the reference note
 * carries grounding — so they are appended as fixed trailing sections.
 */

/**
 * Top-level keys of the sheet JSON that carry metadata rather than a section
 * body. Everything else `normalize` sees becomes a section.
 */
export const RESERVED_SHEET_KEYS: ReadonlySet<string> = new Set([
  "topic",
  "topicEmoji",
  "plan",
  "sections",
  "flashcards",
  "referenceNote",
  "sourceCoverage",
  "enhancements",
  "grounded",
  "sources",
  "groundingLevel",
  "retrievedChunks",
]);

const KINDS: readonly SectionKind[] = ["prose", "list"];

/**
 * The six sections every sheet had before the plan existed. Used for sheets
 * saved before this feature and for any response whose plan frame is missing,
 * so both render exactly as they always did.
 */
export const LEGACY_PLAN: readonly SheetSectionSpec[] = [
  { key: "overview", title: "Overview", kind: "prose", icon: "overview", evidenceBacked: true },
  { key: "memoryHooks", title: "Memory Hooks", kind: "list", icon: "memory", evidenceBacked: false },
  { key: "clinicalApproach", title: "Clinical Approach", kind: "prose", icon: "clinical", evidenceBacked: true },
  { key: "keyPoints", title: "Key Points", kind: "list", icon: "keypoints", evidenceBacked: true },
  { key: "examTraps", title: "Exam Traps", kind: "list", icon: "traps", evidenceBacked: false },
];

/** Appended after the plan, in this order, on every sheet. */
export const FLASHCARDS_SPEC: SheetSectionSpec = {
  key: "flashcards",
  title: "Flashcards",
  kind: "list",
  icon: "flashcards",
  evidenceBacked: false,
};

export const REFERENCE_NOTE_SPEC: SheetSectionSpec = {
  key: "referenceNote",
  title: "Reference Note",
  kind: "prose",
  icon: "reference",
  evidenceBacked: false,
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validates a plan as received over the wire. Returns null for anything that
 * is not a usable list, so the caller falls back to the legacy plan rather
 * than rendering an empty document.
 *
 * Entries are dropped individually when malformed, and duplicate or reserved
 * keys are rejected — two sections writing the same key would render the same
 * body twice, and a section named `flashcards` would collide with the deck.
 */
export function parsePlan(raw: unknown): SheetSectionSpec[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const specs: SheetSectionSpec[] = [];

  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const { key, title, kind, icon, evidenceBacked } = entry;
    if (typeof key !== "string" || !key.trim()) continue;
    if (typeof title !== "string" || !title.trim()) continue;
    if (typeof kind !== "string" || !KINDS.includes(kind as SectionKind)) continue;
    if (RESERVED_SHEET_KEYS.has(key) || seen.has(key)) continue;
    seen.add(key);
    specs.push({
      key,
      title,
      kind: kind as SectionKind,
      icon: typeof icon === "string" ? (icon as SectionIconName) : undefined,
      evidenceBacked: evidenceBacked === true,
    });
  }

  return specs.length > 0 ? specs : null;
}

/** The sheet's content sections, falling back to the legacy six. */
export function resolvePlan(sheet: Pick<GeneratedSheet, "plan">): SheetSectionSpec[] {
  return sheet.plan?.length ? sheet.plan : [...LEGACY_PLAN];
}

/** Everything the renderer lays out, content sections first. */
export function renderOrder(sheet: Pick<GeneratedSheet, "plan">): SheetSectionSpec[] {
  return [...resolvePlan(sheet), FLASHCARDS_SPEC, REFERENCE_NOTE_SPEC];
}

/**
 * A section's body.
 *
 * Reads `sections` first, then the legacy top-level field of the same name.
 * Both paths are live: a freshly parsed sheet has `sections`, while one loaded
 * from study history was stored before it existed and carries only the named
 * fields (`parseStoredSheet` is a plain JSON.parse, not `normalize`).
 */
export function sectionBody(
  sheet: GeneratedSheet,
  key: string
): string | string[] | undefined {
  const fromMap = sheet.sections?.[key];
  if (fromMap !== undefined) return fromMap;
  const legacy = (sheet as unknown as Record<string, unknown>)[key];
  if (typeof legacy === "string") return legacy;
  if (Array.isArray(legacy)) return legacy.filter((v): v is string => typeof v === "string");
  return undefined;
}

/** True when a section has something worth showing — used by the navigator. */
export function sectionHasBody(sheet: GeneratedSheet, key: string): boolean {
  if (key === "flashcards") return (sheet.flashcards?.length ?? 0) > 0;
  const body = sectionBody(sheet, key);
  if (Array.isArray(body)) return body.length > 0;
  return typeof body === "string" && body.trim().length > 0;
}
