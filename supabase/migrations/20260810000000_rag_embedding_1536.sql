-- Migration: Update guideline_chunks embedding dimension to 1536 for OpenAI/OpenRouter text-embedding-3-small
-- and update match_guideline_chunks function signature to return source_url.

-- Drop existing match_guideline_chunks function first to allow return type / parameter type change
drop function if exists public.match_guideline_chunks(vector, double precision, integer);
drop function if exists public.match_guideline_chunks(vector(768), float, int);
drop function if exists public.match_guideline_chunks(vector(1536), float, int);

-- Alter guideline_chunks embedding column type to vector(1536)
alter table public.guideline_chunks 
  alter column embedding type vector(1536);

-- Recreate similarity search RPC function for 1536-dim embeddings
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
    1 - (gc.embedding <=> query_embedding) as similarity
  from public.guideline_chunks gc
  where 1 - (gc.embedding <=> query_embedding) > match_threshold
  order by gc.embedding <=> query_embedding
  limit match_count;
$$;
