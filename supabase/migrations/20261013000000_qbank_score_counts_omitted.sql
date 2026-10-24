-- QBank: a question left unanswered counts against the score.
--
-- end_qbank_session stores total = count(user_attempts), so a set ended with
-- questions unanswered was scored on what was attempted alone: one right of
-- ten read as 1/1, 100%. NBME and UWorld score an omitted item as wrong, and so
-- does this. total becomes the number of questions the set held.
--
-- Done as a trigger on the row rather than by recreating end_qbank_session:
-- the live function body has drifted ahead of the repo before, and every path
-- that completes a session writes this row. score is untouched.

-- The questions a set held, counted the way get_session_review lists its
-- omitted ones: ids that still resolve to a question.
create or replace function public.qbank_session_item_count(p_question_ids uuid[])
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct ord.qid)::int
  from unnest(coalesce(p_question_ids, '{}'::uuid[])) as ord(qid)
  where exists (select 1 from questions q where q.id = ord.qid);
$$;

create or replace function public.qbank_sessions_count_omitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' then
    new.total := greatest(coalesce(new.total, 0), public.qbank_session_item_count(new.question_ids));
  end if;
  return new;
end;
$$;

drop trigger if exists qbank_sessions_count_omitted on public.qbank_sessions;
create trigger qbank_sessions_count_omitted
  before insert or update of status, total, question_ids on public.qbank_sessions
  for each row execute function public.qbank_sessions_count_omitted();

-- Internal: neither is an RPC.
revoke all on function public.qbank_session_item_count(uuid[]) from public, anon, authenticated;
revoke all on function public.qbank_sessions_count_omitted() from public, anon, authenticated;

-- Past sets, rescored the same way. Writing total fires the trigger, which
-- applies the same rule; the explicit value keeps this readable on its own.
update public.qbank_sessions s
   set total = public.qbank_session_item_count(s.question_ids)
 where s.status = 'completed'
   and coalesce(s.total, 0) < public.qbank_session_item_count(s.question_ids);
