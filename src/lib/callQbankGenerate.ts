import { supabase } from "@/integrations/supabase/client";

const QBANK_GENERATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbank-generate`;

export interface QbankGenerateParams {
  /** Free text, exactly as the student typed it. Resolved to a system server-side. */
  topic: string;
  /**
   * Questions in THIS wave, not in the set. Defaults to 5 server-side and is
   * capped at 8 there — a set larger than one wave is several sequential calls.
   */
  count?: number;
  /**
   * Ties every question of one set together no matter which wave wrote it.
   * Required: it is what claim_generated_questions looks rows up by, so a
   * question generated without one could never reach a session.
   */
  generationId: string;
  /**
   * The system the first wave resolved to, echoed back on every wave after it.
   * Skips the router call and — the real reason — stops wave three being written
   * against a different System Brief than wave one.
   */
  system?: string;
  /** 1-based index of this wave's first question within the set. */
  startIndex?: number;
  /** Subtopics the set has already covered. The prompt's duplication guard. */
  avoidSubtopics?: string[];
  /**
   * How hard the student asked for. Shifts the reasoning-order mix the batch
   * plan imposes; unknown values fall back to "balanced" server-side. Echoed on
   * every wave so a set does not change character halfway through.
   */
  challenge?: string;
  /**
   * Which exam the set is for: "step1" | "step2ck" | "mixed". Selects the
   * system prompt and briefs server-side; unknown values fall back to "step1".
   * Echoed on every wave, as `challenge` is.
   */
  examMode?: string;
}

export interface CallQbankGenerateOptions {
  /** Forwarded to fetch, so a cancelled or superseded run stops the wave. */
  signal?: AbortSignal;
}

/**
 * Single entry point for the `qbank-generate` edge function.
 *
 * Mirrors callMedicalNotes: reads the current Supabase session and attaches the
 * user's access token as the `Authorization` bearer (replacing the publishable
 * key), and returns the raw streaming `Response` so the caller keeps its own
 * SSE-reading logic. The Corti credentials never leave the edge function.
 *
 * One call is one wave. The loop that turns waves into a set of twenty lives in
 * src/lib/qbank-wave-runner.ts.
 */
export async function callQbankGenerate(
  params: QbankGenerateParams,
  options: CallQbankGenerateOptions = {}
): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? "";

  return fetch(QBANK_GENERATE_URL, {
    method: "POST",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(params),
  });
}
