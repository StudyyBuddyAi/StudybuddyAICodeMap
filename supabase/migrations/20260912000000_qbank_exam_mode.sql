-- QBank exam mode.
--
-- The generator can now write USMLE Step 1 items, Step 2 CK items, or a mixed
-- set. Every generated row records the concrete exam it was written on, so a
-- set can be filtered and analysed per exam and a Step 1 regression can be
-- separated from the new modes.
--
-- Additive only. No RPC signature changes; the two SECURITY DEFINER RPCs that
-- hand questions to the player (claim_generated_questions, start_qbank_session)
-- build explicit sanitized payloads and are deliberately untouched — mode is
-- reported at set level on the summary, not as a per-question badge.

-- ── 1. questions.exam_mode ──────────────────────────────────────────────────
-- CHECK-on-text, as the difficulty and reasoning_order columns are; there are
-- no Postgres enums in this schema. 'mixed' is deliberately not a legal value:
-- the column holds the track the item was WRITTEN on, and a mixed set yields
-- individually filterable step1 / step2ck rows. What the student ASKED for
-- lives in generation_meta.examMode. Null on curated rows, which predate the
-- generator and belong to no track.

alter table public.questions
  add column if not exists exam_mode text;

alter table public.questions
  drop constraint if exists questions_exam_mode_check;

alter table public.questions
  add constraint questions_exam_mode_check
  check (exam_mode in ('step1', 'step2ck'));

comment on column public.questions.exam_mode is
  'The USMLE exam a generated item was written on: step1 or step2ck. Never '
  'mixed — a mixed set stores the concrete track per row; the requested mode '
  'is generation_meta.examMode. Null on curated rows.';

-- Readable by the client. 20260708130000 revoked table-level SELECT on
-- questions and granted an explicit column list, so a new column is unreadable
-- until it is granted by name. This is not answer-key material.
grant select (exam_mode) on public.questions to anon, authenticated;

-- Every generated row written before this column existed was a Step 1 item:
-- the prompt could not write anything else.
update public.questions
   set exam_mode = 'step1'
 where origin = 'generated'
   and exam_mode is null;

-- ── 2. get_generation_report: name the exam ─────────────────────────────────
-- Unchanged except for `exam_mode`, which is read from generation_meta rather
-- than from the column: the report says what the student asked for, and for a
-- mixed set that is 'mixed', which the per-row column by design never holds.
-- Read off the rows rather than passed in, like `challenge`, so the report
-- describes what was actually written; null for a set that predates the mode.

create or replace function public.get_generation_report(p_generation_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_result json;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_generation_id is null or p_generation_id = '' then
    raise exception 'generation_id_required';
  end if;

  with gen_rows as (
    select
      coalesce((generation_meta->>'qaBlocked')::boolean, false) as blocked,
      coalesce((generation_meta->'verification'->>'agreed')::boolean, true) as agreed,
      generation_meta->'qa' as findings,
      generation_meta->'suggestedImage'->>'needed' as image_needed,
      generation_meta->>'challenge' as challenge,
      generation_meta->>'examMode' as exam_mode,
      reasoning_order
    from questions
    where origin = 'generated'
      and created_by = v_user
      and generation_meta->>'generationId' = p_generation_id
  )
  select json_build_object(
    'written', (select count(*) from gen_rows),
    'admitted', (select count(*) from gen_rows where not blocked and agreed),
    'blocked', (select count(*) from gen_rows where blocked),
    'disputed', (select count(*) from gen_rows where not blocked and not agreed),
    -- Questions the writer said would be clearer with a figure. There is no
    -- image library to draw one from yet, so this is reported rather than acted
    -- on — it is the honest version of "this item wants an ECG".
    'wants_image', (select count(*) from gen_rows where image_needed = 'Yes'),
    -- The level the set was asked for. Read off the rows rather than passed in,
    -- so the report describes what was actually written; null for a set written
    -- before the level existed.
    'challenge', (select max(challenge) from gen_rows),
    -- The exam the set was asked for: step1, step2ck or mixed.
    'exam_mode', (select max(exam_mode) from gen_rows),
    -- The reasoning-order mix the set came out at, counted over the questions
    -- that reached the student. This is what makes the Challenge control
    -- legible: it is the difference between asking for harder questions and
    -- seeing that you got them.
    'reasoning_mix', coalesce((
      select json_object_agg(reasoning_order, n)
      from (
        select reasoning_order, count(*) as n
        from gen_rows
        where not blocked and agreed
        group by reasoning_order
      ) m
    ), '{}'::json),
    -- Rule slugs and how often each fired, across every row this generation
    -- wrote — including rows that were admitted, since a finding that did not
    -- block is still a finding. The client maps slugs to labels via
    -- src/lib/qbank-rule-labels.ts.
    'findings', coalesce((
      select json_object_agg(rule, n)
      from (
        select f->>'rule' as rule, count(*) as n
        from gen_rows, lateral jsonb_array_elements(
          case when jsonb_typeof(findings) = 'array' then findings else '[]'::jsonb end
        ) f
        where f->>'rule' is not null
        group by f->>'rule'
      ) counted
    ), '{}'::json)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_generation_report(text) from public;
grant execute on function public.get_generation_report(text) to authenticated;
