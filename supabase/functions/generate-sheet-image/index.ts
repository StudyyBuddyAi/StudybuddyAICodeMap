/**
 * generate-sheet-image — the opt-in image for a study sheet's `image` visual.
 *
 * Request:  POST { topic, view }   view: gross | histology | cross-section | schematic   (Authorization: Bearer <user JWT>)
 * Response: 200 { url, provider, generatedAt, cached }
 *           401 invalid_token · 400 invalid_request · 429 quota_exceeded · 502 image_unavailable
 *
 * The image prompt is built HERE from topic + view only — never taken from
 * the client. Those two values are also the cache key, and images are shared
 * across students, so a client-supplied prompt would let one user plant any
 * picture under a key other students hit. This way an image cached under a
 * key can only ever be a drawing of that key.
 *
 * Order of work: cache hit (free, no quota) → entitlement/quota → generate →
 * store → index. Any failure after quota is consumed refunds it. The sheet
 * never depends on this call; the client shows "visual unavailable".
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { isImageView, sheetImageCacheKey, sheetImageStoragePath } from "../_shared/sheet-image-key.ts";
import {
  buildImagePrompt,
  cleanField,
  generateImage,
  MAX_IMAGE_BYTES,
  SHEET_IMAGE_MODEL,
  sniffImageFormat,
  TOPIC_MAX,
} from "../_shared/sheet-image-generate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BUCKET = "sheet-visuals";

/** Free and anonymous users; Pro is uncapped. Cache hits never count. */
const SHEET_IMAGE_DAILY_CAP = 3;
const USAGE_KIND = "sheet_image";

const log = (event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ fn: "generate-sheet-image", event, ...fields }));
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

  // ── JWT verification (same shape as medical-notes) ──────────────────────
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "invalid_token" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return json({ error: "invalid_token" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const topic = cleanField(body.topic, TOPIC_MAX);
  const view = body.view;
  if (!topic || !isImageView(view)) return json({ error: "invalid_request" }, 400);

  const cacheKey = await sheetImageCacheKey(topic, view);
  const publicUrl = (path: string) => admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  // ── Cache: free for everyone, no quota ──────────────────────────────────
  const { data: existing, error: lookupError } = await admin
    .from("sheet_visual_images")
    .select("storage_path, model, created_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (lookupError) log("cache_lookup_failed", { err: lookupError.message });
  if (existing) {
    log("cache_hit", { userId: user.id, elapsedMs: Date.now() - startedAt });
    return json(
      {
        url: publicUrl(existing.storage_path),
        provider: `openrouter/${existing.model}`,
        generatedAt: existing.created_at,
        cached: true,
      },
      200
    );
  }

  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!OPENROUTER_API_KEY) {
    log("missing_openrouter_key");
    return json({ error: "image_unavailable" }, 502);
  }

  // ── Entitlement + quota ─────────────────────────────────────────────────
  const { data: profile } = await admin
    .from("profiles")
    .select("is_pro, pro_expires_at")
    .eq("id", user.id)
    .maybeSingle();
  const isProUser =
    profile?.is_pro === true &&
    (profile.pro_expires_at === null || new Date(profile.pro_expires_at) > new Date());

  let quotaConsumed = false;
  if (!isProUser) {
    const { data, error } = await admin.rpc("consume_usage", {
      p_user: user.id,
      p_kind: USAGE_KIND,
      p_cap: SHEET_IMAGE_DAILY_CAP,
    });
    if (error) {
      log("consume_usage_failed", { err: error.message });
      return json({ error: "quota_check_failed" }, 500);
    }
    if (!data?.allowed) return json({ error: "quota_exceeded", cap: SHEET_IMAGE_DAILY_CAP }, 429);
    quotaConsumed = true;
  }
  const refund = async () => {
    if (!quotaConsumed) return;
    try {
      await admin.rpc("refund_usage", { p_user: user.id, p_kind: USAGE_KIND });
    } catch { /* best effort */ }
  };

  // ── Generate → store → index ────────────────────────────────────────────
  const prompt = buildImagePrompt(topic, view);
  try {
    const { bytes, via } = await generateImage(OPENROUTER_API_KEY, prompt, log);
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`image_too_large_${bytes.length}`);
    const format = sniffImageFormat(bytes);
    if (!format) throw new Error("unrecognized_image_format");

    const storagePath = sheetImageStoragePath(cacheKey, format.extension);
    const upload = await admin.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: format.contentType,
      cacheControl: "31536000",
      // An object can already sit here if an earlier request stored it and
      // then failed to write the index row; the new copy replaces that orphan.
      upsert: true,
    });
    if (upload.error) throw new Error(`upload_failed: ${upload.error.message}`);

    const generatedAt = new Date().toISOString();
    // Two students can miss the cache at the same moment; the first row wins
    // and both images are equally valid drawings of the key.
    const { error: indexError } = await admin.from("sheet_visual_images").upsert(
      {
        cache_key: cacheKey,
        storage_path: storagePath,
        topic,
        image_view: view,
        prompt,
        model: SHEET_IMAGE_MODEL,
        created_by: user.id,
        created_at: generatedAt,
      },
      { onConflict: "cache_key", ignoreDuplicates: true }
    );
    if (indexError) log("index_write_failed", { err: indexError.message });

    log("generated", {
      userId: user.id,
      isProUser,
      via,
      bytes: bytes.length,
      format: format.extension,
      elapsedMs: Date.now() - startedAt,
    });
    return json(
      {
        url: publicUrl(storagePath),
        provider: `openrouter/${SHEET_IMAGE_MODEL}`,
        generatedAt,
        cached: false,
      },
      200
    );
  } catch (err: unknown) {
    await refund();
    log("generation_failed", {
      userId: user.id,
      err: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - startedAt,
    });
    return json({ error: "image_unavailable" }, 502);
  }
});
