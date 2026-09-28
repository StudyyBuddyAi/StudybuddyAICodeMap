-- Sheets: a daily count for branch requests.
--
-- PROBLEM
--   medical-notes now takes a `branch` request — the branches a finished sheet
--   suggests, and each branch a student grows from one of its lines. It is
--   metered on its own daily count (120 for free and anonymous students; Pro
--   is exempt) through consume_usage / refund_usage. usage_records.kind is
--   constrained to 'sheet', 'cards' and 'section' (20260927000000), so
--   consume_usage(..., 'branch', ...) fails the constraint and the request is
--   refused with quota_check_failed.
--
-- CHANGE
--   Widen the kind constraint to allow 'branch'. No new table, column or
--   function. Apply after 20260927000000_section_usage.sql.
--
-- VERIFY
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.usage_records'::regclass and contype = 'c';
--   -- CHECK ((kind = ANY (ARRAY['sheet'::text, 'cards'::text, 'section'::text, 'branch'::text])))
--   As the service role: select public.consume_usage('<user id>', 'branch', 120);  -- {"allowed": true, ...}

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
  add constraint usage_records_kind_check check (kind in ('sheet', 'cards', 'section', 'branch'));
