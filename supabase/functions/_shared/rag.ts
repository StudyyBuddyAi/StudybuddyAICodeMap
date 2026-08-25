import { OpenAIEmbeddings } from "npm:@langchain/openai@0.3.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

export type RagChunk = {
  id: string;
  guidelineName: string;
  sectionTitle: string | null;
  sourceUrl: string | null;
  content: string;
  similarity: number;
};

type MatchGuidelineChunksRow = {
  id: string;
  guideline_id: string;
  guideline_name: string;
  section_title: string | null;
  content: string;
  source_url: string | null;
  similarity: number;
};

/** Same OpenRouter-backed embeddings config rag-generate has always used. */
export function makeEmbeddings(openRouterApiKey: string): OpenAIEmbeddings {
  return new OpenAIEmbeddings({
    apiKey: openRouterApiKey,
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
    modelName: "text-embedding-3-small",
  });
}

export async function embedQuery(
  embeddings: OpenAIEmbeddings,
  text: string
): Promise<number[]> {
  return embeddings.embedQuery(text);
}

/**
 * Calls match_guideline_chunks (pgvector cosine search). The RPC already
 * filters server-side (`where similarity > match_threshold`), so every
 * returned row already clears the bar — grounded is just "did we get
 * anything back", not a second similarity comparison.
 */
export async function retrieveChunks(
  supabase: SupabaseClient,
  queryEmbedding: number[],
  topK: number,
  threshold: number
): Promise<{ chunks: RagChunk[]; grounded: boolean }> {
  const { data, error } = await supabase.rpc("match_guideline_chunks", {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: topK,
  });

  if (error) {
    throw error;
  }

  const rows: MatchGuidelineChunksRow[] = Array.isArray(data) ? data : [];
  const chunks: RagChunk[] = rows.map((row) => ({
    id: row.id,
    guidelineName: row.guideline_name,
    sectionTitle: row.section_title ?? null,
    sourceUrl: row.source_url ?? null,
    content: row.content,
    similarity: row.similarity,
  }));

  return { chunks, grounded: chunks.length > 0 };
}
