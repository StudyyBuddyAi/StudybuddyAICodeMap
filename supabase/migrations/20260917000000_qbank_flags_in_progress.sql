-- QBank: flags travel with the ordered progress snapshot, not one request each.
--
-- PROBLEM
--   Flagging felt inconsistent: a flag would come back after being cleared, or
--   clear itself a moment after being set. Reproduced client-side against the
--   real QBankProvider with a latency-jittered fake server
--   (src/contexts/QBankContext.flags.test.tsx), three causes:
--
--   1. Out-of-order requests. Every toggle was its own set_question_flag call.
--      Flag then unflag, with the first request slower, landed as unflag then
--      flag — the screen said unflagged, the table said flagged, and the next
--      resume showed it flagged again.
--   2. A non-atomic insert. set_question_flag did `insert ... where not
--      exists`. Two overlapping "flag" calls (flag, unflag, flag quickly) both
--      passed the check and the second hit the unique constraint; the client
--      read that as failure and rolled the student's flag back.
--   3. Unawaited writes. Save & Exit and End block did not wait for flag calls
--      in flight, and a refresh could cancel them outright.
--
-- CHANGE
--   save_qbank_progress takes the set's complete flag list, p_flagged_ids, and
--   reconciles flagged_questions to it. The snapshot is already serialised on
--   the client, ordered by p_seq on the server (a stale one is rejected), sent
--   with keepalive when the page is hidden, and flushed by Save & Exit and End
--   block — so flags inherit all of that. Reconciling to a list is idempotent:
--   the same snapshot twice, or two devices, cannot collide.
--
--   p_flagged_ids null leaves flags untouched, so an older client that does not
--   send it keeps working. The old 8-argument signature is dropped: adding an
--   argument creates a new overload, and PostgREST would otherwise have two
--   candidates for the same named call.
--
--   set_question_flag stays for compatibility, now with `on conflict do nothing`
--   so concurrent calls cannot raise.

-- ── 1. save_qbank_progress with p_flagged_ids ───────────────────────────────

drop function if exists public.save_qbank_progress(uuid, bigint, int, uuid[], bigint, int, jsonb, jsonb);

create or replace function public.save_qbank_progress(
  p_session uuid,
  p_seq bigint,
  p_current_index int,
  p_skipped_ids uuid[],
  p_elapsed_ms bigint,
  p_expected_total int,
  p_generation jsonb,
  p_annotations jsonb,
  p_flagged_ids uuid[] default null
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

  -- The set's flags are exactly the list sent. Only questions in the set count.
  if p_flagged_ids is not null then
    delete from flagged_questions f
     where f.session_id = p_session
       and f.user_id = v_user
       and not (f.question_id = any(p_flagged_ids));

    insert into flagged_questions (user_id, question_id, session_id)
    select distinct v_user, qid, p_session
    from unnest(p_flagged_ids) as qid
    where qid = any(coalesce(v_session.question_ids, '{}'::uuid[]))
    on conflict (user_id, session_id, question_id) do nothing;
  end if;

  return json_build_object('ok', true, 'seq', p_seq);
end;
$$;

revoke all on function public.save_qbank_progress(uuid, bigint, int, uuid[], bigint, int, jsonb, jsonb, uuid[]) from public;
grant execute on function public.save_qbank_progress(uuid, bigint, int, uuid[], bigint, int, jsonb, jsonb, uuid[]) to authenticated;

-- ── 2. set_question_flag: atomic insert ─────────────────────────────────────

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
    values (v_user, p_question, p_session)
    on conflict (user_id, session_id, question_id) do nothing;
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
