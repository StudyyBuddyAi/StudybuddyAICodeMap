import { supabase } from "@/integrations/supabase/client";
import type { ImageView, VisualImageResult } from "@/types/generated-sheet";

// VITE_LOCAL_FUNCTIONS=1: the dev server's stand-in, which stores images under
// .local/ and serves them itself (scripts/local-functions/vite-plugin.ts).
const LOCAL_FUNCTIONS = import.meta.env.DEV && import.meta.env.VITE_LOCAL_FUNCTIONS === "1";
const FN_URL = LOCAL_FUNCTIONS
  ? "/__local-fns/generate-sheet-image"
  : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-sheet-image`;
const PUBLIC_BUCKET_PREFIX = LOCAL_FUNCTIONS
  ? "/__local-fns/sheet-visuals/"
  : `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/sheet-visuals/`;

export type SheetImageErrorCode = "quota_exceeded" | "unavailable";

export class SheetImageError extends Error {
  constructor(readonly code: SheetImageErrorCode, readonly cap?: number) {
    super(code);
    this.name = "SheetImageError";
  }
}

export interface SheetImageRequest {
  /** Sheet topic — with `view`, the whole request and the shared cache key. */
  topic: string;
  view: ImageView;
}

export type SheetImageRequester = (req: SheetImageRequest) => Promise<VisualImageResult>;

/**
 * Asks generate-sheet-image for the illustration. Resolves with the stored
 * image (possibly a cached one another student already generated); rejects with
 * a SheetImageError the UI can phrase without breaking the sheet.
 */
export const requestSheetImage: SheetImageRequester = async ({ topic, view }) => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  let res: Response;
  try {
    res = await fetch(FN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ topic: topic.slice(0, 120), view }),
    });
  } catch {
    throw new SheetImageError("unavailable");
  }

  const body = await res.json().catch(() => ({}));
  if (res.status === 429 && body?.error === "quota_exceeded") {
    throw new SheetImageError("quota_exceeded", typeof body.cap === "number" ? body.cap : undefined);
  }
  if (!res.ok || typeof body?.url !== "string" || !isTrustedVisualImageUrl(body.url)) {
    throw new SheetImageError("unavailable");
  }
  return {
    url: body.url,
    provider: typeof body.provider === "string" ? body.provider : "unknown",
    generatedAt: typeof body.generatedAt === "string" ? body.generatedAt : new Date().toISOString(),
  };
};

/**
 * Only our own bucket (or an inline image) is ever put in an <img>. Saved
 * sheets are JSON the client wrote, but this keeps a hand-edited or otherwise
 * damaged row from loading an arbitrary third-party URL.
 */
export function isTrustedVisualImageUrl(url: string): boolean {
  return url.startsWith(PUBLIC_BUCKET_PREFIX) || /^data:image\/(png|jpeg|webp|svg\+xml);/.test(url);
}
