-- Sheets: a daily count for section requests.
--
-- PROBLEM
--   medical-notes now takes a `section` request — deepen one section of a
--   sheet, deepen a whole sheet, or rewrite one section in a direction the
--   student picks. It is metered on its own daily count (15 for free and
--   anonymous students; Pro is exempt), separate from sheets, through the same
--   consume_usage / refund_usage RPCs. usage_records.kind is constrained to
--   'sheet' and 'cards', so consume_usage(..., 'section', ...) fails the
--   constraint and the request is refused with quota_check_failed.
--
-- CHANGE
--   Widen the kind constraint to allow 'section'. No new table, column or
--   function; consume_usage / refund_usage already take any kind.
--
--   The constraint was created inline, so its name is Postgres's default; the
--   drop looks it up rather than assuming it, in case the live table was
--   created with a different one.
--
-- VERIFY
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.usage_records'::regclass and contype = 'c';
--   -- CHECK ((kind = ANY (ARRAY['sheet'::text, 'cards'::text, 'section'::text])))
--   As the service role: select public.consume_usage('<user id>', 'section', 15);  -- {"allowed": true, ...}

do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.usage_records'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.usage_records drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.usage_records
  add constraint usage_records_kind_check check (kind in ('sheet', 'cards', 'section'));
