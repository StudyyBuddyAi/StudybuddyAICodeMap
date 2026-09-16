import { supabase } from "@/integrations/supabase/client";
import { parseIllustration, parseSheetVisual } from "@/lib/parse-sheet-visual";
import type { GeneratedSheet, IllustrationSpec, VisualSpec } from "@/types/generated-sheet";

// VITE_LOCAL_FUNCTIONS=1: the dev server's stand-in (scripts/local-functions/vite-plugin.ts).
const FN_URL =
  import.meta.env.DEV && import.meta.env.VITE_LOCAL_FUNCTIONS === "1"
    ? "/__local-fns/sheet-visual"
    : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sheet-visual`;

/** Long enough for a slow provider, short enough that a stuck call never holds Save disabled. */
const PLAN_TIMEOUT_MS = 30_000;

/** A sheet worth planning a visual for: it has the sections the planner reads. */
export function canPlanVisual(sheet: GeneratedSheet): boolean {
  return !!(sheet.overview?.trim() || sheet.clinicalApproach?.trim());
}

/** What the sheet gets: either half may be absent, and both are absent on failure. */
export interface SheetVisualPlan {
  diagram?: VisualSpec;
  illustration?: IllustrationSpec;
}

/**
 * Plans the finished sheet's diagram and illustration in one call. Resolves
 * with an empty plan when the planner chose neither, rejected them, or was
 * unreachable — the sheet is complete without visuals, so no failure here is
 * surfaced as an error.
 */
export async function planSheetVisual(sheet: GeneratedSheet, fallbackTopic: string): Promise<SheetVisualPlan> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLAN_TIMEOUT_MS);
  try {
    const res = await fetch(FN_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({
        topic: (sheet.topic || fallbackTopic).slice(0, 120),
        overview: sheet.overview,
        clinicalApproach: sheet.clinicalApproach,
        keyPoints: sheet.keyPoints,
      }),
    });
    if (!res.ok) return {};
    const body = await res.json().catch(() => null);
    // Validated again client-side: the renderer only ever sees a known-good shape.
    return {
      diagram: parseSheetVisual(body?.diagram),
      illustration: parseIllustration(body?.illustration),
    };
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}
