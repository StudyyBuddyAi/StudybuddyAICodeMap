import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { validateTopic } from "../_shared/validate-topic.ts";

/**
 * Finds published anatomical illustrations for a study topic.
 *
 * Embeds the topic and runs a pgvector cosine search over anatomy_images. No
 * model completion, so this is fast and cheap — the prose comes later, one
 * structure at a time, from anatomy-explain.
 *
 * An empty list is the expected result for most topics, not an error. Showing
 * nothing is always better than showing the wrong organ, which is what the
 * similarity floor in match_anatomy exists to enforce.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ fn: "anatomy-match", event, ...fields }));
};

const BUCKET = "anatomy";
const EMBEDDING_MODEL = "text-embedding-3-small";
const MATCH_COUNT = 3;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface MatchRow {
  id: string;
  title: string;
  labels: string[] | null;
  aspect_ratio: number | null;
  storage_path: string;
  attribution: string | null;
  source_url: string | null;
  similarity: number;
}

const normalise = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Words that recur across unrelated curriculum titles and so carry no signal.
 * Without this, "Management" alone would tie a topic to a random system.
 */
const STOPWORDS = new Set([
  "and", "the", "of", "in", "a", "to", "with", "system", "disease", "disorders",
  "disorder", "management", "acute", "chronic", "syndrome", "other", "related",
  "care", "approach", "primary", "secondary",
]);

const tokens = (value: string) =>
  normalise(value).split(" ").filter((w) => w.length > 2 && !STOPWORDS.has(w));

/**
 * Sheet topic -> organ system, using curriculum_topics as the lookup table.
 *
 * Disease names embed poorly against lists of anatomical structures: measured
 * on the first corpus, "Asthma" scored 0.272 against the respiratory diagram
 * and "Diabetic ketoacidosis" 0.224 — correct organ, far below any floor that
 * is safe to set. The curriculum already maps its topics to 13 systems by
 * hand, so this resolves deterministically instead of guessing.
 *
 * Three strategies, strongest first. Containment alone is not enough:
 * "Community-Acquired Pneumonia" and "Pneumonia — Community, Hospital &
 * Atypical" share their words in a different order, so token overlap catches
 * what substring matching misses.
 *
 * Measured over the whole curriculum: 183/183 titles resolve to their own
 * system, with no false positives on non-medical control topics.
 *
 * Returns null when nothing matches, and the caller falls back to similarity.
 */
function resolveSystem(
  topic: string,
  rows: { title: string; system: string }[]
): string | null {
  const wanted = normalise(topic);
  if (wanted.length < 3) return null;
  const wantedTokens = new Set(tokens(topic));

  let best: { system: string; score: number; length: number } | null = null;
  const consider = (system: string, score: number, length: number) => {
    if (!best || score > best.score || (score === best.score && length > best.length)) {
      best = { system, score, length };
    }
  };

  for (const row of rows) {
    const title = normalise(row.title);
    if (!title) continue;

    if (title === wanted) {
      consider(row.system, 2, title.length);
      continue;
    }
    // A 4-character floor: shorter titles match almost anything containing them.
    if (
      (title.length >= 4 && wanted.includes(title)) ||
      (wanted.length >= 4 && title.includes(wanted))
    ) {
      consider(row.system, 1.5, title.length);
      continue;
    }

    const titleTokens = tokens(row.title);
    if (!titleTokens.length || !wantedTokens.size) continue;
    const shared = titleTokens.filter((t) => wantedTokens.has(t)).length;
    // Half the shorter side must overlap, so one incidental word is not enough.
    const overlap = shared / Math.min(titleTokens.length, wantedTokens.size);
    if (shared >= 1 && overlap >= 0.5) consider(row.system, overlap, title.length);
  }

  return best?.system ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "invalid_token" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const db = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) return json({ error: "invalid_token" }, 401);

    const { topic } = await req.json();
    if (typeof topic !== "string" || validateTopic(topic)) {
      // Structurally unusable input. Same gate the sheet uses, before any spend.
      return json({ images: [] });
    }

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

    const embedRes = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: topic.trim() }),
    });
    if (!embedRes.ok) {
      log("embed_failed", { status: embedRes.status });
      // Fail soft: the sheet must never break because anatomy could not match.
      return json({ images: [] });
    }

    const embedding = (await embedRes.json())?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) return json({ images: [] });

    // Stage 1: resolve the topic to an organ system, deterministically.
    const { data: curriculum } = await db
      .from("curriculum_topics")
      .select("title,system")
      .eq("is_active", true);
    const system = resolveSystem(topic, curriculum ?? []);

    // Stage 2: images for that system, ordered by similarity and with no
    // floor — the system match already establishes relevance. With no system,
    // similarity alone decides and the floor applies.
    const { data, error } = await db.rpc("match_anatomy", {
      query_embedding: embedding,
      match_count: MATCH_COUNT,
      filter_system: system,
    });
    if (error) {
      log("match_failed", { error: error.message });
      return json({ images: [] });
    }

    const rows = (data ?? []) as MatchRow[];
    const images = rows.map((row) => ({
      id: row.id,
      title: row.title,
      labels: row.labels ?? [],
      // Camel-cased for the client, which uses it to reserve the image's box.
      aspectRatio: row.aspect_ratio === null ? null : Number(row.aspect_ratio),
      url: db.storage.from(BUCKET).getPublicUrl(row.storage_path).data.publicUrl,
      attribution: row.attribution,
      sourceUrl: row.source_url,
      similarity: row.similarity,
    }));

    log("matched", {
      count: images.length,
      system: system ?? "(similarity only)",
      elapsedMs: Date.now() - startedAt,
    });
    return json({ images });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log("error", { error: message, elapsedMs: Date.now() - startedAt });
    // Still a soft failure for the client: no diagram, not a broken sheet.
    return json({ images: [], error: message }, 200);
  }
});
