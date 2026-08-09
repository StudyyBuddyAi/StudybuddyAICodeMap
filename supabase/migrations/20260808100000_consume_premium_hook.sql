-- Atomic premium-hook consumption (Phase 2 / audit finding #2)
--
-- The medical-notes edge function previously read profiles.premium_used and
-- then incremented it using a request-body userId. That had two flaws:
--   (a) the userId came from the request body, so a client could read/increment
--       another user's counter (griefing) or pass a bogus id to stay "under
--       limit" forever and keep the free Claude Haiku bait indefinitely;
--   (b) read-then-write was non-atomic: two concurrent requests could both read
--       the same value and both increment, exceeding the hook limit.
--
-- This RPC mirrors the consume_usage pattern (20260708000000): it increments
-- atomically in a single UPDATE guarded by `premium_used < p_limit`, so parallel
-- calls serialize on the row lock and exactly one resolves to 'allowed:true'.
-- It is callable only by the service role (edge function); anon/authenticated
-- can never call it.

create or replace function public.consume_premium_hook(p_user uuid, p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_premium int;
begin
  update profiles
    set premium_used = premium_used + 1
    where id = p_user and premium_used < p_limit
    returning premium_used into v_premium;

  -- No row returned => profile missing or already at/over the limit.
  if v_premium is null then
    select premium_used into v_premium from profiles where id = p_user;
    return jsonb_build_object('allowed', false, 'premium_used', coalesce(v_premium, p_limit));
  end if;

  return jsonb_build_object('allowed', true, 'premium_used', v_premium);
end;
$$;

-- Only the service role (edge function) may call this.
revoke all on function public.consume_premium_hook(uuid, int) from public, anon, authenticated;
grant execute on function public.consume_premium_hook(uuid, int) to service_role;
