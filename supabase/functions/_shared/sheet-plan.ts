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
  GROUP_KEYS,
  PART_KEYS,
  SECTIONS,
  briefFor,
  itemPhrase,
  listItems,
  moreBriefFor,
  proseBudget,
  scopeOf,
  sectionLabels,
  type ArchetypeId,
  type Difficulty,
  type ExamMode,
  type SectionKind,
  type SectionTemplate,
} from "./sheet-sections.ts";
import type { SheetOutline } from "./sheet-outline.ts";

export type { SectionKind };

/** What the client receives. The brief and the counts stay on the server. */
export interface SheetSectionSpec {
  key: string;
  title: string;
  kind: SectionKind;
  icon?: string;
  evidenceBacked?: boolean;
  /** `table` only — the column headers, fixed here rather than by the model. */
  columns?: string[];
}

/**
 * A planned section: the wire spec plus what the prompt needs to ask for it
 * and what the scorer needs to check it. Each part comes twice: once for the
 * high-yield core, written under `key`, and once for the depth a
 * comprehensive sheet adds, written under `<key>_more`.
 */
export interface PlannedSection extends SheetSectionSpec {
  brief: string;
  moreBrief: string;
  /** What belongs here, in one line — for routing a fact to its home. */
  scope: string;
  /** `list` and `table` (as rows). */
  items?: [number, number];
  moreItems?: [number, number];
  /** `prose` only. */
  budget?: string;
  moreBudget?: string;
  /** `prose` only — the labels the core writes, in reading order. */
  coreLabels?: string[];
  /** `prose` only — sub-sections only the depth may add. */
  moreLabels?: string[];
}

/**
 * Ceiling on content sections. Past roughly this many the sheet stops being
 * scannable and generation runs long enough to hurt time-to-first-section —
 * and the model starts padding thin sections rather than dropping them.
 *
 * An archetype plan stays within 7. A group sheet is a map, up to five blocks,
 * a table and two study aids — nine — and its blocks are one member each, not
 * more facets of one thing, so they don't make it less scannable.
 */
export const MAX_SECTIONS = 9;

/**
 * Sections that are study aids rather than content, always sorted to the end
 * in this order. They build on the material — a trap needs the fact it trips
 * over, a hook the fact it encodes — so they cannot precede it. They do not
 * summarise it: each is briefed to add what the sections above did not say.
 */
const TRAILING_SECTIONS = ["keyPoints", "memoryHooks", "examTraps"];

/**
 * The study aids, which get no depth when a whole sheet is deepened. Written
 * after the content sections' depth, they re-served it — a DKA sheet's extra
 * traps and key points restated its new workup lines. A student can still
 * deepen one of them on its own.
 */
export const STUDY_AIDS: readonly string[] = TRAILING_SECTIONS;

/**
 * What decides the plan. Depth is not on it: a high-yield and a comprehensive
 * sheet on the same topic have the same sections, so switching a sheet's view
 * never changes its outline. Depth decides only whether the page grows the
 * sheet's first branches once it has streamed.
 */
export interface PlanRequest {
  archetype?: ArchetypeId | null;
  examMode?: string;
  difficulty?: string;
}

export const asExamMode = (v: string | undefined): ExamMode =>
  v === "USMLE Step 1" || v === "USMLE Step 2" ? v : "General";

const asDifficulty = (v: string | undefined): Difficulty =>
  v === "Basic" || v === "Advanced" ? v : "Intermediate";

function toPlanned(template: SectionTemplate, planKeys: string[], exam: ExamMode): PlannedSection {
  const spec: PlannedSection = {
    key: template.key,
    title: template.title,
    kind: template.kind,
    icon: template.icon,
    evidenceBacked: template.evidenceBacked,
    brief: briefFor(template, planKeys, exam),
    moreBrief: moreBriefFor(template, planKeys, exam),
    scope: scopeOf(template, planKeys, exam),
  };
  if (template.kind === "prose") {
    spec.budget = proseBudget(template, "core");
    spec.moreBudget = proseBudget(template, "more");
    const labels = sectionLabels(template, planKeys, exam);
    spec.coreLabels = labels.core;
    spec.moreLabels = labels.more;
  } else {
    const range = listItems(template);
    spec.items = range.core;
    spec.moreItems = range.more;
  }
  if (template.kind === "table") spec.columns = [...(template.columns ?? [])];
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

  const planKeys = ordered.slice(0, MAX_SECTIONS);
  return planKeys.map((key) => toPlanned(SECTIONS[key], planKeys, examMode));
}

/**
 * The plan for a topic its outline reads as a group: the map, one block per
 * member under the same labels, the table that tells them apart, then the
 * hooks and the traps. Null for a topic that is one thing (or one story),
 * which keeps its archetype's plan.
 *
 * Key Points are left out: a block already holds its member's high-yield
 * lines, and the table holds the discriminators, which is most of what Key
 * Points carried. Exam Traps stay, and on a group sheet they are mostly the
 * confusions between members — the most tested thing about a group.
 */
