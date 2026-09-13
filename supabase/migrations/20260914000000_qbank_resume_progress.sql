-- QBank: Save & Exit, and resume from the server on any device.
--
-- PROBLEM
--   A session could only be resumed from one localStorage slot: one set, gone
--   after 24h, invisible from any other device. The server already kept every
--   answer (user_attempts) and knew which sessions were unfinished (status =
--   'active', ended_at NULL), but not where the student was standing, what they
--   had skipped, how long they had been at it, or what a half-written generated
--   set still needed to keep writing. So an unfinished set existed on the server
--   and could not be picked up from it.
--
-- WHAT THIS ADDS
--   * Progress columns on qbank_sessions, written by save_qbank_progress.
--   * set_question_flag, so a flag is saved when it is set rather than only when
--     the set is finished (an abandoned set used to lose every flag).
--   * list_unfinished_sessions, the "Previous Tests" list.
--   * resume_qbank_session, which rebuilds a session for the player.
--   * end_qbank_session made idempotent under a row lock.
--   * get_session_review now reports the questions a finished set left
--     unanswered, so the summary can show and review them.
--
-- DECISION: NO 'suspended' STATUS
--   An unfinished set stays status = 'active'. submit_answer and
--   claim_generated_questions both require 'active', and a resumed set must keep
--   taking answers and keep receiving generated questions. "Suspended" is simply
--   an active set nobody is sitting right now; last_activity_at orders them.
--
-- ANSWER KEY
--   Nothing here widens what a client can read. resume_qbank_session returns key
--   columns only for questions this session has ALREADY graded in tutor mode —
--   exactly what submit_answer handed back at the time. get_session_review
--   returns the key for unanswered questions only once the set is completed.
--   qbank_question_payload is not executable by any client role.
--
-- VERIFY BEFORE APPLYING
--   The live schema is ahead of this repo (see 20260907020000). Before pushing:
--     select pg_get_functiondef('public.end_qbank_session(uuid)'::regprocedure);
--     select pg_get_functiondef('public.get_session_review(uuid)'::regprocedure);
--   and confirm the bodies below still match the deployed ones apart from the
--   changes described here. Signatures are unchanged, so no overload is created.

-- ── 1. Columns ──────────────────────────────────────────────────────────────

-- Live-only drift, restated so the repo matches production. No-ops there.
alter table public.qbank_sessions
  add column if not exists mode text not null default 'tutor';
alter table public.qbank_sessions
  alter column ended_at drop not null;

alter table public.qbank_sessions
  add column if not exists current_index int not null default 0,
  add column if not exists skipped_ids uuid[] not null default '{}',
  add column if not exists elapsed_ms bigint not null default 0,
  add column if not exists expected_total int,
  add column if not exists generation jsonb,
  add column if not exists annotations jsonb not null default '{}'::jsonb,
  add column if not exists progress_seq bigint not null default 0,
  add column if not exists last_activity_at timestamptz;

comment on column public.qbank_sessions.generation is
  'SessionGeneration from the client (generationId, topic, system, target, '
  'challenge, examMode, nextIndex, covered). What a resumed generated set needs '
  'to keep writing. Topics and indices only — never answer-key material.';
comment on column public.qbank_sessions.annotations is
  '{struck: {questionId: [option letters]}, highlights: {questionId: [[start, end]]}}';

-- Backfilled before the default is set, so existing rows are ordered by when
-- they actually happened rather than all stamped with the migration time.
update public.qbank_sessions
   set last_activity_at = coalesce(ended_at, started_at)
 where last_activity_at is null;

alter table public.qbank_sessions
  alter column last_activity_at set default now();

create index if not exists idx_qbank_sessions_user_status_activity
  on public.qbank_sessions (user_id, status, last_activity_at desc);

-- Orphans. "Discard" used to clear only the browser cache, leaving the server
-- row active forever. An active set older than a day with no answer in it holds
-- nothing a student could want back, and would otherwise crowd the new list.
delete from public.qbank_sessions s
 where s.status = 'active'
   and s.started_at < now() - interval '24 hours'
   and not exists (select 1 from public.user_attempts ua where ua.session_id = s.id);

-- ── 2. qbank_question_payload (internal) ────────────────────────────────────
-- The question object every QBank RPC returns, in one place. p_with_key adds
-- the answer-key columns. Callable only by the SECURITY DEFINER functions below,
-- which run as the owner; no client role may execute it.

