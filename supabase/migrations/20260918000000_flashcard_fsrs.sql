-- Flashcards: FSRS-6 scheduling state, a review log an optimizer can learn
-- from, per-user study settings, and atomic review writes.
--
-- PROBLEM
--   Cards were scheduled on a fixed ladder (1, 3, 7, 21, 60 days) stored as
--   cards.interval_days. Nothing about a card's difficulty or memory strength
--   was kept, so every card walked the same path. A review was two separate
--   client writes — an UPDATE on cards, then an INSERT on review_sessions — so
--   a failure between them left the schedule and the log disagreeing, and two
--   tabs rating the same card could both "win". review_sessions kept only the
--   rating and a timestamp: not enough to evaluate or optimize a scheduler.
--
-- CHANGE
--   * cards: FSRS memory state (srs_state, stability, difficulty,
--     scheduled_days, learning_steps, lapses) and is_leech. srs_state NULL means
--     "still on the old ladder"; the client replays that card's review_sessions
--     through FSRS and writes the result with set_flashcard_states('backfill').
--     due_at, last_reviewed_at and review_count (= FSRS reps) are reused.
--   * review_sessions: the before/after state of each review.
--   * profiles: desired retention, daily limits, optimized weights.
--   * review_flashcard: one transaction under a row lock that rejects a review
--     computed from a stale copy of the card (review_count mismatch), updates
--     the card and logs the review.
--   * set_flashcard_states: bulk writes for backfill and for rescheduling after
--     new weights, each guarded so it cannot clobber a concurrent review.
--   * set_srs_settings, set_srs_weights, get_srs_today.
--
--   FSRS itself runs in the browser (ts-fsrs). The server validates ranges and
--   ordering, not the math: flashcards are self-graded, so a client that lies
--   about its own schedule only hurts itself.
--
-- VERIFY
--   After applying:
--     select column_name from information_schema.columns
--      where table_name = 'cards' and column_name in ('srs_state','stability','difficulty');
--   Then, as a signed-in user with one card whose review_count is N, call
--   review_flashcard twice with p_expected_reps = N: the first returns ok:true,
--   the second ok:false reason 'stale'.

-- ── 1. Columns ──────────────────────────────────────────────────────────────

alter table public.cards
  add column if not exists srs_state smallint,
  add column if not exists stability double precision,
  add column if not exists difficulty double precision,
  add column if not exists scheduled_days integer not null default 0,
  add column if not exists learning_steps integer not null default 0,
  add column if not exists lapses integer not null default 0,
  add column if not exists is_leech boolean not null default false;

comment on column public.cards.srs_state is
  'FSRS state: 0 new, 1 learning, 2 review, 3 relearning. NULL = not yet migrated from the fixed-ladder scheduler.';
comment on column public.cards.stability is
  'FSRS stability in days: the interval at which predicted recall falls to 90%.';
comment on column public.cards.difficulty is
  'FSRS difficulty, 1-10 (0 while new).';

alter table public.cards
  drop constraint if exists cards_srs_state_check,
  add constraint cards_srs_state_check check (srs_state is null or srs_state between 0 and 3);

create index if not exists idx_cards_user_due on public.cards (user_id, due_at);

alter table public.review_sessions
  add column if not exists state_before smallint,
  add column if not exists stability_before double precision,
  add column if not exists difficulty_before double precision,
  add column if not exists elapsed_days integer,
  add column if not exists scheduled_days integer,
  add column if not exists stability_after double precision,
  add column if not exists difficulty_after double precision,
  add column if not exists due_after timestamptz,
  add column if not exists duration_ms integer;

create index if not exists idx_review_sessions_card_date
  on public.review_sessions (card_id, reviewed_at);

alter table public.profiles
  add column if not exists srs_desired_retention real not null default 0.9,
  add column if not exists srs_new_per_day integer not null default 50,
  add column if not exists srs_max_reviews_per_day integer not null default 500,
  add column if not exists srs_weights jsonb,
  add column if not exists srs_weights_updated_at timestamptz,
  add column if not exists srs_weights_review_count integer,
  add column if not exists srs_weights_log_loss real;

