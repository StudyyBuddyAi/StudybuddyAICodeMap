-- QBank free-tier daily cap: 10 delivered questions per day.
--
-- The `qbank_generate` usage kind has been allowed by the usage_records CHECK
-- since 20260911000000, but nothing ever consumed it: any signed-in free
-- account could generate without limit (one wrote 363 items). The owner set
-- the cap on 2026-10-30 — 10 questions a day for free accounts, Pro unlimited —
-- and decided it counts DELIVERED questions only: an item the QA gate or the
-- verifier holds back, or a retry of a question the student already owns,
-- costs the student nothing.
--
-- consume_usage (20260708000000) moves one unit per call, and a wave asks for
-- up to eight questions at once. So a wave RESERVES its size up front, which is
-- what stops two tabs from each being granted the last ten, and RELEASES what
-- it did not deliver when it closes. A wave that dies between the two keeps its
-- reservation: the student loses at most one wave's worth for the day, and we
-- never hand out more than the cap.
--
-- The day is the database's current_date (UTC), the same day the sheet and
-- card counters use and the same day the client reads.
--
-- Additive only. Both functions are service-role only, like consume_usage:
-- the edge function passes the verified user id because auth.uid() is NULL
-- under the service role.

create or replace function public.reserve_usage(
  p_user uuid,
  p_kind text,
  p_want int,
  p_cap int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := current_date;
  v_count int;
  v_grant int;
begin
  if p_user is null then raise exception 'user_required'; end if;

  insert into usage_records (user_id, kind, usage_date, count)
    values (p_user, p_kind, v_date, 0)
  on conflict (user_id, kind, usage_date) do nothing;

  -- Row lock: concurrent reservations for the same user and day serialize
  -- here, so the sum of grants can never pass the cap.
  select count into v_count
    from usage_records
   where user_id = p_user and kind = p_kind and usage_date = v_date
   for update;

  v_grant := least(greatest(coalesce(p_want, 0), 0), greatest(p_cap - v_count, 0));

  if v_grant > 0 then
    update usage_records
       set count = count + v_grant
     where user_id = p_user and kind = p_kind and usage_date = v_date;
  end if;

  return jsonb_build_object(
    'granted', v_grant,
    'count', v_count + v_grant,
    'remaining', greatest(p_cap - (v_count + v_grant), 0),
    'date', v_date
  );
end;
$$;

-- Gives back what a reservation did not deliver. Takes the reservation's date
-- so a wave that straddles midnight refunds the day it was charged to. Floors
-- at zero.
create or replace function public.release_usage(
  p_user uuid,
  p_kind text,
  p_n int,
  p_date date default current_date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_n, 0) <= 0 then return; end if;
  update usage_records
     set count = greatest(count - p_n, 0)
   where user_id = p_user and kind = p_kind and usage_date = p_date;
end;
$$;

revoke all on function public.reserve_usage(uuid, text, int, int) from public, anon, authenticated;
revoke all on function public.release_usage(uuid, text, int, date) from public, anon, authenticated;
grant execute on function public.reserve_usage(uuid, text, int, int) to service_role;
grant execute on function public.release_usage(uuid, text, int, date) to service_role;
