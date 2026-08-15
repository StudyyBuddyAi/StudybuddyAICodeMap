import { supabase } from "@/integrations/supabase/client";

const GET_CITATIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-citations`;

export interface CitationResult {
  label: string;   // "PubMed" | "AHA/ACC" | "ACOG" | "KDIGO" | "IDSA" | "ADA" | "GOLD/ERS" | "AAP"
  title: string;
  url: string;
  tier: number;
}

export interface CitationLookupResult {
  citations: CitationResult[];
  /** True when the server rejected the lookup because the daily citation quota is exhausted. */
  quotaExceeded: boolean;
}

/**
 * Look up a citation for a topic via the `get-citations` edge function.
 *
 * Attaches the current user's Supabase access token as the Authorization bearer
 * so the edge function can verify identity and enforce the daily citation quota
 * server-side (mirrors `callMedicalNotes`). The quota is consumed by the server
 * on this call — it is NOT incremented by the client anymore.
 */
export async function fetchBestCitation(topic: string): Promise<CitationLookupResult> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token ?? "";

    const res = await fetch(GET_CITATIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ topic }),
    });

    if (!res.ok) return { citations: [], quotaExceeded: false };

    const data = await res.json();
    return {
      citations: Array.isArray(data?.citations)
        ? (data.citations as CitationResult[])
        : [],
      quotaExceeded: data?.quotaExceeded === true,
    };
  } catch {
    return { citations: [], quotaExceeded: false };
  }
}