-- ── 2. flashcard_state_ok (internal) ────────────────────────────────────────
-- Range checks for one card state as the client sends it. Keys:
--   state, stability, difficulty, due_at, last_reviewed_at, scheduled_days,
--   learning_steps, reps, lapses

create or replace function public.flashcard_state_ok(p jsonb)
returns boolean
language plpgsql
stable
set search_path = public
as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if jsonb_typeof(p->'state') <> 'number'
     or jsonb_typeof(p->'stability') <> 'number'
     or jsonb_typeof(p->'difficulty') <> 'number'
     or jsonb_typeof(p->'scheduled_days') <> 'number'
     or jsonb_typeof(p->'learning_steps') <> 'number'
     or jsonb_typeof(p->'reps') <> 'number'
     or jsonb_typeof(p->'lapses') <> 'number'
     or jsonb_typeof(p->'due_at') <> 'string' then
    return false;
  end if;
  return (p->>'state')::numeric in (0, 1, 2, 3)
     and (p->>'stability')::numeric between 0 and 36500
     and (p->>'difficulty')::numeric between 0 and 10
     and (p->>'scheduled_days')::numeric between 0 and 36500
     and (p->>'learning_steps')::numeric between 0 and 20
     and (p->>'reps')::numeric between 0 and 1000000
     and (p->>'lapses')::numeric between 0 and 1000000
     and (p->>'lapses')::numeric <= (p->>'reps')::numeric
     and (p->>'due_at')::timestamptz is not null
     and (p->>'last_reviewed_at' is null or (p->>'last_reviewed_at')::timestamptz is not null);
exception when others then
  -- A malformed timestamp or number is a bad state, not a server error.
  return false;
end;
$$;

revoke all on function public.flashcard_state_ok(jsonb) from public;
revoke all on function public.flashcard_state_ok(jsonb) from anon, authenticated;

-- ── 3. review_flashcard ─────────────────────────────────────────────────────
-- p_next: the card state after this review (flashcard_state_ok keys, plus
--   optional is_leech boolean).
-- p_log:  state_before, stability_before, difficulty_before, elapsed_days,
--   scheduled_days, stability_after, difficulty_after, due_after, reviewed_at,
--   duration_ms.
-- p_expected_reps: the review_count the client computed from. Any other value
--   means the client's copy is stale (another tab, a double tap, a retry that
--   already landed) and the review is refused rather than applied twice.

