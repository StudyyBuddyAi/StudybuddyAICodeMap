import { OpenAIEmbeddings } from "npm:@langchain/openai@0.3.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

export type RagChunk = {
  id: string;
  guidelineName: string;
  sectionTitle: string | null;
  sourceUrl: string | null;
  content: string;
  similarity: number;
  /** Position of this chunk in its source document, 0-based. */
  chunkIndex: number | null;
  /** Total chunks the ingestion run produced for that document. */
  totalChunks: number | null;
  /**
   * Page span from the ingestion metadata. This is the page index within the
   * ingested PDF, NOT the page number printed on the page — the offset between
   * the two differs per document, and for a split volume it is thousands of
   * pages. Never render it directly: `resolveLocation` in
   * src/lib/source-display.ts prefers the printed page parsed out of the
   * document's running header and falls back to this only when it is plausible.
   */
  pageStart: number | null;
  pageEnd: number | null;
};

type MatchGuidelineChunksRow = {
  id: string;
  guideline_id: string;
  guideline_name: string;
  section_title: string | null;
  content: string;
  source_url: string | null;
  chunk_index: number | null;
  metadata: Record<string, unknown> | null;
  similarity: number;
};

/** Reads a positive integer out of the ingestion metadata blob, else null. */
function metaInt(metadata: Record<string, unknown> | null, key: string): number | null {
  const v = metadata?.[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

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
  // Only the four locator fields are lifted out of `metadata` — the rest of
  // the blob is ingestion bookkeeping (checksums, the original PDF filename,
  // timestamps) with no business being streamed to the client and persisted
  // inside every saved sheet.
  const chunks: RagChunk[] = rows.map((row) => ({
    id: row.id,
    guidelineName: row.guideline_name,
    sectionTitle: row.section_title ?? null,
    sourceUrl: row.source_url ?? null,
    content: row.content,
    similarity: row.similarity,
    chunkIndex: typeof row.chunk_index === "number" ? row.chunk_index : null,
    totalChunks: metaInt(row.metadata ?? null, "total_chunks"),
    pageStart: metaInt(row.metadata ?? null, "page_start"),
    pageEnd: metaInt(row.metadata ?? null, "page_end"),
  }));

  return { chunks, grounded: chunks.length > 0 };
}
