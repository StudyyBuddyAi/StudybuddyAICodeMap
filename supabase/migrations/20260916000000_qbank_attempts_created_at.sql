-- QBank: order attempts by created_at — attempted_at does not exist live.
--
-- PROBLEM
--   The retrofit DDL in 20260808140000 documents user_attempts.attempted_at, and
--   src/integrations/supabase/types.ts followed it. The live table has never had
--   that column: its timestamp is `created_at` (timestamptz, default now()).
--   Verified with information_schema.columns on the linked project.
--
--   Two functions order attempts by the missing column, and both raise
--   `42703: column ua.attempted_at does not exist` on every call:
--
--   * resume_qbank_session (20260914000000 / 20260915000000). Every resume
--     failed — a refresh, Save & Exit then Resume, opening a set on another
--     device — so the player showed "This set couldn't be loaded", and a set
--     still being written stopped where the page reloaded.
--
--   * get_session_review. Broken BEFORE the resume work too: the deployed body
--     it replaced also ordered by ua.attempted_at. The summary page fell back to
--     the in-memory summary when the RPC errored, which hid it for tutor sets
--     finished in the same tab. Summary deep links, history, and every timed
--     set (which has no in-memory summary) could not load results.
--
-- CHANGE
--   Both functions recreated verbatim from their latest definitions, with the
--   one token ua.attempted_at -> ua.created_at. Signatures are unchanged, so no
--   overload is created. The fix was exercised end to end against the live
--   database, as a signed-in user, inside a rolled-back transaction before this
--   file was written (see scripts/qbank-rpc-smoke.sql).

-- ── resume_qbank_session ────────────────────────────────────────────────────
-- From 20260915000000_qbank_timed_mode.sql.

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
             ) order by ua.created_at)
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

-- ── get_session_review ──────────────────────────────────────────────────────
-- From 20260914000000_qbank_resume_progress.sql.

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
        ) order by ua.created_at
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
