/**
 * The image half of generate-sheet-image: request validation, the prompt, the
 * OpenRouter call and reading the image back out of its response.
 *
 * Kept free of Deno globals and URL imports so the same code runs in the edge
 * function and in the local dev harness (scripts/local-functions) — checking a
 * generation locally exercises exactly what production sends.
 */

const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
/** "Nano Banana 2". Closest to expert references in published anatomical-fidelity comparisons; still imperfect. */
export const SHEET_IMAGE_MODEL = "google/gemini-3.1-flash-image";

export const TOPIC_MAX = 120;
/** Mirrors VISUAL_LIMITS.imageSubjectMax in src/lib/parse-sheet-visual.ts. */
export const SUBJECT_MAX = 100;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const GENERATION_TIMEOUT_MS = 90_000;

export type ImageLog = (event: string, fields?: Record<string, unknown>) => void;

/** One line, bounded — these are interpolated into the prompt as data. */
export function cleanField(v: unknown, max: number): string | null {
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

export function buildImagePrompt(topic: string, subject: string): string {
  return `Create an accurate, labeled medical textbook illustration.

Subject: ${subject}
Context: a study sheet on ${topic}

Requirements:
- Draw the anatomically correct structures that define the subject, in the view it names; if no view is named, use the standard textbook view.
- Label the key structures a medical student is examined on, using thin leader lines and short, correctly spelled English labels in a clean sans-serif font.
- Flat scientific illustration style on a plain white background, restrained colors, accurate proportions and spatial relationships.
- No title text, no decorative elements, no photographs, no watermark, no faces, no gore.`;
}

export type ImageFormat = { contentType: string; extension: string };

/** From the bytes themselves — the provider's declared type is not trusted. */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
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
 */
export async function generateImage(
  apiKey: string,
  prompt: string,
  log: ImageLog = () => {}
): Promise<{ bytes: Uint8Array; via: "images" | "chat" }> {
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
      if (typeof item?.b64_json === "string" && item.b64_json) {
        return { bytes: base64ToBytes(item.b64_json), via: "images" };
      }
      const fromUrl = await imageFromUrl(item?.url, controller.signal);
      if (fromUrl) return { bytes: fromUrl, via: "images" };
      throw new Error("no_image_in_images_response");
    }

    // Rate limits and provider outages are not a reason to try another shape.
    if (![400, 404, 405, 422].includes(res.status)) {
      const body = await res.text().catch(() => "");
      throw new Error(`openrouter_images_${res.status}: ${body.slice(0, 300)}`);
    }
    log("images_endpoint_rejected", { status: res.status, body: (await res.text().catch(() => "")).slice(0, 300) });

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
    if (fromChat) return { bytes: fromChat, via: "chat" };
    throw new Error("no_image_in_chat_response");
  } finally {
    clearTimeout(timer);
  }
}
