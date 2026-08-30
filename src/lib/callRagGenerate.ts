import { supabase } from "@/integrations/supabase/client";

const RAG_GENERATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rag-generate`;

export interface RagGenerateParams {
  query: string;
  topK?: number;
  threshold?: number;
  feature?: string;
  signal?: AbortSignal;
}

export interface RagSource {
  id: string;
  similarity: number;
  guidelineName: string;
  sourceName: string;
  sectionTitle: string | null;
  sourceUrl: string | null;
  content: string;
  metadata: Record<string, unknown>;
}

export interface RagGenerateResponse {
  answer: string;
  grounded: boolean;
  sources: RagSource[];
  error?: {
    code: string;
    message: string;
    refundQuota?: boolean;
  };
}

/**
 * Client function to invoke the `rag-generate` edge function.
 *
 * Reads current Supabase session JWT and attaches Authorization Bearer header.
 */
export async function callRagGenerate(
  params: RagGenerateParams
): Promise<RagGenerateResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? "";

  const n8nWebhookUrl = import.meta.env.VITE_N8N_RAG_WEBHOOK_URL;
  const targetUrl = n8nWebhookUrl || RAG_GENERATE_URL;

  let res: Response;
  try {
    res = await fetch(targetUrl, {
      method: "POST",
      signal: params.signal,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        query: params.query,
        topK: params.topK ?? 5,
        threshold: params.threshold ?? 0.65,
        feature: params.feature ?? "general",
      }),
    });
  } catch (err: unknown) {
    const fetchErr = err instanceof Error ? err.message : "Network error";
    if (!n8nWebhookUrl) {
      throw new Error(
        "Edge function 'rag-generate' is not deployed yet or unreachable. Deploy it via 'supabase functions deploy rag-generate' or set VITE_N8N_RAG_WEBHOOK_URL in .env."
      );
    }
    throw new Error(`Failed to connect to RAG Webhook (${n8nWebhookUrl}): ${fetchErr}`);
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const errorMsg = data?.error?.message || `RAG request failed with status ${res.status}`;
    const err = new Error(errorMsg) as Error & { code?: string };
    err.code = data?.error?.code;
    throw err;
  }

  return data as RagGenerateResponse;
}
