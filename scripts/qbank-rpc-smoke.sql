-- QBank RPC smoke test — runs the whole session flow against a real database,
-- as a signed-in student, and ROLLS BACK. Nothing it does is kept.
--
-- Why this exists: the live schema has drifted from this repo's migrations more
-- than once (user_attempts.created_at vs the documented attempted_at broke
-- resume and review — see 20260916000000). Type checks and unit tests cannot
-- see that; calling the functions against the real tables can.
--
-- USAGE
--   1. Set the session id below to any ACTIVE session (the owner is looked up).
--      An active set of either mode works; pick one with at least one question.
--   2. npx supabase db query --linked -o table < scripts/qbank-rpc-smoke.sql
--
-- Expect one row per step. Any error aborts the transaction (still nothing is
-- kept) and the message names the step's function. Check in the output:
--   * 4/7: key_leak = false          (no answer key before grading, timed sets)
--   * 8/9: identical                 (end_qbank_session is idempotent)
--   * 10:  attempts >= 1, has_key    (review after the set ends)

begin;

create temp table smoke_params on commit drop as
select
  s.id as session_id,
  s.user_id,
  coalesce(s.mode, 'tutor') as mode,
  s.question_ids[1] as first_q,
  (
    select qid from unnest(s.question_ids) qid
    where not exists (select 1 from user_attempts ua where ua.session_id = s.id and ua.question_id = qid)
    limit 1
  ) as unanswered_q
from qbank_sessions s
where s.id = '00000000-0000-0000-0000-000000000000'::uuid  -- ← EDIT: an active session id
  and s.status = 'active';

create temp table smoke_out (step int, name text, out text) on commit drop;
grant select on smoke_params to authenticated;
grant insert, select on smoke_out to authenticated;

insert into smoke_out
select 0, 'params', coalesce((select json_agg(p)::text from smoke_params p), 'NO ACTIVE SESSION WITH THAT ID — edit the id above');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  (select json_build_object('sub', user_id, 'role', 'authenticated')::text from smoke_params),
  true
);

insert into smoke_out select 1, 'resume_qbank_session',
  left(public.resume_qbank_session(session_id)::text, 300) from smoke_params;

insert into smoke_out select 2, 'list_unfinished_sessions',
  (select json_agg(x)::text from public.list_unfinished_sessions() x where x.id = p.session_id) from smoke_params p;

-- Flags travel in the snapshot (20260917000000): first question flagged here.
insert into smoke_out select 3, 'save_qbank_progress (flags first question)',
  public.save_qbank_progress(session_id, (extract(epoch from now()) * 1000)::bigint + 1, 0, '{}', 1000, 5, null,
    '{"struck":{},"highlights":{}}'::jsonb, array[first_q])::text from smoke_params;

insert into smoke_out select 4, 'resume (key check, before answering)',
  'key_leak=' || (
    mode = 'timed' and position('correct_option' in public.resume_qbank_session(session_id)::text) > 0
  )::text from smoke_params;

insert into smoke_out select 5, 'set_question_flag (legacy, twice — must not raise)',
  public.set_question_flag(session_id, first_q, true)::text || ' ' || public.set_question_flag(session_id, first_q, true)::text
from smoke_params;

insert into smoke_out select 6, 'answer (' || mode || ')',
  case when mode = 'timed'
    then public.record_timed_answer(session_id, first_q, 'b', 4200)::text
    else coalesce(left(public.submit_answer(session_id, unanswered_q, 'b', 4200)::text, 120), 'no unanswered question to submit')
  end
from smoke_params where mode = 'timed' or unanswered_q is not null;

insert into smoke_out select 7, 'resume (after answering)',
  'selections=' || (r->'selections')::text || ' answers=' || json_array_length(r->'answers')
    || ' flagged=' || (r->'flagged')::text
    || ' key_leak=' || (mode = 'timed' and position('correct_option' in r::text) > 0)::text
from smoke_params, lateral (select public.resume_qbank_session(session_id) as r) x;

insert into smoke_out select 8, 'end_qbank_session', public.end_qbank_session(session_id)::text from smoke_params;
insert into smoke_out select 9, 'end_qbank_session (again)', public.end_qbank_session(session_id)::text from smoke_params;

insert into smoke_out select 10, 'get_session_review',
  (r->'session')::text || ' attempts=' || json_array_length(r->'attempts')
    || ' omitted=' || json_array_length(r->'omitted')
    || ' has_key=' || (position('correct_option' in (r->'attempts')::text) > 0)::text
from smoke_params, lateral (select public.get_session_review(session_id) as r) x;

select step, name, out from smoke_out order by step;

rollback;