create or replace function public.qbank_question_payload(p_id uuid, p_with_key boolean)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
      'id', q.id,
      'subject', q.subject,
      'domain', q.domain,
      'topic', q.topic,
      'difficulty', q.difficulty,
      'competency', q.competency,
      'question_text', q.question_text,
      'option_a', q.option_a,
      'option_b', q.option_b,
      'option_c', q.option_c,
      'option_d', q.option_d,
      'option_e', q.option_e,
      'media', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'file_url', md.file_url,
            'media_type', md.media_type,
            'caption', qm.caption,
            'attribution', md.attribution,
            'license', md.license,
            'display_context', qm.display_context,
            'display_order', qm.display_order
          ) order by qm.display_order
        )
        from question_media qm
        join media md on md.id = qm.media_id
        where qm.question_id = q.id
      ), '[]'::jsonb)
    )
    || case when p_with_key then jsonb_build_object(
      'correct_option', q.correct_option,
      'explanation', q.explanation,
      'teaching_point', q.teaching_point,
      'distractor_explanations', q.distractor_explanations
    ) else '{}'::jsonb end
  from questions q
  where q.id = p_id;
$$;

revoke all on function public.qbank_question_payload(uuid, boolean) from public;
revoke all on function public.qbank_question_payload(uuid, boolean) from anon, authenticated;

-- ── 3. save_qbank_progress ──────────────────────────────────────────────────
-- One snapshot of where the student is. Called debounced while they work, on a
-- heartbeat, when the tab is hidden, and on Save & Exit.
--
-- Deliberately never touches question_ids, user_attempts or flagged_questions:
-- those have their own RPCs, so a stale snapshot can never undo an answer, a
-- claimed question, or a flag.
--
-- p_seq orders snapshots. The client sends max(last seen seq + 1, Date.now()),
-- so a late keepalive flush cannot overwrite a newer save from the same or
-- another device. A save that arrives after the set was finished is expected
-- (the flush on page hide races the finish) and returns ok:false, not an error.

