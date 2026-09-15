/**
 * generate-sheet-image — the opt-in image for a study sheet's `image` visual.
 *
 * Request:  POST { topic, subject }   (Authorization: Bearer <user JWT>)
 * Response: 200 { url, provider, generatedAt, cached }
 *           401 invalid_token · 400 invalid_request · 429 quota_exceeded · 502 image_unavailable
 *
 * The image prompt is built HERE from topic + subject only — never taken from
 * the client. Those two strings are also the cache key, and images are shared
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
import { sheetImageCacheKey, sheetImageStoragePath } from "../_shared/sheet-image-key.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
/** "Nano Banana 2". Closest to expert references in published anatomical-fidelity comparisons; still imperfect. */
const SHEET_IMAGE_MODEL = "google/gemini-3.1-flash-image";
const BUCKET = "sheet-visuals";

/** Free and anonymous users; Pro is uncapped. Cache hits never count. */
const SHEET_IMAGE_DAILY_CAP = 3;
const USAGE_KIND = "sheet_image";

const TOPIC_MAX = 120;
/** Mirrors VISUAL_LIMITS.imageSubjectMax in src/lib/parse-sheet-visual.ts. */
const SUBJECT_MAX = 100;
const GENERATION_TIMEOUT_MS = 90_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const log = (event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ fn: "generate-sheet-image", event, ...fields }));
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** One line, bounded — these are interpolated into the prompt as data. */
function cleanField(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // Control characters (newlines included) become spaces, so a field can't
  // start a new line of instructions inside the prompt.
  const text = Array.from(v, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 ? " " : ch;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return text && text.length <= max ? text : null;
}

function buildImagePrompt(topic: string, subject: string): string {
  return `Create an accurate, labeled medical textbook illustration.

Subject: ${subject}
Context: a study sheet on ${topic}

Requirements:
- Draw the anatomically correct structures that define the subject, in the view it names; if no view is named, use the standard textbook view.
- Label the key structures a medical student is examined on, using thin leader lines and short, correctly spelled English labels in a clean sans-serif font.
- Flat scientific illustration style on a plain white background, restrained colors, accurate proportions and spatial relationships.
- No title text, no decorative elements, no photographs, no watermark, no faces, no gore.`;
}

type ImageFormat = { contentType: string; extension: string };

/** From the bytes themselves — the provider's declared type is not trusted. */
function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { contentType: "image/png", extension: "png" };
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length > 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }
  return null;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/^data:[^,]*,/, "").replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function imageFromUrl(url: unknown, signal: AbortSignal): Promise<Uint8Array | null> {
  if (typeof url !== "string") return null;
  if (url.startsWith("data:")) return base64ToBytes(url);
  if (url.startsWith("https://")) {
    const img = await fetch(url, { signal });
    if (!img.ok) throw new Error(`image_fetch_${img.status}`);
    return new Uint8Array(await img.arrayBuffer());
  }
  return null;
}

/**
 * Calls OpenRouter and returns the raw image bytes.
 *
 * Primary path is the dedicated Image API (`/api/v1/images`, image in
 * `data[0].b64_json` or `data[0].url`). If that endpoint rejects the request
 * outright, falls back to chat completions with `modalities: ["image","text"]`,
 * where Gemini image models return `choices[0].message.images[].image_url.url`.
 * Neither could be exercised against the live API when this was written — see
 * the PR notes.
 */
async function generateImage(apiKey: string, prompt: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
    "HTTP-Referer": "https://studybuddy.app",
    "X-Title": "StudyBuddy",
  };
  try {
    const res = await fetch(OPENROUTER_IMAGES_URL, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({ model: SHEET_IMAGE_MODEL, prompt, n: 1, aspect_ratio: "4:3", resolution: "1K" }),
    });

    if (res.ok) {
      const item = (await res.json())?.data?.[0];
      if (typeof item?.b64_json === "string" && item.b64_json) return base64ToBytes(item.b64_json);
      const fromUrl = await imageFromUrl(item?.url, controller.signal);
      if (fromUrl) return fromUrl;
      throw new Error("no_image_in_images_response");
    }

    // Rate limits and provider outages are not a reason to try another shape.
    if (![400, 404, 405, 422].includes(res.status)) {
      const body = await res.text().catch(() => "");
      throw new Error(`openrouter_images_${res.status}: ${body.slice(0, 300)}`);
    }
    log("images_endpoint_rejected", { status: res.status });

    const chat = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        model: SHEET_IMAGE_MODEL,
        modalities: ["image", "text"],
        image_config: { aspect_ratio: "4:3" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!chat.ok) {
      const body = await chat.text().catch(() => "");
      throw new Error(`openrouter_chat_${chat.status}: ${body.slice(0, 300)}`);
    }
    const message = (await chat.json())?.choices?.[0]?.message;
    const fromChat = await imageFromUrl(message?.images?.[0]?.image_url?.url, controller.signal);
    if (fromChat) return fromChat;
    throw new Error("no_image_in_chat_response");
  } finally {
    clearTimeout(timer);
  }
}

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
  const subject = cleanField(body.subject, SUBJECT_MAX);
  if (!topic || !subject) return json({ error: "invalid_request" }, 400);

  const cacheKey = await sheetImageCacheKey(topic, subject);
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
  const prompt = buildImagePrompt(topic, subject);
  try {
    const bytes = await generateImage(OPENROUTER_API_KEY, prompt);
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
        subject,
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
