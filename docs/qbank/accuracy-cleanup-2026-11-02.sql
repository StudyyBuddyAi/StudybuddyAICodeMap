-- One-off clean-up of live QBank rows found by the 2026-11-02 accuracy audit
-- (docs/qbank/accuracy-2026-11.md §2). Run AFTER migration
-- 20261103000000_qbank_held_questions.sql, which defines hold_generated_question:
--
--   npx supabase db query --linked -f docs/qbank/accuracy-cleanup-2026-11-02.sql
--
-- Idempotent: a second run holds nothing new and edits nothing.

-- 1. Withdraw the four served items read by hand as faulty. Each passed the
--    blind probe on its key, and each carried a probe objection that nothing
--    acted on at the time (now the `probe-concern` block).
select id, hold_generated_question(id, reason, 'audit-2026-11-02') as held_now
from (values
  ('0b653d2f-9ea3-45f0-8563-68ba4c7f42a6'::uuid,
   'qSOFA needs two criteria; the keyed finding gives one, so the stem does not meet the rule its explanation teaches.'),
  ('ff70e057-95ea-400a-93eb-ba3a28b8d0fa'::uuid,
   'Two defensible answers: the regimen holds an anthracycline and trastuzumab, and either explains the cardiomyopathy.'),
  ('0b0ab96b-9649-4492-b8ff-e62d8ad49308'::uuid,
   'Keyed answer names inadequate dietary iron; the stem''s cause is chronic menstrual blood loss.'),
  ('57d851d9-2b98-4378-8ba1-1c9bff446000'::uuid,
   'Options A and C both describe Charcot-Bouchard microaneurysms of the lenticulostriate perforators.')
) as t(id, reason);

-- 2. Correct a hundredfold unit error: serum ammonia written in μmol/dL in
--    seven urea-cycle items. The values (250–610) are realistic in μmol/L for
--    a neonatal or pediatric hyperammonemic crisis, so only the unit changes.
--    The edit is recorded on the row.
update questions
   set question_text = replace(question_text, 'μmol/dL', 'μmol/L'),
       generation_meta = coalesce(generation_meta, '{}'::jsonb) || jsonb_build_object(
         'edits', coalesce(generation_meta->'edits', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'at', now(), 'source', 'audit-2026-11-02', 'what', 'ammonia unit μmol/dL corrected to μmol/L'
         ))
       )
 where id in (
   'a8ca3ab0-ba37-4099-a0bb-920d78a9a173',
   'd457799a-777b-4e64-8fc6-a995c02eb221',
   'efbf0885-41d6-4f67-9434-2c0c4f7d6a76',
   '7a170752-7e22-45e1-9481-64a67d7de511',
   'd45dcc78-0e1d-4cd9-9c0d-df2c73290281',
   '9668f264-6b71-412f-918d-eeb0ebb00a4c',
   '5112eabb-0608-4fe6-9983-e009518f2f98'
 )
   and question_text like '%μmol/dL%';
