import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

/**
 * Explains one labelled structure on one anatomical illustration.
 *
 * Deliberately takes no topic. Explanations are cached on (diagram, part), and
 * a topic in the prompt with no topic in the key would serve one student's
 * answer to another. Anatomy is topic-independent anyway — the left ventricle
 * does the same thing on every sheet.
 *
 * Quota-exempt, matching the existing explain/enhance paths in medical-notes.
 * This is the first call whose cost scales with engagement rather than with
 * generations, so caching and gating are the next step.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ fn: "anatomy-explain", event, ...fields }));
};

/** Matches FIGURE_LIMITS.label; a real structure name is never longer. */
const PART_MAX = 80;
const DIAGRAM_MAX = 120;

const MODEL = "openai/gpt-oss-20b";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "invalid_token" }, 401);

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) return json({ error: "invalid_token" }, 401);

    const { diagram, part } = await req.json();

    // Reject rather than coerce: the label reaches us from text extraction or
    // the student's own typing, so it is untrusted input like any other.
    const cleanPart = typeof part === "string" ? part.trim() : "";
    const cleanDiagram = typeof diagram === "string" ? diagram.trim() : "";
    if (!cleanPart || cleanPart.length > PART_MAX) return json({ error: "invalid_part" }, 400);
    if (!cleanDiagram || cleanDiagram.length > DIAGRAM_MAX) {
      return json({ error: "invalid_diagram" }, 400);
    }

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

    // The last instruction matters: a label can be noise, and a model that
    // guesses at noise produces confident nonsense.
    const systemPrompt = `You are explaining an anatomical structure to a medical student.

Write 3-4 sentences: what it is, what it does, and why it matters clinically.
Plain prose, no headings, no lists, no markdown.
If the structure name is unclear or not anatomical, say so in one sentence
instead of guessing.`;

    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        max_tokens: 400,
        provider: { order: ["Cerebras", "Groq"], allow_fallbacks: true },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Diagram: ${cleanDiagram}\nStructure: ${cleanPart}` },
        ],
      }),
    });

    if (!upstream.ok) {
      log("upstream_failed", { status: upstream.status });
      return json({ error: "upstream_failed" }, 502);
    }

    const body = await upstream.json();
    const text: string = body?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return json({ error: "empty_completion" }, 502);

    log("explained", { model: MODEL, elapsedMs: Date.now() - startedAt });
    return json({ text });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log("error", { error: message, elapsedMs: Date.now() - startedAt });
    return json({ error: message }, 500);
  }
});