export function resolveShapedPlan(outline: SheetOutline | null, req: PlanRequest = {}): PlannedSection[] | null {
  if (!outline || (outline.shape !== "compare" && outline.shape !== "survey") || outline.blocks.length < 2) return null;
  const exam = asExamMode(req.examMode);
  const blocks = outline.blocks.slice(0, PART_KEYS.length);
  const planKeys = ["map", ...blocks.map((_, i) => PART_KEYS[i]), "tellApart", "memoryHooks", "examTraps"];
  const names = blocks.map((b) => b.name);

  const map = toPlanned(SECTIONS.map, planKeys, exam);
  map.brief = `How this group fits together, told as a lecturer would open it: 2 to 4 short paragraphs, each on its own line after a \\n, 100 to 180 words in all. No labels, no lists. Say what ties ${names.join(", ")} together, why ${
    outline.axis ? `the axis (${outline.axis})` : "the order of the blocks"
  } is the way to hold them in your head, and the one clue that sets each apart. It names facts the blocks below detail; it does not list them.`;

  const parts = blocks.map((b, i) => {
    const part = toPlanned(SECTIONS[PART_KEYS[i]], planKeys, exam);
    part.title = b.name;
    part.brief = `Everything the sheet says about ${b.name}, as a connected story. Structure it as:\n${b.labels
      .map((l) => `${l}: …`)
      .join("\n")}\nEach label is one or two connected sentences. Only what passes the high-yield test.`;
    part.scope = `everything about ${b.name}`;
    part.coreLabels = [...b.labels];
    return part;
  });

  const table = toPlanned(SECTIONS.tellApart, planKeys, exam);
  table.columns = [...outline.columns];
  // A grouped block ("Respiratory distress — RDS, TTN, MAS") may want a row
  // per member, so a few rows of room past one per block.
  table.items = [blocks.length, blocks.length + 3];

  return [
    map,
    ...parts,
    table,
    ...(["memoryHooks", "examTraps"] as const).map((k) => toPlanned(SECTIONS[k], planKeys, exam)),
  ];
}

/** Whether a plan teaches a group block by block. */
export const isShapedPlan = (plan: readonly { key: string }[]) => plan.some((s) => s.key === "map");

/**
 * What a follow-up's plan cannot rebuild from keys alone: a group sheet's
 * block titles and its table's headers, which its outline chose. The page
 * sends them back as it shows them. They only name things in a prompt —
 * every brief and count is still this build's — so they are trimmed text,
 * like the student's own question or rewrite instruction.
 */
export interface PlanHints {
  titles?: Record<string, string>;
  columns?: Record<string, string[]>;
}

export function parsePlanHints(raw: unknown): PlanHints {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const clean = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;
  const titles: Record<string, string> = {};
  const columns: Record<string, string[]> = {};
  if (r.titles && typeof r.titles === "object") {
    for (const [k, v] of Object.entries(r.titles as Record<string, unknown>)) {
      const t = clean(v, 120);
      if (GROUP_KEYS.includes(k) && t) titles[k] = t;
    }
  }
  if (r.columns && typeof r.columns === "object") {
    for (const [k, v] of Object.entries(r.columns as Record<string, unknown>)) {
      if (k !== "tellApart" || !Array.isArray(v)) continue;
      const cols = v.map((c) => clean(c, 40));
      if (cols.length >= 2 && cols.length <= 4 && cols.every(Boolean)) columns[k] = cols as string[];
    }
  }
  return { titles, columns };
}

/** The head-of-line labels a block's body uses, in order — for a block whose labels only its sheet knows. */
const bodyLabels = (body: unknown): string[] => {
  if (typeof body !== "string") return [];
  const found = [...body.matchAll(/^([A-Z][A-Za-z][A-Za-z ,/&-]{0,30}?):[ \t]/gm)].map((m) => m[1]);
  return [...new Set(found)];
};

/**
 * A saved sheet's plan, rebuilt from its section keys for a follow-up on one
 * of its sections. The briefs and counts are this build's — never taken from
 * the client — and a key the catalogue does not know is dropped. A group
 * sheet's blocks take their titles and table headers from `hints`, and their
 * labels from their own bodies.
 */
export function resolvePlanFromKeys(
  keys: readonly string[],
  examMode?: string,
  hints: PlanHints = {},
  sections: Record<string, unknown> = {}
): PlannedSection[] {
  const exam = asExamMode(examMode);
  const planKeys = [...new Set(keys.filter((k) => !!SECTIONS[k]))].slice(0, MAX_SECTIONS);
  return planKeys.map((key) => {
    const spec = toPlanned(SECTIONS[key], planKeys, exam);
    const title = hints.titles?.[key];
    if (title) spec.title = title;
    if (PART_KEYS.includes(key)) {
      const labels = bodyLabels(sections[key]);
      if (labels.length) {
        spec.coreLabels = labels;
        spec.brief = `Everything the sheet says about ${spec.title}, as a connected story. Structure it as:\n${labels
          .map((l) => `${l}: …`)
          .join("\n")}\nEach label is one or two connected sentences. Only what passes the high-yield test.`;
      }
      spec.scope = `everything about ${spec.title}`;
    }
    const cols = hints.columns?.[key];
    if (key === "tellApart" && cols) spec.columns = [...cols];
    return spec;
  });
}

/** Strips the server-only fields before the plan goes over the wire. */
export function toWirePlan(plan: PlannedSection[]): SheetSectionSpec[] {
  return plan.map(({ key, title, kind, icon, evidenceBacked, columns }) => ({
    key,
    title,
    kind,
    icon,
    evidenceBacked,
    ...(columns ? { columns } : {}),
  }));
}

/**
 * The count phrase for one section's core, or for its depth, as the prompt and
 * checklist both state it.
 */
export function sectionQuota(section: PlannedSection, part: "core" | "more" = "core"): string {
  const items = part === "core" ? section.items : section.moreItems;
  if (section.kind === "table" && items) return `${itemPhrase(items)} rows`;
  if (section.kind === "list" && items) return `${itemPhrase(items)} items`;
  return (part === "core" ? section.budget : section.moreBudget) ?? "";
}

/**
 * The plan the condition archetype produced before the settings bound to it:
 * the five sections a sheet has always had. Kept as the client's fallback and
 * as the drift guard's reference.
 */
export const DEFAULT_SHEET_PLAN: readonly SheetSectionSpec[] = toWirePlan(
  resolveSheetPlan({ archetype: "condition", examMode: "General", difficulty: "Intermediate" })
);
