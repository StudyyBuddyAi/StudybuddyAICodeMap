-- Server-side daily quota for on-demand QBank generation (qbank-generate).
--
-- consume_usage / refund_usage (20260708000000) are generic (p_kind text) and
-- are already EXECUTE-granted to service_role only, which is the client the
-- edge function uses. The sole gatekeeper for a new kind is the CHECK
-- constraint created by 20260505154708, widened here.
--
-- Idempotent (DROP IF EXISTS + ADD), additive-only. Live DB CHECK is currently
-- ('sheet','cards'); verify first:
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.usage_records'::regclass and contype = 'c';

ALTER TABLE public.usage_records
  DROP CONSTRAINT IF EXISTS usage_records_kind_check;

ALTER TABLE public.usage_records
  ADD CONSTRAINT usage_records_kind_check
  CHECK (kind IN ('sheet', 'cards', 'qbank_generate'));