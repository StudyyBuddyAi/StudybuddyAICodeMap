import { supabase } from "@/integrations/supabase/client";

const QBANK_GENERATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbank-generate`;

export interface QbankGenerateParams {
  /** Free text, exactly as the student typed it. Resolved to a system server-side. */
  topic: string;
  /** Defaults to 5 server-side; capped at 40 to match the session cap. */
  count?: number;
}

export interface CallQbankGenerateOptions {
  /** Forwarded to fetch, so a student who navigates away cancels the generation. */
  signal?: AbortSignal;
}

/**
 * Single entry point for the `qbank-generate` edge function.
 *
 * Mirrors callMedicalNotes: reads the current Supabase session and attaches the
 * user's access token as the `Authorization` bearer (replacing the publishable
 * key), and returns the raw streaming `Response` so the caller keeps its own
 * SSE-reading logic. The Corti credentials never leave the edge function.
 */
export async function callQbankGenerate(
  params: QbankGenerateParams,
  options: CallQbankGenerateOptions = {}
): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? "";

  return fetch(QBANK_GENERATE_URL, {
    method: "POST",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(params),
  });
}
