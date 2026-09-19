-- Migration: let match_anatomy filter by organ system.
--
-- Measured on the first ingested corpus: anatomy-worded topics match their
-- organ strongly (0.50-0.66), but disease-worded topics — which is what the
-- sheets are actually about — rank the correct organ first and still score far
-- too low to clear the floor:
--
--   Asthma                 -> Respiratory    0.272
--   Diabetic ketoacidosis  -> Endocrine      0.224
--   Heart failure          -> Heart          0.389
--
-- Lowering the floor to catch those is not safe: an unrelated control topic
-- scored 0.108, so a floor near 0.20 leaves barely 2x separation from noise.
--
-- Instead the caller resolves the topic to an organ system via
-- curriculum_topics, which already maps ~170 disease topics to 13 systems by
-- hand, and passes it here. A system match is a deterministic guarantee of
-- relevance, so no similarity floor applies in that mode — the embedding is
-- used only to order images within the system. The floor still governs the
-- fallback path, where nothing but similarity vouches for the result.

drop function if exists public.match_anatomy(vector(1536), int, float);

create or replace function public.match_anatomy(
  query_embedding vector(1536),
  match_count int default 3,
  min_similarity float default 0.45,
  filter_system text default null
)
returns table (
  id uuid,
  title text,
  organ text,
  "view" text,
  labels text[],
  aspect_ratio numeric,
  storage_path text,
  attribution text,
  source_url text,
  similarity float
)
language sql stable as $$
  select
    i.id,
    i.title,
    i.organ,
    i."view",
    i.labels,
    i.aspect_ratio,
    i.storage_path,
    i.attribution,
    i.source_url,
    1 - (i.embedding <=> query_embedding) as similarity
  from public.anatomy_images i
  where i.embedding is not null
    and (filter_system is null or i.body_system = filter_system)
    -- The floor guards the similarity-only path. When a system was resolved,
    -- relevance is already established and the floor would only discard
    -- correct results.
    and (filter_system is not null or 1 - (i.embedding <=> query_embedding) > min_similarity)
  order by i.embedding <=> query_embedding
  limit match_count;
$$;
