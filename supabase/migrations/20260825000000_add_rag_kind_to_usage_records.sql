-- Expand usage_records.kind CHECK constraint to support RAG quota tracking.
--
-- The original constraint (20260505154708) only allowed 'sheet' and 'cards'.
-- The rag-generate edge function now needs to track daily RAG usage via the
-- same consume_usage / refund_usage RPCs, which require kind = 'rag'.
--
-- consume_usage and refund_usage are generic (p_kind text) and require zero
-- changes. The only gatekeeper is this CHECK constraint.

ALTER TABLE public.usage_records
  DROP CONSTRAINT IF EXISTS usage_records_kind_check;

ALTER TABLE public.usage_records
  ADD CONSTRAINT usage_records_kind_check
  CHECK (kind IN ('sheet', 'cards', 'rag'));
