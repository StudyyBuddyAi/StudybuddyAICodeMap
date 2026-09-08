-- Incremental generation: let a live session grow as questions are written.
--
-- Until now a generated session was all-or-nothing. start_qbank_session fixed
-- question_ids at creation, so the student could not be handed anything until
-- the whole batch had been written, gated, verified and inserted — about ninety
-- seconds for five items, and proportionally worse for twenty. The batch is now
-- persisted one question at a time as each closes, and the session is started
-- from the first one, so the wait is one item rather than the whole set.
--
-- That makes reconciliation the hard part, not generation. A question can be
-- written to the table and never reach the session: the SSE connection drops,
-- the browser is refreshed, the student navigates away, or the edge isolate is
-- torn down by the wall clock after the insert but before the closing frame.
-- In every one of those cases the row is already committed and paid for, and
-- the only thing lost is the client's knowledge of its id.
--
-- So the client is deliberately not trusted to track ids. It mints a
-- generationId before the first request, every row it causes carries that id in
-- generation_meta, and this function is the single way questions enter a
-- session. It is idempotent and driven entirely by server-side state, which
-- means the recovery path and the happy path are the same call: after a crash
-- the client re-issues it and the session catches up with whatever was written
-- while it was gone. Nothing that reached the table is ever stranded.
--
-- Additive only: start_qbank_session, submit_answer and end_qbank_session are
-- untouched. end_qbank_session already computes score and total from
-- user_attempts rather than from question_ids, so a session that ends short
-- because generation degraded already reports itself honestly.

-- The claim lookup is by generationId over one user's generated rows. Partial,
-- because curated rows have no generation_meta and are the bulk of the table.
create index if not exists idx_questions_generation_id
  on public.questions ((generation_meta->>'generationId'))
  where origin = 'generated';

create or replace function public.claim_generated_questions(
  p_session uuid,
  p_generation_id text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session qbank_sessions%rowtype;
  v_new_ids uuid[];
  v_questions json;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_generation_id is null or p_generation_id = '' then
    raise exception 'generation_id_required';
  end if;

  -- Locked for the duration. Questions arrive from a wave loop that can have
  -- more than one claim in flight — a stream frame and a resume sweep, say —
  -- and without the lock both would read the same question_ids, both compute
  -- the same "not yet in the session" set, and both append it. The student
  -- would sit the same question twice.
  select * into v_session from qbank_sessions where id = p_session for update;
  if not found or v_session.user_id <> v_user then
    raise exception 'session_not_found';
  end if;

  -- A completed session is closed to new questions. The student pressed finish;
  -- a wave still in flight must not reopen a scored session behind their back.
  if v_session.status <> 'active' then
    raise exception 'session_not_active';
  end if;

  -- Everything this generation has written that is not already in the session.
  --
  -- created_by is the access control: the same rule the explicit-ids branch of
  -- start_qbank_session uses, so one user can never pull another's generated
  -- rows into a session even by guessing a generationId.
  --
  -- Held-back rows are skipped, on both signals the writer records: the QA
  -- gate's block, and the cold-answering pass disagreeing with the key. The
  -- generate page used to apply exactly this filter in the browser before
  -- handing ids to start_qbank_session. Now that questions reach a session only
  -- through here, the filter has to live here too — otherwise a recovery claim
  -- would quietly admit items the happy path refuses.
  --
  -- The verification test coalesces to true, matching the verifier's own
  -- fail-open posture: an item whose probe errored or never ran is not held
  -- back for it.
  --
  -- Ordered by the generation index so the student meets the questions in the
  -- order the batch plan intended, with created_at as the tie-break and a
  -- guarded cast so a malformed index sorts last instead of raising.
  select array_agg(id order by sort_index, created_at, id)
    into v_new_ids
  from (
    select
      id,
      created_at,
      case
        when generation_meta->>'index' ~ '^[0-9]+$'
          then (generation_meta->>'index')::int
        else 2147483647
      end as sort_index
    from questions
    where origin = 'generated'
      and created_by = v_user
      and generation_meta->>'generationId' = p_generation_id
      and coalesce((generation_meta->>'qaBlocked')::boolean, false) = false
      and coalesce((generation_meta->'verification'->>'agreed')::boolean, true) = true
      and not (id = any(coalesce(v_session.question_ids, '{}'::uuid[])))
  ) fresh;

  if v_new_ids is null or array_length(v_new_ids, 1) is null then
    return json_build_object('added', '[]'::json, 'total', coalesce(array_length(v_session.question_ids, 1), 0));
  end if;

  update qbank_sessions
     set question_ids = coalesce(question_ids, '{}'::uuid[]) || v_new_ids
   where id = p_session
   returning question_ids into v_session.question_ids;

  -- Same payload shape start_qbank_session returns, answer key excluded, so the
  -- client appends these straight onto session.questions with no second mapping.
  select json_agg(payload order by ord) into v_questions
  from (
    select
      ord.ord as ord,
      json_build_object(
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
        'media', coalesce(m.media, '[]'::json)
      ) as payload
    from unnest(v_new_ids) with ordinality as ord(qid, ord)
    join questions q on q.id = ord.qid
    left join lateral (
      select json_agg(
        json_build_object(
          'file_url', md.file_url,
          'media_type', md.media_type,
          'caption', qm.caption,
          'attribution', md.attribution,
          'license', md.license,
          'display_context', qm.display_context,
          'display_order', qm.display_order
        ) order by qm.display_order
      ) as media
      from question_media qm
      join media md on md.id = qm.media_id
      where qm.question_id = q.id
    ) m on true
  ) ordered;

  return json_build_object(
    'added', coalesce(v_questions, '[]'::json),
    'total', coalesce(array_length(v_session.question_ids, 1), 0)
  );
end;
$$;

revoke all on function public.claim_generated_questions(uuid, text) from public;
grant execute on function public.claim_generated_questions(uuid, text) to authenticated;
