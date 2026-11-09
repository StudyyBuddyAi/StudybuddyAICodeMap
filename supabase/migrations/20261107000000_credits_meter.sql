-- The credits meter: every Corti call's cost, and a day's budget per student.
--
-- ai_spend is the ledger — one row per Corti call, written by the edge
-- functions (supabase/functions/_shared/meter.ts) with the tokens Corti
-- reported and their cost in micro-dollars (µ$; _shared/credits.ts prices).
-- A charged row also adds its cost to the student's usage_records row of kind
-- 'credits' for the day, by trigger, so the ledger and the count a usage bar
-- reads can never disagree.
--
-- credit_holds is what a request sets aside before its first call, sized to
-- its worst case, and deletes when it ends: reserve_credits counts the day's
-- charges plus the holds still running, so a student's parallel requests
-- cannot spend past the budget together. A hold that is never given back
-- expires on its own.
--
-- 'assist' is a plain daily count for Explain, Expand, Clinical and
-- personalize actions, which until now had no limit at all.
--
-- Only the service role reads or writes any of this; the student keeps
-- SELECT on their own usage_records rows, which now include 'credits'.

alter table public.usage_records drop constraint if exists usage_records_kind_check;
alter table public.usage_records
  add constraint usage_records_kind_check
  check (kind in ('sheet', 'cards', 'qbank_generate', 'section', 'branch', 'assist', 'credits'));

create table if not exists public.ai_spend (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  usage_date date not null default current_date,
  -- Null when the spend is nobody's — or the account has since been deleted.
  user_id uuid references auth.users (id) on delete set null,
  request_id uuid not null,
  fn text not null,
  feature text not null,
  model text not null,
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  reasoning_tokens integer not null default 0 check (reasoning_tokens >= 0),
  cached_tokens integer not null default 0 check (cached_tokens >= 0),
  cost_micros integer not null default 0 check (cost_micros >= 0),
  -- No usage frame: tokens estimated from length and time. Not charged unless
  -- the student cut the stream off.
  estimated boolean not null default false,
  charged boolean not null default false,
  outcome text not null check (outcome in ('ok', 'http_error', 'aborted', 'failed', 'cancelled')),
  status integer not null default 0,
  duration_ms integer not null default 0
);

create index if not exists ai_spend_usage_date_idx on public.ai_spend (usage_date);
create index if not exists ai_spend_user_date_idx on public.ai_spend (user_id, usage_date);

alter table public.ai_spend enable row level security;
-- No policies: service role only.

create table if not exists public.credit_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists credit_holds_user_idx on public.credit_holds (user_id, expires_at);

alter table public.credit_holds enable row level security;
-- No policies: service role only.

-- A charged row's cost, onto the student's credits count for that day.
create or replace function public.charge_ai_spend()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.charged and new.user_id is not null and new.cost_micros > 0 then
    insert into usage_records (user_id, kind, usage_date, count)
      values (new.user_id, 'credits', new.usage_date, new.cost_micros)
    on conflict (user_id, kind, usage_date)
      do update set count = usage_records.count + excluded.count;
  end if;
  return new;
end;
$$;

drop trigger if exists ai_spend_charge on public.ai_spend;
create trigger ai_spend_charge
  after insert on public.ai_spend
  for each row execute function public.charge_ai_spend();

-- Sets aside p_amount µ$ of today's budget for a request about to run.
--
-- within_budget: whether today's charges, the holds still running and this one
-- fit in p_cap (null: no cap). allowed: whether the request may go ahead —
-- always, unless p_enforce. A hold is taken whenever the request goes ahead,
-- so that record mode measures exactly what enforcing would.
--
-- The day's credits row is locked first: one student's concurrent requests
-- serialize here, so the sum of what they hold can never pass the cap.
create or replace function public.reserve_credits(
  p_user uuid,
  p_amount integer,
  p_cap integer,
  p_enforce boolean default false,
  p_ttl_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := current_date;
  v_used bigint;
  v_held bigint;
  v_amount integer := greatest(coalesce(p_amount, 0), 1);
  v_within boolean;
  v_hold uuid;
begin
  if p_user is null then
    raise exception 'user_required';
  end if;

  insert into usage_records (user_id, kind, usage_date, count)
    values (p_user, 'credits', v_date, 0)
  on conflict (user_id, kind, usage_date) do nothing;

  select count into v_used
    from usage_records
    where user_id = p_user and kind = 'credits' and usage_date = v_date
    for update;

  delete from credit_holds where user_id = p_user and expires_at <= now();
  select coalesce(sum(amount), 0) into v_held from credit_holds where user_id = p_user;

  v_within := p_cap is null or v_used + v_held + v_amount <= p_cap;

  if v_within or not coalesce(p_enforce, false) then
    insert into credit_holds (user_id, amount, expires_at)
      values (p_user, v_amount, now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 300), 1)))
      returning id into v_hold;
  end if;

  return jsonb_build_object(
    'allowed', v_within or not coalesce(p_enforce, false),
    'within_budget', v_within,
    'hold', v_hold,
    'used', v_used,
    'held', v_held,
    'cap', p_cap,
    'date', v_date
  );
end;
$$;

create or replace function public.release_credit_hold(p_hold uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from credit_holds where id = p_hold;
end;
$$;

revoke all on function public.charge_ai_spend() from public, anon, authenticated;
revoke all on function public.reserve_credits(uuid, integer, integer, boolean, integer) from public, anon, authenticated;
revoke all on function public.release_credit_hold(uuid) from public, anon, authenticated;
grant execute on function public.reserve_credits(uuid, integer, integer, boolean, integer) to service_role;
grant execute on function public.release_credit_hold(uuid) to service_role;

revoke all on table public.ai_spend from anon, authenticated;
revoke all on table public.credit_holds from anon, authenticated;
grant select, insert on table public.ai_spend to service_role;
grant select, insert, delete on table public.credit_holds to service_role;