create or replace function public.review_flashcard(
  p_client_id text,
  p_rating text,
  p_expected_reps int,
  p_next jsonb,
  p_log jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_card cards%rowtype;
  v_reviewed_at timestamptz;
  v_duration int;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_rating not in ('again', 'hard', 'good', 'easy') then raise exception 'invalid_rating'; end if;
  if not flashcard_state_ok(p_next) then raise exception 'invalid_state'; end if;

  begin
    v_reviewed_at := coalesce((p_log->>'reviewed_at')::timestamptz, now());
  exception when others then
    raise exception 'invalid_log';
  end;
  -- The schedule was computed from the client's clock. A clock that far off
  -- would write nonsense due dates; refuse instead.
  if v_reviewed_at < now() - interval '1 day' or v_reviewed_at > now() + interval '1 day' then
    return json_build_object('ok', false, 'reason', 'clock_skew');
  end if;

  select * into v_card from cards
   where user_id = v_user and client_id = p_client_id
   for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_card.review_count <> p_expected_reps then
    return json_build_object('ok', false, 'reason', 'stale', 'review_count', v_card.review_count);
  end if;

  v_duration := least(greatest(coalesce((p_log->>'duration_ms')::numeric, 0), 0), 3600000)::int;

  update cards
     set srs_state = (p_next->>'state')::smallint,
         stability = (p_next->>'stability')::double precision,
         difficulty = (p_next->>'difficulty')::double precision,
         due_at = (p_next->>'due_at')::timestamptz,
         scheduled_days = (p_next->>'scheduled_days')::numeric::int,
         learning_steps = (p_next->>'learning_steps')::numeric::int,
         lapses = (p_next->>'lapses')::numeric::int,
         is_leech = v_card.is_leech or coalesce((p_next->>'is_leech')::boolean, false),
         last_reviewed_at = v_reviewed_at,
         review_count = v_card.review_count + 1,
         -- Kept for anything still reading the ladder column.
         interval_days = (p_next->>'scheduled_days')::numeric::int
   where id = v_card.id;

  insert into review_sessions (
    user_id, card_id, rating, reviewed_at,
    state_before, stability_before, difficulty_before, elapsed_days, scheduled_days,
    stability_after, difficulty_after, due_after, duration_ms
  ) values (
    v_user, v_card.id, p_rating, v_reviewed_at,
    (p_log->>'state_before')::smallint,
    (p_log->>'stability_before')::double precision,
    (p_log->>'difficulty_before')::double precision,
    (p_log->>'elapsed_days')::numeric::int,
    (p_next->>'scheduled_days')::numeric::int,
    (p_next->>'stability')::double precision,
    (p_next->>'difficulty')::double precision,
    (p_next->>'due_at')::timestamptz,
    v_duration
  );

  return json_build_object('ok', true, 'review_count', v_card.review_count + 1);
end;
$$;

revoke all on function public.review_flashcard(text, text, int, jsonb, jsonb) from public;
grant execute on function public.review_flashcard(text, text, int, jsonb, jsonb) to authenticated;

-- ── 4. set_flashcard_states ─────────────────────────────────────────────────
-- Bulk state writes, at most 200 cards per call. Each element:
--   { client_id, expected_reps, state: { flashcard_state_ok keys } }
-- p_mode 'backfill':   only cards still on the ladder (srs_state is null).
--                       review_count is set to the replayed reps.
-- p_mode 'reschedule': only migrated cards whose review_count still equals
--                       expected_reps, so a review that landed meanwhile wins.
-- Cards that fail their guard are skipped, not errors. Returns how many changed.

create or replace function public.set_flashcard_states(p_mode text, p_states jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_item jsonb;
  v_state jsonb;
  v_updated int := 0;
  v_rows int;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_mode not in ('backfill', 'reschedule') then raise exception 'invalid_mode'; end if;
  if p_states is null or jsonb_typeof(p_states) <> 'array' then raise exception 'invalid_states'; end if;
  if jsonb_array_length(p_states) > 200 then raise exception 'too_many_states'; end if;

  for v_item in select * from jsonb_array_elements(p_states) loop
    v_state := v_item->'state';
    continue when not flashcard_state_ok(v_state) or (v_item->>'client_id') is null;

    update cards c
       set srs_state = (v_state->>'state')::smallint,
           stability = (v_state->>'stability')::double precision,
           difficulty = (v_state->>'difficulty')::double precision,
           due_at = (v_state->>'due_at')::timestamptz,
           last_reviewed_at = case
             when p_mode = 'backfill' then coalesce((v_state->>'last_reviewed_at')::timestamptz, c.last_reviewed_at)
             else c.last_reviewed_at
           end,
           scheduled_days = (v_state->>'scheduled_days')::numeric::int,
           learning_steps = (v_state->>'learning_steps')::numeric::int,
           lapses = (v_state->>'lapses')::numeric::int,
           review_count = case
             when p_mode = 'backfill' then (v_state->>'reps')::numeric::int
             else c.review_count
           end,
           interval_days = (v_state->>'scheduled_days')::numeric::int
     where c.user_id = v_user
       and c.client_id = v_item->>'client_id'
       and (
         (p_mode = 'backfill' and c.srs_state is null
           and c.review_count = coalesce((v_item->>'expected_reps')::numeric::int, c.review_count))
         or
         (p_mode = 'reschedule' and c.srs_state is not null
           and c.review_count = (v_item->>'expected_reps')::numeric::int)
       );
    get diagnostics v_rows = row_count;
    v_updated := v_updated + v_rows;
  end loop;

  return json_build_object('ok', true, 'updated', v_updated);
end;
$$;

revoke all on function public.set_flashcard_states(text, jsonb) from public;
grant execute on function public.set_flashcard_states(text, jsonb) to authenticated;

-- ── 5. set_srs_settings ─────────────────────────────────────────────────────

create or replace function public.set_srs_settings(
  p_desired_retention real,
  p_new_per_day int,
  p_max_reviews_per_day int
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_desired_retention is null or p_desired_retention < 0.8 or p_desired_retention > 0.97 then
    raise exception 'invalid_retention';
  end if;
  if p_new_per_day is null or p_new_per_day < 0 or p_new_per_day > 9999 then
    raise exception 'invalid_new_per_day';
  end if;
  if p_max_reviews_per_day is null or p_max_reviews_per_day < 0 or p_max_reviews_per_day > 9999 then
    raise exception 'invalid_max_reviews';
  end if;

  update profiles
     set srs_desired_retention = p_desired_retention,
         srs_new_per_day = p_new_per_day,
         srs_max_reviews_per_day = p_max_reviews_per_day
   where id = v_user;
  if not found then raise exception 'profile_not_found'; end if;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.set_srs_settings(real, int, int) from public;
grant execute on function public.set_srs_settings(real, int, int) to authenticated;

-- ── 6. set_srs_weights ──────────────────────────────────────────────────────
-- Written by the optimizer (api/fsrs-optimize, acting as the user). NULL resets
-- to the FSRS-6 defaults. Bounds are ts-fsrs's CLAMP_PARAMETERS with short-term
-- scheduling enabled.

create or replace function public.set_srs_weights(
  p_weights jsonb,
  p_review_count int,
  p_log_loss real
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_lo double precision[] := array[0.001,0.001,0.001,0.001, 1, 0.001,0.001,0.001, 0,0, 0.001,0.001,0.001,0.001, 0,0, 1, 0,0, 0.01, 0.1];
  v_hi double precision[] := array[100,100,100,100, 10, 4,4,0.75, 4.5,0.8, 3.5,5,0.25,0.9, 4,1, 6, 2,2, 0.8, 0.8];
  v_w double precision;
  i int;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  if p_weights is not null then
    if jsonb_typeof(p_weights) <> 'array' or jsonb_array_length(p_weights) <> 21 then
      raise exception 'invalid_weights';
    end if;
    for i in 0..20 loop
      if jsonb_typeof(p_weights->i) <> 'number' then raise exception 'invalid_weights'; end if;
      v_w := (p_weights->>i)::double precision;
      if v_w < v_lo[i + 1] or v_w > v_hi[i + 1] then raise exception 'invalid_weights'; end if;
    end loop;
  end if;

  update profiles
     set srs_weights = p_weights,
         srs_weights_updated_at = case when p_weights is null then null else now() end,
         srs_weights_review_count = case when p_weights is null then null else p_review_count end,
         srs_weights_log_loss = case when p_weights is null then null else p_log_loss end
   where id = v_user;
  if not found then raise exception 'profile_not_found'; end if;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.set_srs_weights(jsonb, int, real) from public;
grant execute on function public.set_srs_weights(jsonb, int, real) to authenticated;

-- ── 7. get_srs_today ────────────────────────────────────────────────────────
-- What has been used of today's limits. p_since is the start of the user's
-- study day (local 4 am), which only the client knows.

create or replace function public.get_srs_today(p_since timestamptz)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'new_cards', count(*) filter (where state_before = 0),
    'reviews', count(*) filter (where state_before = 2),
    'total_reviews', (select count(*) from review_sessions where user_id = auth.uid())
  )
  from review_sessions
  where user_id = auth.uid()
    and reviewed_at >= greatest(p_since, now() - interval '2 days');
$$;

revoke all on function public.get_srs_today(timestamptz) from public;
grant execute on function public.get_srs_today(timestamptz) to authenticated;
