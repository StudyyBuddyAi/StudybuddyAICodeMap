/**
 * sheet-visual — plans a finished study sheet's visual aids.
 *
 * Request:  POST { topic, overview, clinicalApproach, keyPoints }   (Authorization: Bearer <user JWT>)
 * Response: 200 { diagram | null, illustration | null, reason: { diagram, illustration } }
 *           The two are planned independently: a sheet may get both, one or neither.
 *           401 invalid_token · 400 invalid_request · 502 planner_unavailable
 *
 * Called by the client after the sheet stream ends, for every tier alike, so
 * the visual never depends on which model wrote the sheet. All planning logic
 * lives in _shared/sheet-visual-plan.ts. No quota: one ~2s gpt-oss-120b call
 * costs a fraction of a cent. A failure simply means the sheet has no visual.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import {
  cleanPlanInput,
  finalizeVisualPlan,
  requestVisualPlan,
  SHEET_VISUAL_MODEL,
} from "../_shared/sheet-visual-plan.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Metadata only — never the sheet text.
const log = (event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ fn: "sheet-visual", event, ...fields }));
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const startedAt = Date.now();

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "invalid_token" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return json({ error: "invalid_token" }, 401);

  const input = cleanPlanInput(await req.json().catch(() => null));
  if (!input) return json({ error: "invalid_request" }, 400);

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    log("missing_openrouter_key");
    return json({ error: "planner_unavailable" }, 502);
  }

  try {
    const result = finalizeVisualPlan(await requestVisualPlan(apiKey, input), input);
    log("planned", {
      userId: user.id,
      model: SHEET_VISUAL_MODEL,
      diagram: result.diagram?.kind ?? "none",
      illustration: result.illustration?.view ?? "none",
      reason: result.reason,
      elapsedMs: Date.now() - startedAt,
    });
    return json(result, 200);
  } catch (err: unknown) {
    log("planner_failed", {
      userId: user.id,
      err: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - startedAt,
    });
    return json({ error: "planner_unavailable" }, 502);
  }
});
