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
 * arrives. The wire shapes must stay in step.
 */
import {
  ARCHETYPES,
  DEFAULT_ARCHETYPE,
  SECTIONS,
  itemPhrase,
  listItems,
  proseBudget,
  type ArchetypeId,
  type Difficulty,
  type ExamMode,
  type LengthSetting,
  type SectionKind,
  type SectionTemplate,
} from "./sheet-sections.ts";

export type { SectionKind };

/** What the client receives. The brief and the counts stay on the server. */
export interface SheetSectionSpec {
  key: string;
  title: string;
  kind: SectionKind;
  icon?: string;
  evidenceBacked?: boolean;
}

/**
 * A planned section: the wire spec plus what the prompt needs to ask for it
 * and what the scorer needs to check it.
 */
export interface PlannedSection extends SheetSectionSpec {
  brief: string;
  /** `list` only. */
  items?: [number, number];
  /** `prose` only. */
  budget?: string;
}

/**
 * Ceiling on content sections. Past roughly this many the sheet stops being
 * scannable and generation runs long enough to hurt time-to-first-section —
 * and the model starts padding thin sections rather than dropping them.
 */
export const MAX_SECTIONS = 7;

/**
 * Sections that are study aids rather than content, always sorted to the end
 * in this order. They summarise the sheet, so they cannot precede the material
 * they summarise.
 */
const TRAILING_SECTIONS = ["keyPoints", "memoryHooks", "examTraps"];

export interface PlanRequest {
  archetype?: ArchetypeId | null;
  examMode?: string;
  difficulty?: string;
  length?: string;
}

const asExamMode = (v: string | undefined): ExamMode =>
  v === "USMLE Step 1" || v === "USMLE Step 2" ? v : "General";

const asDifficulty = (v: string | undefined): Difficulty =>
  v === "Basic" || v === "Advanced" ? v : "Intermediate";

const asLength = (v: string | undefined): LengthSetting =>
  v === "Moderate" || v === "Detailed" ? v : "Concise";

function toPlanned(template: SectionTemplate, len: LengthSetting): PlannedSection {
  const spec: PlannedSection = {
    key: template.key,
    title: template.title,
    kind: template.kind,
    icon: template.icon,
    evidenceBacked: template.evidenceBacked,
    brief: template.brief,
  };
  if (template.kind === "list") spec.items = listItems(template, len);
  else spec.budget = proseBudget(template, len);
  return spec;
}

/**
 * The sections this request gets.
 *
 * Archetype picks the spine; exam mode and difficulty add to it. That is the
 * whole point of the change: those two settings used to be adjectives in a
 * preamble that the model was free to ignore and no check could catch. They
 * now decide which sections exist, and a sheet missing one is a scorable
 * failure rather than a matter of taste.
 *
 * Keys are de-duplicated — an archetype may list the same section under both
 * an exam mode and a difficulty — and the result is capped at MAX_SECTIONS,
 * spine first so the additions are what get dropped.
 */
export function resolveSheetPlan(req: PlanRequest = {}): PlannedSection[] {
  const archetype = ARCHETYPES[req.archetype ?? DEFAULT_ARCHETYPE] ?? ARCHETYPES[DEFAULT_ARCHETYPE];
  const examMode = asExamMode(req.examMode);
  const difficulty = asDifficulty(req.difficulty);
  const len = asLength(req.length);

  const keys: string[] = [];
  const add = (key: string) => {
    if (!keys.includes(key) && SECTIONS[key]) keys.push(key);
  };

  archetype.spine.forEach(add);
  (archetype.byExamMode?.[examMode] ?? []).forEach(add);
  (archetype.byDifficulty?.[difficulty] ?? []).forEach(add);

  // Study aids read last whatever order they were added in. Without this a
  // section added by exam mode lands after "Exam Traps", so the sheet ends on
  // pharmacokinetics — the additions are appended, but they are still content.
  const ordered = [
    ...keys.filter((k) => !TRAILING_SECTIONS.includes(k)),
    ...TRAILING_SECTIONS.filter((k) => keys.includes(k)),
  ];

  return ordered.slice(0, MAX_SECTIONS).map((key) => toPlanned(SECTIONS[key], len));
}

/** Strips the server-only fields before the plan goes over the wire. */
export function toWirePlan(plan: PlannedSection[]): SheetSectionSpec[] {
  return plan.map(({ key, title, kind, icon, evidenceBacked }) => ({
    key,
    title,
    kind,
    icon,
    evidenceBacked,
  }));
}

/** The count phrase for one section, as the prompt and checklist both state it. */
export function sectionQuota(section: PlannedSection): string {
  return section.kind === "list" && section.items
    ? `${itemPhrase(section.items)} items`
    : section.budget ?? "";
}

/**
 * The plan the condition archetype produced before the settings bound to it:
 * the five sections a sheet has always had. Kept as the client's fallback and
 * as the drift guard's reference.
 */
export const DEFAULT_SHEET_PLAN: readonly SheetSectionSpec[] = toWirePlan(
  resolveSheetPlan({ archetype: "condition", examMode: "General", difficulty: "Intermediate", length: "Concise" })
);