create or replace function public.save_qbank_progress(
  p_session uuid,
  p_seq bigint,
  p_current_index int,
  p_skipped_ids uuid[],
  p_elapsed_ms bigint,
  p_expected_total int,
  p_generation jsonb,
  p_annotations jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session qbank_sessions%rowtype;
  v_count int;
  v_generation jsonb;
  v_annotations jsonb;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  select * into v_session from qbank_sessions where id = p_session for update;
  if not found or v_session.user_id <> v_user then
    raise exception 'session_not_found';
  end if;

  if v_session.status <> 'active' then
    return json_build_object('ok', false, 'reason', 'not_active');
  end if;

  if coalesce(p_seq, 0) <= v_session.progress_seq then
    return json_build_object('ok', false, 'reason', 'stale', 'seq', v_session.progress_seq);
  end if;

  v_count := coalesce(array_length(v_session.question_ids, 1), 0);

  -- A generation belongs to the set it started with. A snapshot naming another
  -- one is a client bug, and must not re-point the set at someone else's rows.
  v_generation := case
    when v_session.generation is not null
         and p_generation is not null
         and (p_generation->>'generationId') is distinct from (v_session.generation->>'generationId')
      then v_session.generation
    else coalesce(p_generation, v_session.generation)
  end;

  -- Highlights and strike-outs are small. Anything this large is not them.
  v_annotations := case
    when p_annotations is null or jsonb_typeof(p_annotations) <> 'object' then v_session.annotations
    when pg_column_size(p_annotations) > 262144 then v_session.annotations
    else p_annotations
  end;

  update qbank_sessions
     set current_index = greatest(0, least(coalesce(p_current_index, 0), greatest(v_count - 1, 0))),
         skipped_ids = coalesce(p_skipped_ids, '{}'::uuid[]),
         elapsed_ms = greatest(v_session.elapsed_ms, coalesce(p_elapsed_ms, 0)),
         expected_total = greatest(coalesce(p_expected_total, v_count), v_count),
         generation = v_generation,
         annotations = v_annotations,
         progress_seq = p_seq,
         last_activity_at = now()
   where id = p_session;

  return json_build_object('ok', true, 'seq', p_seq);
end;
$$;

revoke all on function public.save_qbank_progress(uuid, bigint, int, uuid[], bigint, int, jsonb, jsonb) from public;
grant execute on function public.save_qbank_progress(uuid, bigint, int, uuid[], bigint, int, jsonb, jsonb) to authenticated;

-- ── 4. set_question_flag ────────────────────────────────────────────────────
-- Allowed on finished sets too: flagging from the review is a reasonable thing
-- to want, and a flag carries no answer-key material.

create or replace function public.set_question_flag(
  p_session uuid,
  p_question uuid,
  p_flagged boolean
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session qbank_sessions%rowtype;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  select * into v_session from qbank_sessions where id = p_session;
  if not found or v_session.user_id <> v_user then
    raise exception 'session_not_found';
  end if;
  if not (p_question = any(coalesce(v_session.question_ids, '{}'::uuid[]))) then
    raise exception 'question_not_in_session';
  end if;

  if p_flagged then
    insert into flagged_questions (user_id, question_id, session_id)
    select v_user, p_question, p_session
    where not exists (
      select 1 from flagged_questions
      where user_id = v_user and session_id = p_session and question_id = p_question
    );
  else
    delete from flagged_questions
     where user_id = v_user and session_id = p_session and question_id = p_question;
  end if;

  update qbank_sessions set last_activity_at = now()
   where id = p_session and status = 'active';

  return json_build_object('ok', true, 'flagged', p_flagged);
end;
$$;

revoke all on function public.set_question_flag(uuid, uuid, boolean) from public;
grant execute on function public.set_question_flag(uuid, uuid, boolean) to authenticated;

-- ── 5. list_unfinished_sessions ─────────────────────────────────────────────

create or replace function public.list_unfinished_sessions()
returns table (
  id uuid,
  mode text,
  system text,
  topic text,
  exam_mode text,
  started_at timestamptz,
  last_activity_at timestamptz,
  question_count int,
  expected_total int,
  answered_count int,
  flagged_count int,
  elapsed_ms bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  return query
  select
    s.id,
    s.mode,
    s.system,
    s.generation->>'topic',
    s.generation->>'examMode',
    s.started_at,
    s.last_activity_at,
    coalesce(array_length(s.question_ids, 1), 0),
    greatest(coalesce(s.expected_total, 0), coalesce(array_length(s.question_ids, 1), 0)),
    (select count(*)::int from user_attempts ua where ua.session_id = s.id),
    (select count(*)::int from flagged_questions f where f.session_id = s.id),
    s.elapsed_ms
  from qbank_sessions s
  where s.user_id = v_user
    and s.status = 'active'
  order by s.last_activity_at desc nulls last;
end;
$$;

revoke all on function public.list_unfinished_sessions() from public;
grant execute on function public.list_unfinished_sessions() to authenticated;

-- ── 6. resume_qbank_session ─────────────────────────────────────────────────
-- Everything the player needs to put the student back where they were.
--
-- previous_activity_at is the stamp BEFORE this call touched it. The client
-- uses it to avoid restarting generation on a set another device is actively
-- sitting (and so actively writing).
--
-- generation_max_index is the highest index this generation has written,
-- counting held-back rows. A wave cut off mid-stream can have committed rows
-- past the nextIndex the client last saved; resuming from that stale index
-- would write new questions over the same numbers.

create or replace function public.resume_qbank_session(p_session uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session qbank_sessions%rowtype;
  v_tutor boolean;
  v_questions json;
  v_max_index int;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  select * into v_session from qbank_sessions where id = p_session for update;
  if not found or v_session.user_id <> v_user then
    raise exception 'session_not_found';
  end if;
  if v_session.status <> 'active' then
    raise exception 'session_not_active';
  end if;

  v_tutor := coalesce(v_session.mode, 'tutor') <> 'timed';

  select json_agg(
           public.qbank_question_payload(
             ord.qid,
             v_tutor and exists (
               select 1 from user_attempts ua
               where ua.session_id = p_session and ua.question_id = ord.qid
             )
           )
           order by ord.n
         )
    into v_questions
  from unnest(coalesce(v_session.question_ids, '{}'::uuid[])) with ordinality as ord(qid, n)
  where exists (select 1 from questions q where q.id = ord.qid);

  if v_session.generation is not null and (v_session.generation->>'generationId') is not null then
    select max(
             case when generation_meta->>'index' ~ '^[0-9]+$'
                  then (generation_meta->>'index')::int end
           )
      into v_max_index
    from questions
    where origin = 'generated'
      and created_by = v_user
      and generation_meta->>'generationId' = v_session.generation->>'generationId';
  end if;

  update qbank_sessions set last_activity_at = now() where id = p_session;

  return json_build_object(
    'session', json_build_object(
      'id', v_session.id,
      'mode', coalesce(v_session.mode, 'tutor'),
      'system', v_session.system,
      'started_at', v_session.started_at,
      'current_index', v_session.current_index,
      'skipped_ids', coalesce(v_session.skipped_ids, '{}'::uuid[]),
      'elapsed_ms', v_session.elapsed_ms,
      'expected_total', v_session.expected_total,
      'generation', v_session.generation,
      'annotations', coalesce(v_session.annotations, '{}'::jsonb),
      'progress_seq', v_session.progress_seq,
      'previous_activity_at', v_session.last_activity_at
    ),
    'questions', coalesce(v_questions, '[]'::json),
    -- Tutor mode only. A timed set's selections are added by the timed-mode
    -- migration; its attempts do not exist until the block is ended.
    'answers', case when v_tutor then coalesce((
      select json_agg(json_build_object(
               'question_id', ua.question_id,
               'selected_option', ua.selected_option,
               'is_correct', ua.is_correct,
               'time_taken_ms', coalesce(ua.time_taken_ms, 0)
             ) order by ua.attempted_at)
      from user_attempts ua
      where ua.session_id = p_session
    ), '[]'::json) else '[]'::json end,
    'flagged', coalesce((
      select json_agg(f.question_id)
      from flagged_questions f
      where f.session_id = p_session
    ), '[]'::json),
    'generation_max_index', v_max_index
  );
end;
$$;

revoke all on function public.resume_qbank_session(uuid) from public;
grant execute on function public.resume_qbank_session(uuid) to authenticated;

-- ── 7. end_qbank_session: locked and idempotent ─────────────────────────────
-- Unchanged scoring. Two additions: the row is locked, so a finish cannot
-- interleave with a claim or a progress save; and finishing an already finished
-- set returns what it recorded instead of re-stamping ended_at.

create or replace function public.end_qbank_session(p_session uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session qbank_sessions%rowtype;
  v_score int;
  v_total int;
  v_time bigint;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  select * into v_session from qbank_sessions where id = p_session for update;
  if not found or v_session.user_id <> v_user then
    raise exception 'session_not_found';
  end if;

  if v_session.status = 'completed' then
    return json_build_object(
      'session_id', p_session,
      'score', v_session.score,
      'total', v_session.total,
      'total_time_ms', v_session.total_time_ms
    );
  end if;

  select
    count(*) filter (where is_correct),
    count(*),
    coalesce(sum(time_taken_ms), 0)
  into v_score, v_total, v_time
  from user_attempts
  where session_id = p_session;

  update qbank_sessions
    set status = 'completed',
        ended_at = now(),
        last_activity_at = now(),
        score = v_score,
        total = v_total,
        total_time_ms = v_time
    where id = p_session;

  return json_build_object(
    'session_id', p_session,
    'score', v_score,
    'total', v_total,
    'total_time_ms', v_time
  );
end;
$$;

revoke all on function public.end_qbank_session(uuid) from public;
grant execute on function public.end_qbank_session(uuid) to authenticated;

-- ── 8. get_session_review: mode, question count, omitted questions ──────────
-- Recreated from 20260909000000 with three additions. `omitted` carries the
-- answer key, so it is filled only for a completed set; a student calling this
-- mid-set gets an empty list, the same as before.

create or replace function public.get_session_review(p_session uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session qbank_sessions%rowtype;
  v_result json;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  select * into v_session from qbank_sessions where id = p_session;
  if not found or v_session.user_id <> v_user then
    raise exception 'session_not_found';
  end if;

  select json_build_object(
    'session', json_build_object(
      'score', v_session.score,
      'total', v_session.total,
      'total_time_ms', v_session.total_time_ms,
      'started_at', v_session.started_at,
      'ended_at', v_session.ended_at,
      'status', v_session.status,
      'mode', coalesce(v_session.mode, 'tutor'),
      'question_count', coalesce(array_length(v_session.question_ids, 1), 0)
    ),
    'attempts', coalesce((
      select json_agg(
        json_build_object(
          'question_id', ua.question_id,
          'selected_option', ua.selected_option,
          'is_correct', ua.is_correct,
          'time_taken_ms', ua.time_taken_ms,
          'question', public.qbank_question_payload(ua.question_id, true)
        ) order by ua.attempted_at
      )
      from user_attempts ua
      where ua.session_id = p_session
    ), '[]'::json),
    'omitted', case when v_session.status = 'completed' then coalesce((
      select json_agg(public.qbank_question_payload(ord.qid, true) order by ord.n)
      from unnest(coalesce(v_session.question_ids, '{}'::uuid[])) with ordinality as ord(qid, n)
      where exists (select 1 from questions q where q.id = ord.qid)
        and not exists (
          select 1 from user_attempts ua
          where ua.session_id = p_session and ua.question_id = ord.qid
        )
    ), '[]'::json) else '[]'::json end,
    'flagged', coalesce((
      select json_agg(question_id)
      from flagged_questions
      where session_id = p_session
    ), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_session_review(uuid) from public;
grant execute on function public.get_session_review(uuid) to authenticated;
