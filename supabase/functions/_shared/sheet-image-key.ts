/**
 * Cache identity for generated sheet images.
 *
 * Keyed on what is drawn, not on the exact prompt: the sheet writer rewords
 * `imagePrompt` on every generation, so a prompt hash would almost never hit
 * and every student would pay for their own copy. Topic + a short canonical
 * subject ("nephron cross-section") lets two students studying the same thing
 * share one image, while a different subject on the same topic (histology vs
 * gross anatomy) still gets its own.
 *
 * Dependency-free on purpose — imported by the edge function (Deno) and
 * reachable from vitest.
 */

export const SHEET_IMAGE_KEY_VERSION = "v1";

/** Case, accents, punctuation and spacing never make two keys differ. */
export function normalizeKeyPart(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The parts are joined with a separator normalization can never produce (a
 * newline), so ("heart", "failure x") and ("heart failure", "x") stay distinct.
 */
export async function sheetImageCacheKey(topic: string, subject: string): Promise<string> {
  return sha256Hex(`${SHEET_IMAGE_KEY_VERSION}\n${normalizeKeyPart(topic)}\n${normalizeKeyPart(subject)}`);
}

/** Two-character fan-out so no single storage folder grows unbounded. */
export function sheetImageStoragePath(cacheKey: string, extension: string): string {
  return `${SHEET_IMAGE_KEY_VERSION}/${cacheKey.slice(0, 2)}/${cacheKey}.${extension}`;
}
