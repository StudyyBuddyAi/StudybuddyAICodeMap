-- Generated images for study-sheet visuals (feature: sheet visuals, phase 3)
--
-- WHAT
--   * storage bucket `sheet-visuals` — public read, written only by the
--     generate-sheet-image edge function (service role).
--   * table public.sheet_visual_images — one row per generated image: the cache
--     index the edge function checks before paying for a generation, and the
--     audit trail for finding (and removing) a bad image.
--
-- WHY NOT public.media
--   media / question_media are the hand-ingested, license-tracked QBank library.
--   These images are generated on demand and unreviewed — a different trust
--   model, kept in a different place.
--
-- ACCESS
--   * Bucket is public: objects are served from /storage/v1/object/public/…
--     without RLS. They are non-sensitive generated illustrations, and the
--     cache key is shared across users by design.
--   * No storage.objects policies are added, so anon/authenticated can neither
--     upload, overwrite, delete nor list. The service role bypasses RLS.
--   * sheet_visual_images has RLS enabled with no policies, and table privileges
--     revoked from anon/authenticated: server-only. Clients never read it; the
--     edge function returns the URL.
--
-- SAFETY
--   Purely additive and idempotent: ON CONFLICT DO NOTHING / IF NOT EXISTS.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sheet-visuals',
  'sheet-visuals',
  true,
  8388608, -- 8 MiB; a 1K image from the model is well under this
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create table if not exists public.sheet_visual_images (
  -- sha256 of version + normalized topic + image_view
  -- (supabase/functions/_shared/sheet-image-key.ts)
  cache_key text primary key,
  storage_path text not null,
  topic text not null,
  image_view text not null check (image_view in ('gross', 'histology', 'cross-section', 'schematic')),
  prompt text not null,
  model text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists sheet_visual_images_created_by_idx
  on public.sheet_visual_images (created_by, created_at desc);

alter table public.sheet_visual_images enable row level security;

revoke all on table public.sheet_visual_images from anon, authenticated;
grant all on table public.sheet_visual_images to service_role;
