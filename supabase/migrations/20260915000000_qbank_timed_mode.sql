-- QBank: Timed mode — answers and explanations withheld until the block ends.
--
-- PROBLEM
--   qbank_sessions.mode ('tutor' | 'timed') and start_qbank_session's p_mode
--   exist on the live database, but nothing behind them does: submit_answer
--   grades and returns the key the moment an option is chosen, which is tutor
--   mode by definition. A timed block needs the opposite — a selection the
--   student can change, kept without grading, and graded all at once when the
--   block ends.
--
-- WHAT THIS ADDS
--   * qbank_timed_selections: the current choice per question for a timed set.
--   * record_timed_answer: set or clear that choice. Never reads `questions`,
--     so it cannot return key material even by mistake.
--   * submit_answer refuses a timed set. Without this, a client could call it
--     directly and read the key mid-block.
--   * end_qbank_session grades a timed set's selections into user_attempts
--     under the row lock, so the summary, review and history read a finished
--     timed set exactly like a tutor one.
--   * resume_qbank_session returns a timed set's selections (no key).
--   * list_unfinished_sessions counts a timed set's selections as answered.
--
-- Depends on 20260914000000_qbank_resume_progress.sql (qbank_question_payload,
-- the progress columns, the locked/idempotent end_qbank_session).
--
-- VERIFY BEFORE APPLYING
--   submit_answer is recreated from 20260909000000. Confirm the live body with
--     select pg_get_functiondef('public.submit_answer(uuid,uuid,text,integer)'::regprocedure);

-- ── 1. qbank_timed_selections ───────────────────────────────────────────────

create table if not exists public.qbank_timed_selections (
  session_id uuid not null references public.qbank_sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  selected_option text not null check (selected_option in ('a', 'b', 'c', 'd', 'e')),
  time_taken_ms int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (session_id, question_id)
);

alter table public.qbank_timed_selections enable row level security;

-- Readable by the owner; written only through record_timed_answer.
drop policy if exists "Users can view own timed selections" on public.qbank_timed_selections;
create policy "Users can view own timed selections"
  on public.qbank_timed_selections for select
  to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.qbank_timed_selections from anon, authenticated;

-- ── 2. record_timed_answer ──────────────────────────────────────────────────
-- p_selected null clears the choice. p_time_ms is the total time the student
-- has spent on the question so far; the larger value wins, so a late request
-- cannot shrink it.

create or replace function public.record_timed_answer(
  p_session uuid,
  p_question uuid,
  p_selected text,
  p_time_ms int
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

  select * into v_session from qbank_sessions where id = p_session for update;
  if not found or v_session.user_id <> v_user then
    raise exception 'session_not_found';
  end if;
  if v_session.status <> 'active' then
    raise exception 'session_not_active';
  end if;
  if coalesce(v_session.mode, 'tutor') <> 'timed' then
    raise exception 'not_timed_session';
  end if;
  if not (p_question = any(coalesce(v_session.question_ids, '{}'::uuid[]))) then
    raise exception 'question_not_in_session';
  end if;

  if p_selected is null then
    delete from qbank_timed_selections
     where session_id = p_session and question_id = p_question;
  else
    if p_selected not in ('a', 'b', 'c', 'd', 'e') then
      raise exception 'invalid_option';
    end if;

    insert into qbank_timed_selections (session_id, question_id, user_id, selected_option, time_taken_ms)
    values (p_session, p_question, v_user, p_selected, greatest(coalesce(p_time_ms, 0), 0))
    on conflict (session_id, question_id) do update
      set selected_option = excluded.selected_option,
          time_taken_ms = greatest(qbank_timed_selections.time_taken_ms, excluded.time_taken_ms),
          updated_at = now();
  end if;

  update qbank_sessions set last_activity_at = now() where id = p_session;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.record_timed_answer(uuid, uuid, text, int) from public;
grant execute on function public.record_timed_answer(uuid, uuid, text, int) to authenticated;

-- ── 3. submit_answer: refuse a timed set ────────────────────────────────────
-- Recreated from 20260909000000; the only change is the timed_session guard.

create or replace function public.submit_answer(
  p_session uuid,
  p_question uuid,
  p_selected text,
  p_time_ms int
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session qbank_sessions%rowtype;
  v_correct text;
  v_explanation text;
  v_teaching text;
  v_distractors jsonb;
  v_is_correct boolean;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  select * into v_session from qbank_sessions where id = p_session;
  if not found or v_session.user_id <> v_user then
    raise exception 'session_not_found';
  end if;
  if v_session.status <> 'active' then
    raise exception 'session_not_active';
  end if;
  -- Grading returns the key. A timed set must not be graded until it ends.
  if coalesce(v_session.mode, 'tutor') = 'timed' then
    raise exception 'timed_session';
  end if;
  if not (p_question = any(v_session.question_ids)) then
    raise exception 'question_not_in_session';
  end if;
  if exists (
    select 1 from user_attempts
    where session_id = p_session and question_id = p_question
  ) then
    raise exception 'already_answered';
  end if;

  select correct_option, explanation, teaching_point, distractor_explanations
    into v_correct, v_explanation, v_teaching, v_distractors
  from questions where id = p_question;

  v_is_correct := (p_selected = v_correct);

  insert into user_attempts (
    user_id, question_id, selected_option, is_correct, time_taken_ms, session_id
  )
  values (v_user, p_question, p_selected, v_is_correct, p_time_ms, p_session);

  update qbank_sessions set last_activity_at = now() where id = p_session;

  return json_build_object(
    'is_correct', v_is_correct,
    'correct_option', v_correct,
    'explanation', v_explanation,
    'teaching_point', v_teaching,
    'distractor_explanations', v_distractors
  );
end;
$$;

revoke all on function public.submit_answer(uuid, uuid, text, int) from public;
grant execute on function public.submit_answer(uuid, uuid, text, int) to authenticated;

-- ── 4. end_qbank_session: grade a timed block ───────────────────────────────
-- The completed-status early return (from 20260914000000) is what makes the
-- grading step safe to reach twice; the not-exists guard covers a set that was
-- partly graded by some earlier path.

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

  if coalesce(v_session.mode, 'tutor') = 'timed' then
    insert into user_attempts (
      user_id, question_id, selected_option, is_correct, time_taken_ms, session_id
    )
    select
      v_user,
      ts.question_id,
      ts.selected_option,
      ts.selected_option = q.correct_option,
      ts.time_taken_ms,
      p_session
    from qbank_timed_selections ts
    join questions q on q.id = ts.question_id
    where ts.session_id = p_session
      and not exists (
        select 1 from user_attempts ua
        where ua.session_id = p_session and ua.question_id = ts.question_id
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

-- ── 5. resume_qbank_session: selections for a timed set ─────────────────────
-- Recreated from 20260914000000. A timed set gets `selections` and never a key.

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
    'selections', case when v_tutor then '[]'::json else coalesce((
      select json_agg(json_build_object(
               'question_id', ts.question_id,
               'selected_option', ts.selected_option,
               'time_taken_ms', ts.time_taken_ms
             ) order by ts.updated_at)
      from qbank_timed_selections ts
      where ts.session_id = p_session
    ), '[]'::json) end,
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

-- ── 6. list_unfinished_sessions: count timed selections ─────────────────────

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
    case when coalesce(s.mode, 'tutor') = 'timed'
      then (select count(*)::int from qbank_timed_selections ts where ts.session_id = s.id)
      else (select count(*)::int from user_attempts ua where ua.session_id = s.id)
    end,
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
