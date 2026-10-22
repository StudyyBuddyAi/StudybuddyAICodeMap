-- 20260928010000_reconcile_profiles_username.sql
-- Reconcile drift between the recorded history (20260919010000_usernames_and_popular_topics)
-- and the live schema: public.profiles.username was recorded as applied but was never
-- applied live. This migration documents the intended end state by applying it forward,
-- without touching the historical migration.
--
-- Source of truth: live production behavior + current application requirements.
--   - src/pages/AccountDashboard.tsx:134 reads/writes username (maxLength 40)
--   - src/pages/Index.tsx:286,314-315 reads username with NULL fallback
--   - src/integrations/supabase/types.ts:230 declares username nullable
-- No UNIQUE/NOT NULL/index: neither the historical migration nor the app requires one.

alter table public.profiles
  add column if not exists username text;

-- After 20260823192809 revoked table-level UPDATE and granted only column-level
-- UPDATE (email, preferred_model), username must be part of the column grant or
-- any client write to it fails with permission denied. Additive and safe.
grant update (email, preferred_model, username)
  on public.profiles to anon, authenticated;

-- handle_new_user keeps SECURITY DEFINER + SET search_path = public and only adds
-- the nullable username derivation. ACL is unchanged (REVOKEd in 20260505154719;
-- CREATE OR REPLACE preserves it). The existing single trigger on_auth_user_created
-- (20260505154708) binds by function name, so it adopts the new body automatically.
-- split_part(NULL,...) -> NULL keeps anonymous-account signups safe, and NULL emails
-- are skipped by the backfill below.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username)
  values (NEW.id, NEW.email, split_part(NEW.email, '@', 1));
  return NEW;
end;
$$;

-- Idempotent backfill: only outstanding rows with a real email; never overwrites,
-- cannot collide (no unique constraint). Anonymous profiles stay NULL (handled by UI).
update public.profiles
   set username = split_part(email, '@', 1)
 where username is null
   and email is not null;