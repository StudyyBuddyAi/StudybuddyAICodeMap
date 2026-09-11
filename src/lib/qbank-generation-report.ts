import { supabase } from "@/integrations/supabase/client";
import type { ChallengeLevel } from "./qbank-types";

/**
 * What happened while a set was written.
 *
 * Every generated row already carried its QA findings, its blocked flag and the
 * cold-answering pass's verdict on `generation_meta`, and nothing ever read
 * them back — the findings existed only to be discarded. get_generation_report
 * aggregates them per generation so a finished set can say what it cost to
 * reach the questions the student actually sat.
 *
 * Counts only, and deliberately: naming WHICH question was held back would tell
 * a student something about an item they may not have answered yet, and the
 * findings' own detail strings quote the offending text. The rule slugs map to
 * student-safe labels through src/lib/qbank-rule-labels.ts.
 */
export interface GenerationReport {
  /** Every row this generation wrote, admitted or not. */
  written: number;
  /** Rows that passed both filters and were eligible for the session. */
  admitted: number;
  /** Held back by the QA gate. */
  blocked: number;
  /** Held back because the blind second read disagreed with the key. */
  disputed: number;
  /** Items the writer said would be clearer with a figure. */
  wants_image: number;
  /** The level asked for; null for a set written before the control existed. */
  challenge: ChallengeLevel | null;
  /** Reasoning order of the admitted questions, keyed "1st" | "2nd" | "3rd". */
  reasoning_mix: Record<string, number>;
  /** Rule slug → how many times it fired, across every row written. */
  findings: Record<string, number>;
}

/**
 * Returns null rather than throwing. The report is a footnote on a screen whose
 * job is to show a score — a set that cannot report on itself must not take the
 * summary down with it.
 */
export async function fetchGenerationReport(
  generationId: string
): Promise<GenerationReport | null> {
  const { data, error } = await supabase.rpc("get_generation_report", {
    p_generation_id: generationId,
  });

  if (error || !data) {
    if (error) console.error("get_generation_report failed:", error);
    return null;
  }

  const raw = data as Partial<GenerationReport>;
  return {
    written: raw.written ?? 0,
    admitted: raw.admitted ?? 0,
    blocked: raw.blocked ?? 0,
    disputed: raw.disputed ?? 0,
    wants_image: raw.wants_image ?? 0,
    challenge: raw.challenge ?? null,
    reasoning_mix: raw.reasoning_mix ?? {},
    findings: raw.findings ?? {},
  };
}
