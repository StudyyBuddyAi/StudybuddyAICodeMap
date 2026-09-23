/**
 * The sheet's section plan, resolved server-side.
 *
 * A sheet used to be six fixed sections named in five separate places — the
 * prompt's JSON skeleton, the client parser's allowlist, the renderer's
 * config, the exporter and the scorer. The plan makes it one list, decided
 * here and sent to the client in a `__meta` frame ahead of the model's first
 * byte, so the document's shape is known before any content arrives.
 *
 * Deciding it here rather than asking the model for it means the model cannot
 * emit a plan that fails to parse, names a reserved key, or disagrees with the
 * bodies it then writes. Its job is only to fill the keys it is given.
 *
 * `flashcards` and `referenceNote` are not in the plan: they are separate
 * contracts (the deck feeds the spaced-repetition library, the reference note
 * carries grounding) and the client appends them as fixed trailing sections.
 *
 * The mirror of this file is src/lib/sheet-plan.ts, which validates what
 * arrives. The shapes must stay in step.
 */

export type SectionKind = "prose" | "list";

export interface SheetSectionSpec {
  /** Top-level JSON key the model writes this section's body under. */
  key: string;
  /** Heading shown to the reader. */
  title: string;
  kind: SectionKind;
  /** Name from the client's icon vocabulary; unknown names fall back. */
  icon?: string;
  /** Whether a "verified sources" badge may appear on this section. */
  evidenceBacked?: boolean;
}

/**
 * The plan every sheet gets today: the same six sections, in the same order,
 * that the prompt has always asked for. Emitting it changes nothing a reader
 * sees — it puts the pipe in place so the sections can start varying by topic
 * and settings without another client release.
 */
export const DEFAULT_SHEET_PLAN: readonly SheetSectionSpec[] = [
  { key: "overview", title: "Overview", kind: "prose", icon: "overview", evidenceBacked: true },
  { key: "memoryHooks", title: "Memory Hooks", kind: "list", icon: "memory", evidenceBacked: false },
  { key: "clinicalApproach", title: "Clinical Approach", kind: "prose", icon: "clinical", evidenceBacked: true },
  { key: "keyPoints", title: "Key Points", kind: "list", icon: "keypoints", evidenceBacked: true },
  { key: "examTraps", title: "Exam Traps", kind: "list", icon: "traps", evidenceBacked: false },
];

/**
 * The plan for one request.
 *
 * Currently constant. This is the seam the settings will bind to: exam mode
 * choosing the section spine, difficulty adding or dropping a section, and the
 * topic's archetype deciding which sections a drug or an organism needs that a
 * disease does not.
 */
export function resolveSheetPlan(): SheetSectionSpec[] {
  return DEFAULT_SHEET_PLAN.map((spec) => ({ ...spec }));
}
