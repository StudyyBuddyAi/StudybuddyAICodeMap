-- Migration: expose each retrieved chunk's position in its source document.
--
-- `guideline_chunks` has always carried `chunk_index` and a `metadata` jsonb
-- (page_start / page_end / total_chunks, written by the ingestion pipeline),
-- but match_guideline_chunks never selected them — so the UI could only ever
-- render a chunk as an anonymous blob of text. Returning them lets the source
-- list cite a position in the book instead of a similarity score.
--
-- Read the accompanying note in src/lib/source-display.ts before trusting
-- metadata.page_start for display: it is a PDF page index, and its offset from
-- the printed page number differs per document.

drop function if exists public.match_guideline_chunks(vector(1536), float, int);

create or replace function public.match_guideline_chunks(
  query_embedding vector(1536),
  match_threshold float default 0.5,
  match_count int default 5
)
returns table (
  id uuid,
  guideline_id text,
  guideline_name text,
  section_title text,
  content text,
  source_url text,
  chunk_index int,
  metadata jsonb,
  similarity float
)
language sql stable as $$
  select
    gc.id,
    gc.guideline_id,
    gc.guideline_name,
    gc.section_title,
    gc.content,
    gc.source_url,
    gc.chunk_index,
    gc.metadata,
    1 - (gc.embedding <=> query_embedding) as similarity
  from public.guideline_chunks gc
  where 1 - (gc.embedding <=> query_embedding) > match_threshold
  order by gc.embedding <=> query_embedding
  limit match_count;
$$;
