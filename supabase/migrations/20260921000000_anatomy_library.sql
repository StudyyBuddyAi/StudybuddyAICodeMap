-- Migration: the anatomy image library.
--
-- Published anatomical illustrations, stored whole and displayed unmodified.
-- Nothing here is generated or segmented: the illustrator already printed the
-- structure names on the picture, and those labels drive the interaction. The
-- model's only job is writing prose about a named structure, which happens in
-- the anatomy-explain edge function and never touches this table.
--
-- The embedding is vector(1536) to match guideline_chunks (see
-- 20260810000000_rag_embedding_1536.sql). text-embedding-3-small returns 1536
-- dimensions by default, and the ingest script asserts the length it gets, so
-- a provider change cannot silently write vectors this table cannot compare.

create extension if not exists vector;

create table if not exists public.anatomy_images (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  organ         text not null,              -- 'heart', 'nephron', 'brain'
  "view"        text,                       -- 'anterior', 'sagittal', 'cross-section'
  body_system   text,
  labels        text[] not null default '{}',
  -- width / height, read from the SVG viewBox at ingest. Null for rasters,
  -- which the client falls back to a default ratio for. Anatomical drawings
  -- are not one shape — a nephron is tall, a heart cross-section wide — and a
  -- fixed ratio letterboxes exactly the tall ones.
  aspect_ratio  numeric,
  storage_path  text not null unique,       -- path inside the `anatomy` bucket
  source_url    text,
  attribution   text,
  embedding     vector(1536),
  created_at    timestamptz not null default now()
);

create index if not exists idx_anatomy_images_labels
  on public.anatomy_images using gin (labels);

create index if not exists idx_anatomy_images_organ
  on public.anatomy_images (organ, "view");

-- No ivfflat index here on purpose. ivfflat builds its lists from rows that
-- already exist, so creating it on an empty table produces a useless index.
-- After the first ingest, run:
--
--   create index idx_anatomy_images_embedding
--     on public.anatomy_images using ivfflat (embedding vector_cosine_ops)
--     with (lists = 100);
--   analyze public.anatomy_images;
--
-- guideline_chunks has no vector index at all today and scans sequentially,
-- so there is no in-repo precedent to copy — this would be the first.

alter table public.anatomy_images enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'anatomy_images'
      and policyname = 'anatomy_images_public_read'
  ) then
    create policy "anatomy_images_public_read"
      on public.anatomy_images
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;

-- Writes are service-role only: the ingest script bypasses RLS, and no policy
-- grants insert/update/delete to anon or authenticated.

-- ── Matching ────────────────────────────────────────────────────────────────
-- min_similarity is the safety dial. Showing no diagram is always better than
-- showing the wrong organ, and this threshold is the only thing standing
-- between those two outcomes. The sheet's own retrieval defaults to 0.60
-- (clamped 0.40-0.90), so 0.45 is inside the app's existing band but looser
-- than its default. Raise it, not lower it, as the corpus grows: more images
-- means more near-misses.
drop function if exists public.match_anatomy(vector(1536), int, float);

create or replace function public.match_anatomy(
  query_embedding vector(1536),
  match_count int default 3,
  min_similarity float default 0.45
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
    and 1 - (i.embedding <=> query_embedding) > min_similarity
  order by i.embedding <=> query_embedding
  limit match_count;
$$;

-- ── Storage ─────────────────────────────────────────────────────────────────
-- One public bucket. These are published illustrations, not user data, and a
-- signed URL per image would add a round trip to every render for no benefit.
-- This is the project's first use of Supabase Storage.
--
-- If the hosted role cannot create policies on storage.objects, create the
-- bucket in the dashboard (Storage -> New bucket -> name "anatomy", public)
-- and this migration's storage section becomes a no-op.
insert into storage.buckets (id, name, public)
values ('anatomy', 'anatomy', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'anatomy_objects_public_read'
  ) then
    create policy "anatomy_objects_public_read"
      on storage.objects
      for select
      to anon, authenticated
      using (bucket_id = 'anatomy');
  end if;
exception
  when insufficient_privilege then
    raise notice 'skipped storage.objects policy: insufficient privilege. Create the anatomy bucket in the dashboard instead.';
end $$;
