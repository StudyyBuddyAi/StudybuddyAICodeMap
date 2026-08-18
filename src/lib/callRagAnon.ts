const RAG_GENERATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rag-generate`;

export interface RagAnonParams {
  query: string;
  topK?: number;
  threshold?: number;
  feature?: string;
  signal?: AbortSignal;
}

export interface RagAnonResponse {
  answer: string;
  grounded: boolean;
  sources: Array<{
    id: string;
    similarity: number;
    guidelineName: string;
    sourceName: string;
    sectionTitle: string | null;
    sourceUrl: string | null;
    content: string;
    metadata: Record<string, unknown>;
  }>;
}

export async function callRagAnon(params: RagAnonParams): Promise<RagAnonResponse> {
  const res = await fetch(RAG_GENERATE_URL, {
    method: "POST",
    signal: params.signal,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: params.query,
      topK: params.topK ?? 5,
      threshold: params.threshold ?? 0.65,
      feature: params.feature ?? "general",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RAG request failed: ${res.status} ${res.statusText} ${text}`);
  }

  const data = await res.json();
  return data as RagAnonResponse;
}
