-- QBank topic memory: a student's history on a topic, and topic blueprints.
--
-- PROBLEM
--   Every QBank set was written blind. A student who typed "warfarin" again
--   got the same five facts again: measured in
--   docs/qbank/repetition-study-2026-11.md, 33% of later-session questions on
--   live data re-tested a concept from an earlier session (67% in a controlled
--   run), a third of them concepts the student had already answered correctly.
--
-- CHANGE (additive only)
--   qbank_topic_blueprints
--     The distinct concepts an exam tests on one topic, built once per topic and
--     track by qbank-generate (_shared/qbank-blueprint.ts) and shared by every
--     student. A set's rows are assigned concepts the student has not met.
--   claim_qbank_blueprint_build(...)
--     One builder per topic and track. Returns the row id to the caller that
--     should build, null to everyone else: when it is ready, being built, or
--     failed too recently to retry (backoff doubles per failure, 1 hour to 7
--     days).
--   qbank_topic_history(p_user, p_keys, p_limit)
--     A student's generated items on a topic, with their latest attempt — what
--     _shared/qbank-repetition.ts decides the next set from. Matches a row by
--     the canonical key it was stored under (generation_meta.topicKey) or by
--     the key of what was typed, which is all a row written before keys
--     existed has.
--
--   Both functions take a user id, so both are for the service role only: an
--   authenticated caller could otherwise read another student's history. The
--   table has RLS on and no policies, so only the service role reaches it.
--
-- No existing object is altered. qbank-generate fails open without these —
-- it writes the wave blind, as before — so the function may be deployed first.

create table if not exists public.qbank_topic_blueprints (
  id uuid primary key default gen_random_uuid(),
  -- lower(collapsed whitespace(canonical name)), as qbank-repetition.ts topicKey().
  topic_key text not null,
  exam_track text not null check (exam_track in ('step1', 'step2ck')),
  canonical_topic text not null,
  system text not null,
  status text not null default 'building' check (status in ('building', 'ready', 'failed')),
  -- [{ "id": "c1", "text": "...", "tier": "core" | "standard" | "extended" }]
  concepts jsonb not null default '[]'::jsonb,
  -- A topic that contains this one, offered once the student has covered it.
  broader text,
  model text,
  version text not null,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic_key, exam_track)
);

alter table public.qbank_topic_blueprints enable row level security;
revoke all on public.qbank_topic_blueprints from anon, authenticated;

-- ── claim_qbank_blueprint_build ─────────────────────────────────────────────
create or replace function public.claim_qbank_blueprint_build(
  p_topic_key text,
  p_exam_track text,
  p_canonical text,
  p_system text,
  p_version text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_topic_key is null or btrim(p_topic_key) = '' or p_exam_track is null
     or p_exam_track not in ('step1', 'step2ck') then
    return null;
  end if;

  insert into qbank_topic_blueprints as b
    (topic_key, exam_track, canonical_topic, system, version, status, attempts)
  values
    (p_topic_key, p_exam_track, p_canonical, p_system, p_version, 'building', 1)
  on conflict (topic_key, exam_track) do update
    set status = 'building',
        attempts = b.attempts + 1,
        canonical_topic = excluded.canonical_topic,
        system = excluded.system,
        version = excluded.version,
        last_error = null,
        updated_at = now()
    -- A builder that died mid-build leaves 'building' behind; after ten
    -- minutes it is presumed dead. A failure waits 1h, 2h, 4h … capped at 7d.
    where (b.status = 'building' and b.updated_at < now() - interval '10 minutes')
       or (b.status = 'failed'
           and b.updated_at < now() - least(interval '1 hour' * power(2, least(b.attempts, 8) - 1),
                                            interval '7 days'))
  returning b.id into v_id;

  return v_id;
end;
$$;

revoke all on function public.claim_qbank_blueprint_build(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_qbank_blueprint_build(text, text, text, text, text) to service_role;

-- ── qbank_topic_history ─────────────────────────────────────────────────────
create or replace function public.qbank_topic_history(
  p_user uuid,
  p_keys text[],
  p_limit int default 300
)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    -- idx_questions_created_by: (created_by, created_at desc) where generated.
    select
      q.id, q.created_at, q.topic, q.teaching_point, q.question_text, q.exam_mode,
      q.generation_meta as m,
      nullif(q.generation_meta->>'topicKey', '') as stored_key,
      lower(regexp_replace(
        btrim(coalesce(q.generation_meta->>'focus', q.generation_meta->>'requestedTopic', '')),
        '\s+', ' ', 'g')) as raw_key
    from questions q
    where q.created_by = p_user
      and q.origin = 'generated'
  ),
  hits as (
    select *
    from mine
    where stored_key = any(p_keys) or raw_key = any(p_keys)
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 300), 1000))
  ),
  latest as (
    select distinct on (ua.question_id)
      ua.question_id, ua.is_correct, ua.created_at
    from user_attempts ua
    join hits h on h.id = ua.question_id
    where ua.user_id = p_user
    order by ua.question_id, ua.created_at desc
  )
  select coalesce(json_agg(json_build_object(
      'id', h.id,
      'createdAt', h.created_at,
      'generationId', h.m->>'generationId',
      'storedKey', h.stored_key,
      'rawKey', h.raw_key,
      'examTrack', coalesce(h.m->>'examTrack', h.exam_mode),
      'concept', case
        when h.m->'concept'->>'id' is not null and h.m->'concept'->>'blueprint' is not null
        then json_build_object('blueprint', h.m->'concept'->>'blueprint', 'id', h.m->'concept'->>'id')
      end,
      'revisitOf', h.m->'concept'->>'revisitOf',
      'subtopic', coalesce(h.topic, ''),
      'teachingPoint', coalesce(h.teaching_point, ''),
      -- question_text is the vignette, a blank line, then the lead-in.
      'leadIn', regexp_replace(h.question_text, '^.*\n\n', ''),
      -- The same three tests claim_generated_questions applies: what the
      -- student could actually have been shown.
      'playable', coalesce((h.m->>'qaBlocked')::boolean, false) = false
                  and coalesce((h.m->'verification'->>'agreed')::boolean, true) = true,
      'lastAttemptAt', l.created_at,
      'lastCorrect', l.is_correct
    ) order by h.created_at desc), '[]'::json)
  from hits h
  left join latest l on l.question_id = h.id;
$$;

revoke all on function public.qbank_topic_history(uuid, text[], int) from public, anon, authenticated;
grant execute on function public.qbank_topic_history(uuid, text[], int) to service_role;
