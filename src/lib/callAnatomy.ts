import { supabase } from "@/integrations/supabase/client";

/**
 * Client for the anatomy edge functions.
 *
 * Mirrors src/lib/callMedicalNotes.ts rather than using
 * `supabase.functions.invoke`: the house pattern reads the session and attaches
 * the access token explicitly, and nothing in this codebase uses `invoke`.
 */

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * One tappable structure on an illustration, extracted at ingest by following
 * the drawing's own leader lines. Coordinates are 0-1 of the viewBox, so they
 * hold at any rendered size.
 */
export interface AnatomyRegion {
  label: string;
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  /** Only "leader" anchors sit on the structure; "label" ones sit in the margin. */
  confidence: "leader" | "label";
}

export interface AnatomyImage {
  id: string;
  title: string;
  labels: string[];
  regions?: AnatomyRegion[];
  url: string;
  /** width / height, captured at ingest. Null for rasters — caller falls back. */
  aspectRatio?: number | null;
  attribution?: string | null;
  sourceUrl?: string | null;
}

async function post<T>(fn: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const response = await fetch(`${BASE}/${fn}`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`${fn} failed: ${response.status}`);
  return (await response.json()) as T;
}

/** Topic → up to three matching diagrams. An empty list is the normal no-match result. */
export const callAnatomyMatch = (topic: string, signal?: AbortSignal) =>
  post<{ images: AnatomyImage[] }>("anatomy-match", { topic }, signal);

/**
 * One structure's explanation.
 *
 * Deliberately takes no topic: explanations are cached on (diagram, part), and a
 * topic in the prompt with no topic in the key would serve one student's answer
 * to another. See the plan, §4.
 */
export const callAnatomyExplain = (
  params: { diagram: string; part: string },
  signal?: AbortSignal
) => post<{ text: string }>("anatomy-explain", params, signal);
