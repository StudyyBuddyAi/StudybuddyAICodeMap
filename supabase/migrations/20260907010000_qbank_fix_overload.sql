-- Corrective: remove the start_qbank_session overload 20260907000000 created.
--
-- 20260907000000 ran `create or replace function start_qbank_session(text[],
-- int, text, uuid[])`, assuming that was the live signature because that is
-- what 20260708120000 defines. It is not. The remote database carries a
-- five-argument version with a trailing `p_mode text`, added out-of-band — one
-- of the two migrations that exist in the remote history table with no file in
-- this repo. So `create or replace` did not replace anything; it created a
-- second overload, and PostgREST could no longer resolve the client's call:
--
--   PGRST203: Could not choose the best candidate function between:
--     start_qbank_session(p_domains, p_limit, p_system, p_question_ids)
--     start_qbank_session(p_domains, p_limit, p_system, p_question_ids, p_mode)
--
-- Dropping the four-argument version restores the previous working state
-- exactly. The generated-questions change it was carrying is re-applied to the
-- real five-argument function in the migration that follows this one.
--
-- This is the failure CONTEXT.md warns about, and that 20260708120000's own
-- header warns about: verify live signatures before writing `create or
-- replace`. The helper below exists so the next migration can be written
-- against what is actually deployed rather than against what the repo implies.

drop function if exists public.start_qbank_session(text[], int, text, uuid[]);

-- Temporary introspection helper. Returns the deployed source of every
-- start_qbank_session overload so the corrective migration can be written from
-- fact. Dropped again in 20260907020000 — it must not outlive that migration,
-- since exposing pg_get_functiondef to clients is not something this schema
-- should ship.
create or replace function public._qbank_fn_source()
returns table (args text, src text)
language sql
security definer
set search_path = public
as $$
  select pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'start_qbank_session';
$$;

grant execute on function public._qbank_fn_source() to authenticated;
