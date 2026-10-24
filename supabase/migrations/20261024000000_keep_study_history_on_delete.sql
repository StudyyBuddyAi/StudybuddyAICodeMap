-- Study history outlives what it was studied in.
--
-- review_sessions.card_id and user_attempts.session_id were ON DELETE CASCADE,
-- so deleting a flashcard deck erased every review of its cards, and deleting
-- a QBank set erased every answer in it. The dashboard counts both — reviews
-- and ratings in the last seven days, QBank accuracy, and the day streak — so
-- one delete rewrote the student's past: three study days became one, and
-- deleting the last deck or set took the streak to zero even on days spent in
-- another tool.
--
-- From here on the history row stays and loses only its link: the card or set
-- is gone, the fact that the student studied that day is not. Rows of a
-- deleted account still go with the account (user_id is unchanged, CASCADE).
--
-- Constraint names are looked up rather than assumed, so this applies cleanly
-- whatever the original CREATE TABLE named them.

do $$
declare
  fk record;
begin
  for fk in
    select con.conname, rel.relname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
    where nsp.nspname = 'public'
      and con.contype = 'f'
      and (
        (rel.relname = 'review_sessions' and att.attname = 'card_id')
        or (rel.relname = 'user_attempts' and att.attname = 'session_id')
      )
  loop
    execute format('alter table public.%I drop constraint %I', fk.relname, fk.conname);
  end loop;
end $$;

alter table public.review_sessions
  alter column card_id drop not null,
  add constraint review_sessions_card_id_fkey
    foreign key (card_id) references public.cards(id) on delete set null;

alter table public.user_attempts
  add constraint user_attempts_session_id_fkey
    foreign key (session_id) references public.qbank_sessions(id) on delete set null;

comment on column public.review_sessions.card_id is
  'The card reviewed; NULL once the card (or its deck) is deleted. The review itself is kept for stats and streaks.';
comment on column public.user_attempts.session_id is
  'The QBank set answered in; NULL once the set is deleted. The answer itself is kept for stats and streaks.';
