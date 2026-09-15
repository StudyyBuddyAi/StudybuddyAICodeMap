/**
 * Cache identity for generated sheet images.
 *
 * Keyed on the sheet topic plus a fixed view type (gross | histology |
 * cross-section | schematic) — never on free text the model writes. v1 keyed
 * on a model-written subject, which was reworded on every generation, so the
 * cache almost never hit. Topic wording still varies ("Brachial Plexus" vs
 * "Brachial plexus anatomy"), so generic words are dropped before hashing.
 *
 * The image prompt is built from exactly these two inputs, so an image stored
 * under a key can only ever be a drawing of that key.
 *
 * Dependency-free on purpose — imported by the edge functions (Deno), the
 * local dev harness and reachable from vitest.
 */

export const SHEET_IMAGE_KEY_VERSION = "v2";

export const IMAGE_VIEWS = ["gross", "histology", "cross-section", "schematic"] as const;
export type ImageView = (typeof IMAGE_VIEWS)[number];

export const isImageView = (v: unknown): v is ImageView =>
  typeof v === "string" && (IMAGE_VIEWS as readonly string[]).includes(v);

/** Case, accents, punctuation and spacing never make two keys differ. */
export function normalizeKeyPart(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Words that change how a topic is phrased, not what is drawn. The view is
 * already its own key part, so "anatomy" / "histology" in the topic add nothing.
 */
const TOPIC_FILLER = new Set([
  "a", "an", "the", "of", "and", "in", "to", "for",
  "anatomy", "anatomical", "histology", "histological", "structure", "structures",
  "overview", "normal", "basics", "introduction",
]);

export function normalizeTopicForKey(topic: string): string {
  return normalizeKeyPart(topic)
    .split(" ")
    .filter((word) => word && !TOPIC_FILLER.has(word))
    .join(" ");
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Parts are newline-joined — a separator normalization can never produce. */
export async function sheetImageCacheKey(topic: string, view: ImageView): Promise<string> {
  return sha256Hex(`${SHEET_IMAGE_KEY_VERSION}\n${normalizeTopicForKey(topic)}\n${view}`);
}

/** Two-character fan-out so no single storage folder grows unbounded. */
export function sheetImageStoragePath(cacheKey: string, extension: string): string {
  return `${SHEET_IMAGE_KEY_VERSION}/${cacheKey.slice(0, 2)}/${cacheKey}.${extension}`;
}
