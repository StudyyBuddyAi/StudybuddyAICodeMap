-- The review queue: questions a student missed or marked, offered back to them.
--
-- Every QBank set used to be disposable. A missed question was explained once
-- and never seen again, and a mark (29 of them across 9 students by
-- 2026-10-30) was read by nothing after the summary. Generated questions are
-- private to the student who asked for them, so re-sitting one costs no
-- generation and never counts against the free allowance.
--
-- What is due:
--   - missed: the student's latest attempt at the question is wrong, and that
--     attempt is at least 20 hours old. Spaced on purpose — re-answering a
--     question minutes after reading its explanation tests short-term memory,
--     not learning. Twenty hours rather than twenty-four so that tomorrow's
--     session at the same time already includes today's misses. Answering it
--     correctly takes it off the queue; missing it again restarts the clock.
--   - marked: flagged in the set where it was last answered (or never answered
--     at all). Due at once: the student asked to see it again. Answering it in
--     a later set without marking it again clears it.
-- Left out: questions the student can no longer reach, and questions they
-- reported as wrong, outdated or unclear (re-serving those would be insulting
-- until the report is settled).
--
-- Re-sitting goes through start_qbank_session's explicit-ids branch, which
-- already admits a student's own generated rows. The client labels those
-- sessions system = 'Review'.
--
-- Additive only.

create or replace function public.get_qbank_review_queue()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_spacing interval := interval '20 hours';
  v_result json;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  with latest as (
    select distinct on (ua.question_id)
      ua.question_id, ua.is_correct, ua.created_at, ua.session_id
    from user_attempts ua
    where ua.user_id = v_user
    order by ua.question_id, ua.created_at desc
  ),
  marked as (
    select fq.question_id, max(fq.flagged_at) as flagged_at
    from flagged_questions fq
    left join latest l on l.question_id = fq.question_id
    where fq.user_id = v_user
      and (l.question_id is null or fq.session_id = l.session_id or fq.flagged_at > l.created_at)
    group by fq.question_id
  ),
  candidates as (
    select
      coalesce(l.question_id, m.question_id) as question_id,
      (l.question_id is not null and l.is_correct = false) as missed,
      (m.question_id is not null) as is_marked,
      greatest(l.created_at, m.flagged_at) as last_seen_at,
      l.created_at as missed_at
    from latest l
    full join marked m on m.question_id = l.question_id
  ),
  reachable as (
    select c.*, q.subject, q.domain, q.topic
    from candidates c
    join questions q on q.id = c.question_id
    where (c.missed or c.is_marked)
      and (q.is_active = true or (q.origin = 'generated' and q.created_by = v_user))
      and not exists (
        select 1 from question_reports qr
        where qr.user_id = v_user
          and qr.question_id = c.question_id
          and qr.status = 'open'
          and qr.reason in ('wrong_key', 'outdated', 'unclear')
      )
  ),
  due as (
    select *,
      case when missed and is_marked then 'both' when missed then 'missed' else 'marked' end as reason
    from reachable
    where is_marked or missed_at <= now() - v_spacing
  ),
  upcoming as (
    select * from reachable
    where missed and not is_marked and missed_at > now() - v_spacing
  )
  select json_build_object(
    'due', coalesce((
      select json_agg(json_build_object(
        'question_id', d.question_id,
        'reason', d.reason,
        'last_seen_at', d.last_seen_at,
        'subject', d.subject,
        'domain', d.domain,
        'topic', d.topic
      ) order by d.last_seen_at asc nulls first)
      from (select * from due order by last_seen_at asc nulls first limit 200) d
    ), '[]'::json),
    'due_count', (select count(*) from due),
    'missed_due', (select count(*) from due where missed),
    'marked', (select count(*) from due where is_marked),
    'upcoming', (select count(*) from upcoming),
    'next_due_at', (select min(missed_at) + v_spacing from upcoming)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_qbank_review_queue() from public, anon;
grant execute on function public.get_qbank_review_queue() to authenticated;
