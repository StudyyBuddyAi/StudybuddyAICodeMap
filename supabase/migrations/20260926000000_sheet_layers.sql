-- Sheets: a student's own layer over a saved sheet, and the grant that lets a
-- premium sheet be personalized without Pro.
--
-- PROBLEM
--   A saved sheet (study_history) can be inserted and deleted but never
--   updated, so nothing a student did to a sheet after generating it could be
--   kept: AI enhancements only survived when the sheet was saved after them,
--   and there was nowhere to put a highlight, a note or an edit at all.
--
-- CHANGE
--   * sheet_layers: one row per saved sheet holding the student's layer —
--     highlights and why they were made, rewritten lines, added points, notes,
--     what they already know, what they removed, cards made from the sheet —
--     as JSON the client validates on read (src/lib/sheet-layer.ts). The sheet
--     itself stays exactly as generated. Own-row RLS; a layer can only be
--     written against the writer's own sheet.
--   * premium_sheet_grants: written by medical-notes (service role) when it
--     streams a premium sheet to a student without Pro. Personalizing that
--     sheet with AI is then proven against this row, never a client flag. No
--     client policies: only the service role reads or writes it.
--
--   Personalization is a Pro feature. The client gates the manual parts; the
--   AI parts are gated server-side in medical-notes (personalize mode). A free
--   student writing a layer row directly only edits their own view of their own
--   sheet, and costs nothing, so the table itself does not check the tier.
--
-- VERIFY
--   As a signed-in user with a saved sheet S:
--     insert into sheet_layers (sheet_id, user_id, layer) values (S, auth.uid(), '{}');  -- ok
--   With another user's sheet id: rejected by the insert policy.
--     select * from premium_sheet_grants;  -- zero rows as any client role

-- ── 1. sheet_layers ─────────────────────────────────────────────────────────

create table if not exists public.sheet_layers (
  sheet_id uuid primary key references public.study_history(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  layer jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_sheet_layers_user
  on public.sheet_layers(user_id, updated_at desc);

comment on table public.sheet_layers is
  'A student''s own highlights, edits, notes and cards over a saved sheet. The sheet row itself is never changed.';

alter table public.sheet_layers enable row level security;

drop policy if exists "Users read own sheet layers" on public.sheet_layers;
create policy "Users read own sheet layers"
  on public.sheet_layers for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own sheet layers" on public.sheet_layers;
create policy "Users insert own sheet layers"
  on public.sheet_layers for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.study_history h
      where h.id = sheet_id and h.user_id = auth.uid()
    )
  );

drop policy if exists "Users update own sheet layers" on public.sheet_layers;
create policy "Users update own sheet layers"
  on public.sheet_layers for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.study_history h
      where h.id = sheet_id and h.user_id = auth.uid()
    )
  );

drop policy if exists "Users delete own sheet layers" on public.sheet_layers;
create policy "Users delete own sheet layers"
  on public.sheet_layers for delete
  using (auth.uid() = user_id);

-- ── 2. premium_sheet_grants ─────────────────────────────────────────────────

create table if not exists public.premium_sheet_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_premium_sheet_grants_user
  on public.premium_sheet_grants(user_id);

comment on table public.premium_sheet_grants is
  'One row per premium sheet streamed to a student without Pro. Proves the sheet may be AI-personalized. Service role only.';

alter table public.premium_sheet_grants enable row level security;
-- No policies: RLS denies every client role; medical-notes uses the service role.
