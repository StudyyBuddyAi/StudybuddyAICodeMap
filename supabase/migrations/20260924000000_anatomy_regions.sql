-- Migration: store the interactive regions extracted from each illustration.
--
-- Published diagrams put a structure's name in the margin and run a leader line
-- to the structure itself. scripts/svg-regions.js flattens the ancestor
-- transforms, reads the labels, finds those leaders and follows each one to its
-- far end — so the label says what, and the leader says where. It is pure
-- geometry, runs once at ingest, and needs no per-image annotation, which is
-- the only property that survives a library of thousands.
--
-- Shape of each element:
--   { label, x, y, labelX, labelY, confidence }
-- with x/y normalised 0-1 of the viewBox so they hold at any rendered size.
-- confidence "leader" means a pointer line was followed to the structure;
-- "label" means none was found and the coordinate is the label's own position,
-- out in the margin. Only "leader" regions are safe to draw on the drawing —
-- highlighting a "label" one would point at empty space and imply the structure
-- is there.

alter table public.anatomy_images
  add column if not exists regions jsonb not null default '[]'::jsonb;

drop function if exists public.match_anatomy(vector(1536), int, float, text);

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
  regions jsonb,
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
    i.regions,
    i.aspect_ratio,
    i.storage_path,
    i.attribution,
    i.source_url,
    1 - (i.embedding <=> query_embedding) as similarity
  from public.anatomy_images i
  where i.embedding is not null
    and (filter_system is null or i.body_system = filter_system)
    and (filter_system is not null or 1 - (i.embedding <=> query_embedding) > min_similarity)
  order by i.embedding <=> query_embedding
  limit match_count;
$$;
