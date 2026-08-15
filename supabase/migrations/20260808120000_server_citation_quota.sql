-- Server-side citation quota (Phase 3 / audit finding #5)
--
-- Citation limits were previously enforced client-side: the get-citations edge
-- function had no auth check, and the client incremented citation_usage (or a
-- localStorage counter for anon) only after a successful fetch. That meant a
-- crafted request could call NCBI for free, and the local counter could be
-- cleared/reset to bypass the limit entirely.
--
-- This mirrors the consume_usage / refund_usage pattern (20260708000000):
--   - consume_citation increments atomically in a single upsert guarded by
--     `count < p_cap`, so parallel calls serialize on the row lock and exactly
--     one resolves to 'allowed:true'.
--   - refund_citation returns one unit when the NCBI lookup fails or finds
--     nothing, so only delivered citations count against the daily limit.
-- Both are callable only by the service role (edge function); anon and
-- authenticated clients can never call them.

create or replace function public.consume_citation(p_user uuid, p_cap int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into citation_usage (user_id, usage_date, count)
    values (p_user, current_date, 1)
  on conflict (user_id, usage_date)
    do update set count = citation_usage.count + 1
      where citation_usage.count < p_cap
  returning count into v_count;

  -- No row returned => the conflicting row was already at/over cap (DO UPDATE
  -- WHERE evaluated false). Read the current value for the response.
  if v_count is null then
    select count into v_count
      from citation_usage
      where user_id = p_user and usage_date = current_date;
    return jsonb_build_object('allowed', false, 'count', coalesce(v_count, p_cap));
  end if;

  return jsonb_build_object('allowed', true, 'count', v_count);
end;
$$;

-- Refund one consumed unit when the citation lookup fails, so failed lookups
-- never burn the daily quota. Floors at 0.
create or replace function public.refund_citation(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update citation_usage
    set count = greatest(count - 1, 0)
    where user_id = p_user and usage_date = current_date;
end;
$$;

-- Only the service role (edge function) may call these.
revoke all on function public.consume_citation(uuid, int) from public, anon, authenticated;
revoke all on function public.refund_citation(uuid) from public, anon, authenticated;
grant execute on function public.consume_citation(uuid, int) to service_role;
grant execute on function public.refund_citation(uuid) to service_role;

-- Remove client write access to citation_usage; keep the SELECT policy so the
-- UI can still display today's counts. (Dropping policies is allowed under the
-- additive-only rule — policies are not columns or tables.)
drop policy if exists "Users can upsert own citation usage" on public.citation_usage;
drop policy if exists "Users can update own citation usage" on public.citation_usage;
