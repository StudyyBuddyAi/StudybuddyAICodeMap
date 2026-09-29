import { parseSignature, type SheetSignature } from "./sheet-signature";
import { callMedicalNotes } from "@/lib/callMedicalNotes";
import { parseModelUsed, type ModelUsed } from "@/lib/model-used";
import { parsePartialSheet, parseSheetOutput } from "@/lib/parse-partial-sheet";
import type { SectionBody } from "@/types/generated-sheet";

/**
 * A sheet's depth, and rewrites of one of its sections, on the client.
 *
 * Every sheet is written high-yield. A comprehensive sheet is the same sheet
 * with its most useful branches grown (src/lib/sheet-branches.ts). A section
 * can be rewritten in a direction the student picks; the contract is
 * supabase/functions/_shared/sheet-section-prompts.ts.
 */

export type Depth = "highYield" | "comprehensive";

export const DEPTH_LABEL: Record<Depth, string> = { highYield: "High-yield", comprehensive: "Comprehensive" };

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

export interface SectionRequestParams {
  action: "regenerate";
  /** The section to rewrite. */
  key: string;
  /** The sheet's planned section keys, in order. */
  plan: string[];
  /** The sheet's bodies as the student has them. */
  sections: Record<string, SectionBody>;
  topic: string;
  style: RegenStyle;
  instruction?: string;
  /** The ids of the passages the sheet was built on. */
  sourceIds: string[];
  /** The premium sheet's grant, for a student without Pro. */
  grant?: string;
  /** The sheet's signatures, for the server to check the sheet is the one it wrote. */
  signature: SheetSignature | null;
  examMode?: string;
  difficulty?: string;
}

/** Today's section rewrites are used up (free and anonymous students). */
export class SectionQuotaError extends Error {
  constructor() {
    super("section_quota_exceeded");
    this.name = "SectionQuotaError";
  }
}

/**
 * The server predates section requests: it ignores the field and answers as a
 * sheet, opening with the plan and the model — `__meta` frames a section reply
 * never sends. (A section reply's only frame is its signature, at the end.)
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
  /** The server's signatures on the rewritten bodies, by key; empty when it signed nothing. */
  sigs: Record<string, string>;
  /** Whether the passages backed what was written. */
  covered: boolean | null;
  model: ModelUsed | null;
}

/**
 * Runs one rewrite, streaming drafts into `onDraft`, and resolves to the
 * finished bodies. Throws SectionQuotaError on a 429.
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
  let sigs: Record<string, string> = {};
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
      let parsed: { __meta?: Record<string, unknown>; choices?: { delta?: { content?: unknown } }[] } | null = null;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue; // a partial frame
      }
      if (parsed?.__meta) {
        const meta = parsed.__meta;
        if ("plan" in meta || "model" in meta) {
          reader.cancel().catch(() => {});
          throw new SectionOutdatedError();
        }
        const signature = parseSignature(meta.signature);
        if (signature) sigs = signature.sections;
        continue;
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
    sigs,
    covered: covered === undefined ? null : covered === "true",
    model,
  };
}
