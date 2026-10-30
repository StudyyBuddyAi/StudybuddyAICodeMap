-- Report a problem with a question.
--
-- Until now the only quality loop on a QBank item was the machine one — the QA
-- gate, the blind second read, and (since 2026-10-30) the writer-flag fact
-- check. Nothing let the student who just sat an item say "the key is wrong"
-- or "this is out of date", and the shared question pool being designed in
-- docs/qbank/shared-pool-design.md cannot exist without that signal: it is
-- what demotes a bad item before it reaches the next hundred students.
--
-- One report per student per question; reporting again replaces the earlier
-- one and reopens it. A student may only report a question they were actually
-- served (it is in one of their sessions), which is the same evidence the
-- grading RPCs rely on. Writes go through report_question; the table itself is
-- readable only by its author, and triage is a service-role job for now.
--
-- Additive only.

create table if not exists public.question_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  session_id uuid references public.qbank_sessions (id) on delete set null,
  reason text not null
    check (reason in ('wrong_key', 'outdated', 'unclear', 'typo', 'other')),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'open'
    check (status in ('open', 'accepted', 'rejected', 'fixed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (user_id, question_id)
);

comment on table public.question_reports is
  'A student''s report of a problem with a QBank question. Written only through '
  'report_question(); triaged by service role. Feeds the shared pool''s item '
  'state (docs/qbank/shared-pool-design.md).';

create index if not exists idx_question_reports_question
  on public.question_reports (question_id);
create index if not exists idx_question_reports_open
  on public.question_reports (created_at)
  where status = 'open';

alter table public.question_reports enable row level security;

drop policy if exists "Users read own question reports" on public.question_reports;
create policy "Users read own question reports"
  on public.question_reports for select
  using (auth.uid() = user_id);

create or replace function public.report_question(
  p_question uuid,
  p_reason text,
  p_note text default null,
  p_session uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_session uuid;
  v_id uuid;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_reason is null or p_reason not in ('wrong_key', 'outdated', 'unclear', 'typo', 'other') then
    raise exception 'reason_invalid';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'note_too_long';
  end if;

  -- Served to this student: the question is in one of their sessions. The
  -- session the client names is used when it qualifies; otherwise the most
  -- recent one that does is recorded, so the report still points somewhere.
  select s.id into v_session
    from qbank_sessions s
   where s.user_id = v_user
     and p_question = any (coalesce(s.question_ids, '{}'::uuid[]))
   order by (s.id = p_session) desc, s.started_at desc
   limit 1;

  if v_session is null then raise exception 'question_not_served'; end if;

  insert into question_reports (user_id, question_id, session_id, reason, note)
  values (v_user, p_question, v_session, p_reason, v_note)
  on conflict (user_id, question_id) do update
     set reason = excluded.reason,
         note = excluded.note,
         session_id = excluded.session_id,
         status = 'open',
         resolved_at = null,
         created_at = now()
  returning id into v_id;

  return json_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.report_question(uuid, text, text, uuid) from public, anon;
grant execute on function public.report_question(uuid, text, text, uuid) to authenticated;
