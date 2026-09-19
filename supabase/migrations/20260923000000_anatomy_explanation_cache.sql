-- Migration: cache for generated structure explanations.
--
-- anatomy-explain is the first call in this app whose cost scales with
-- engagement rather than with generations: it is quota-exempt, and one diagram
-- can carry 50+ tappable structures. Without a cache, a single curious reader
-- can fire fifty model calls in a minute, and every reader pays again for the
-- same answer.
--
-- The key is (diagram, part) and deliberately NOT the sheet topic. An earlier
-- draft passed the topic into the prompt while keying on the pair alone, which
-- would have served one student's answer to another. Dropping topic from the
-- prompt makes the cache correct, drives the hit rate toward 100%, and — the
-- part that matters most — keeps the set of generated explanations small,
-- stable and finite, which is the only way the "review the output for medical
-- accuracy" mitigation is actually performable.

create table if not exists public.anatomy_explanations (
  -- Normalised (trimmed, lower-cased) by the caller before lookup or insert,
  -- so "Left ventricle" and "left  ventricle" cannot both occupy the cache.
  diagram_key text not null,
  part_key    text not null,
  -- Kept for readability when auditing the table by hand.
  diagram     text not null,
  part        text not null,
  explanation text not null,
  model       text,
  created_at  timestamptz not null default now(),
  primary key (diagram_key, part_key)
);

alter table public.anatomy_explanations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'anatomy_explanations'
      and policyname = 'anatomy_explanations_public_read'
  ) then
    -- Readable by anyone: this is generated study content, already shown in
    -- the UI. Writes stay service-role only, so only the edge function fills it.
    create policy "anatomy_explanations_public_read"
      on public.anatomy_explanations
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;
