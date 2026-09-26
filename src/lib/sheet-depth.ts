import { callMedicalNotes } from "@/lib/callMedicalNotes";
import { parseModelUsed, type ModelUsed } from "@/lib/model-used";
import { parsePartialSheet, parseSheetOutput } from "@/lib/parse-partial-sheet";
import type { SectionBody, SourceCoverage } from "@/types/generated-sheet";

/**
 * A sheet's depth, on the client.
 *
 * Every sheet is written high-yield. Each section's comprehensive depth lives
 * beside its core under `<key>_more` — written with the sheet when it was
 * asked for comprehensive, or later, one section or the whole sheet at a time.
 * The high-yield view hides the depth; the comprehensive view shows it. The
 * contract is supabase/functions/_shared/sheet-section-prompts.ts.
 */

export type Depth = "highYield" | "comprehensive";

export const DEPTH_LABEL: Record<Depth, string> = { highYield: "High-yield", comprehensive: "Comprehensive" };

export const MORE_SUFFIX = "_more";
export const moreKey = (key: string) => `${key}${MORE_SUFFIX}`;
export const isMoreKey = (key: string) => key.endsWith(MORE_SUFFIX);
export const baseKey = (key: string) => (isMoreKey(key) ? key.slice(0, -MORE_SUFFIX.length) : key);

/**
 * The study aids, which get no depth when a whole sheet is deepened — the
 * server's STUDY_AIDS. One of them can still be deepened on its own.
 */
export const STUDY_AIDS: readonly string[] = ["keyPoints", "memoryHooks", "examTraps"];

/**
 * Whether a depth key holds a passage — paragraphs explaining its section, as
 * a textbook would — rather than more items of its section's kind. Every
 * content section's depth is one; a study aid's is more hooks, traps or
 * one-liners. The server's isPassage.
 */
export const isPassageKey = (key: string) => isMoreKey(key) && !STUDY_AIDS.includes(baseKey(key));

/** About how long a passage takes to read, in whole minutes, at a study pace. */
export const readingMinutes = (paragraphs: string[]) =>
  Math.max(1, Math.round(paragraphs.join(" ").split(/\s+/).filter(Boolean).length / 200));

/**
 * The depth a sheet was made at. Saved sheets from before depth carry a
 * length instead; only Detailed asked for more than a high-yield sheet.
 */
export function depthOf(value: string | null | undefined): Depth {
  return value === "comprehensive" || value === "Detailed" ? "comprehensive" : "highYield";
}

/** Whether a body has anything in it. */
export function hasBody(body: SectionBody | undefined): boolean {
  if (body === undefined) return false;
  return typeof body === "string" ? body.trim().length > 0 : body.length > 0;
}

/** The directions a rewrite can take, in menu order. */
export type RegenStyle = "simpler" | "clinical" | "mechanism" | "exam" | "custom";

export const REGEN_CHOICES: { style: Exclude<RegenStyle, "custom">; label: string; hint: string }[] = [
  { style: "simpler", label: "Simpler", hint: "Plainer words, same facts" },
  { style: "clinical", label: "More clinical", hint: "Tied to the patient and the decision" },
  { style: "mechanism", label: "More mechanism", hint: "The why behind each fact" },
  { style: "exam", label: "Sharper for the exam", hint: "Thresholds, discriminators, traps" },
];

export type SectionAction = "expandAll" | "expand" | "regenerate";

export interface SectionRequestParams {
  action: SectionAction;
  /** The section, except for expandAll. */
  key?: string;
  /** The sheet's planned section keys, in order. */
  plan: string[];
  /** The sheet's bodies as the student has them, cores and depth. */
  sections: Record<string, SectionBody>;
  topic: string;
  style?: RegenStyle;
  instruction?: string;
  /** regenerate: whether to write the section's depth too. */
  depth?: Depth;
  /** The ids of the passages the sheet was built on. */
  sourceIds: string[];
  /** The premium sheet's grant, for a student without Pro. */
  grant?: string;
  examMode?: string;
  difficulty?: string;
}

/** Today's section requests are used up (free and anonymous students). */
export class SectionQuotaError extends Error {
  constructor() {
    super("section_quota_exceeded");
    this.name = "SectionQuotaError";
  }
}

/**
 * The server predates section requests: it ignores the field and answers as a
 * sheet, opening with `__meta` frames a section reply never sends.
 */
export class SectionOutdatedError extends Error {
  constructor() {
    super("server_outdated");
    this.name = "SectionOutdatedError";
  }
}

export interface SectionDraft {
  /** Bodies so far, by key. */
  sections: Record<string, SectionBody>;
  /** Keys finished. */
  completeKeys: string[];
  /** The key still being written. */
  liveKey?: string;
}

export interface SectionResult {
  sections: Record<string, SectionBody>;
  /** expand / regenerate: whether the passages backed what was written. */
  covered: boolean | null;
  /** expandAll: the sheet's coverage shape, for the depth it wrote. */
  coverage: SourceCoverage | null;
  model: ModelUsed | null;
}

/**
 * Runs one section request, streaming drafts into `onDraft`, and resolves to
 * the finished bodies. Throws SectionQuotaError on a 429.
 */
export async function runSectionRequest(
  params: SectionRequestParams,
  opts: { signal?: AbortSignal; onDraft?: (draft: SectionDraft) => void } = {}
): Promise<SectionResult> {
  const { examMode, difficulty, ...section } = params;
  const response = await callMedicalNotes(
    { notes: params.topic, examMode, difficulty, useMemory: false, useGrounding: false, section },
    { signal: opts.signal }
  );
  if (response.status === 429) throw new SectionQuotaError();
  if (!response.ok || !response.body) throw new Error(`section request failed: ${response.status}`);
  const model = parseModelUsed(response.headers);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let parsed: { __meta?: unknown; choices?: { delta?: { content?: unknown } }[] } | null = null;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue; // a partial frame
      }
      if (parsed?.__meta) {
        reader.cancel().catch(() => {});
        throw new SectionOutdatedError();
      }
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta !== "string") continue;
      text += delta;
      const partial = parsePartialSheet(text);
      if (partial) {
        opts.onDraft?.({
          sections: partial.sheet.sections ?? {},
          completeKeys: partial.completeKeys,
          liveKey: partial.inFlightKey,
        });
      }
    }
  }

  const result = parseSheetOutput(text);
  const sections = result?.sheet.sections ?? {};
  if (!Object.values(sections).some(hasBody)) throw new Error("section request returned nothing");
  const covered = /"covered"\s*:\s*(true|false)/.exec(text)?.[1];
  return {
    sections,
    covered: covered === undefined ? null : covered === "true",
    coverage: result?.sheet.sourceCoverage ?? null,
    model,
  };
}

/**
 * The sheet's coverage once depth has been added: sections the depth was
 * written for without the passages' support join "uncovered". It can only
 * weaken the sheet's claim, never strengthen it.
 */
export function weakenCoverage(current: SourceCoverage | undefined, uncovered: string[]): SourceCoverage | undefined {
  const keys = [...new Set(uncovered.map(baseKey))];
  if (!keys.length || !current) return current;
  const merged = [...new Set([...current.uncovered, ...keys])];
  return { level: current.level === "full" ? "partial" : current.level, uncovered: merged };
}
