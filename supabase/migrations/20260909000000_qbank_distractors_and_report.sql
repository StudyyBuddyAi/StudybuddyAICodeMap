-- QBank tier 1: per-option explanations, and a report on how a set was checked.
--
-- Two things the generator already produces and the app then threw away.
--
-- 1. Distractor explanations. The prompt writes one per wrong option and the QA
--    gate blocks an item that omits any (`missing-distractor-explanation`), but
--    the `questions` table had a single `explanation` column, so qbank-persist
--    flattened them into a trailing "Why the others are wrong" text block. The
--    student got the words but not the association: nothing tied the sentence
--    about option C to option C, and the one explanation that matters most —
--    why the option THEY picked is wrong — was buried in the middle of a list.
--    A jsonb column keyed by option letter keeps the association, so the player
--    can put each explanation under its own option.
--
-- 2. The quality signals. Every generated row already carries its QA findings,
--    its blocked flag and the cold-answering pass's verdict in generation_meta,
--    and nothing ever read them back. get_generation_report aggregates them per
--    generation so a set can say what happened while it was written.
--
-- The new column joins correct_option/explanation/teaching_point behind the
-- REVOKE below: it is answer-key material and must reach the client only
-- through submit_answer (after the question is graded) or get_session_review
-- (owner, completed session).

-- ── 1. distractor_explanations ──────────────────────────────────────────────

alter table public.questions
  add column if not exists distractor_explanations jsonb;

comment on column public.questions.distractor_explanations is
  'Per-option "why this is wrong", keyed by option letter (a-e). The correct '
  'option has no entry. Null on curated rows and on generated rows written '
  'before this migration, whose explanation column still carries the composed '
  'text — readers must treat it as optional.';

-- Answer-key material. Same rule as the columns beside it.
revoke select (distractor_explanations) on public.questions from anon, authenticated;

-- ── 2. submit_answer: return the distractor explanations with the grade ─────
-- Unchanged except for the new field. The client already merges what this
-- returns onto its cached question.

create or replace function public.submit_answer(
  p_session uuid,
  p_question uuid,
  p_selected text,
  p_time_ms int
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session qbank_sessions%rowtype;
  v_correct text;
  v_explanation text;
  v_teaching text;
  v_distractors jsonb;
  v_is_correct boolean;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  select * into v_session from qbank_sessions where id = p_session;
  if not found or v_session.user_id <> v_user then
    raise exception 'session_not_found';
  end if;
  if v_session.status <> 'active' then
    raise exception 'session_not_active';
  end if;
  if not (p_question = any(v_session.question_ids)) then
    raise exception 'question_not_in_session';
  end if;
  if exists (
    select 1 from user_attempts
    where session_id = p_session and question_id = p_question
  ) then
    raise exception 'already_answered';
  end if;

  select correct_option, explanation, teaching_point, distractor_explanations
    into v_correct, v_explanation, v_teaching, v_distractors
  from questions where id = p_question;

  v_is_correct := (p_selected = v_correct);

  insert into user_attempts (
    user_id, question_id, selected_option, is_correct, time_taken_ms, session_id
  )
  values (v_user, p_question, p_selected, v_is_correct, p_time_ms, p_session);

  return json_build_object(
    'is_correct', v_is_correct,
    'correct_option', v_correct,
    'explanation', v_explanation,
    'teaching_point', v_teaching,
    'distractor_explanations', v_distractors
  );
end;
$$;

-- ── 3. get_session_review: same field, for the review pass ──────────────────
-- Recreated wholesale because the question object is built inline.

create or replace function public.get_session_review(p_session uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session qbank_sessions%rowtype;
  v_result json;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  select * into v_session from qbank_sessions where id = p_session;
  if not found or v_session.user_id <> v_user then
    raise exception 'session_not_found';
  end if;

  select json_build_object(
    'session', json_build_object(
      'score', v_session.score,
      'total', v_session.total,
      'total_time_ms', v_session.total_time_ms,
      'started_at', v_session.started_at,
      'ended_at', v_session.ended_at
    ),
    'attempts', coalesce((
      select json_agg(
        json_build_object(
          'question_id', ua.question_id,
          'selected_option', ua.selected_option,
          'is_correct', ua.is_correct,
          'time_taken_ms', ua.time_taken_ms,
          'question', json_build_object(
            'id', q.id,
            'subject', q.subject,
            'domain', q.domain,
            'topic', q.topic,
            'difficulty', q.difficulty,
            'competency', q.competency,
            'question_text', q.question_text,
            'option_a', q.option_a,
            'option_b', q.option_b,
            'option_c', q.option_c,
            'option_d', q.option_d,
            'option_e', q.option_e,
            'correct_option', q.correct_option,
            'explanation', q.explanation,
            'teaching_point', q.teaching_point,
            'distractor_explanations', q.distractor_explanations,
            'media', coalesce(m.media, '[]'::json)
          )
        ) order by ua.attempted_at
      )
      from user_attempts ua
      join questions q on q.id = ua.question_id
      left join lateral (
        select json_agg(
          json_build_object(
            'file_url', md.file_url,
            'media_type', md.media_type,
            'caption', qm.caption,
            'attribution', md.attribution,
            'license', md.license,
            'display_context', qm.display_context,
            'display_order', qm.display_order
          ) order by qm.display_order
        ) as media
        from question_media qm
        join media md on md.id = qm.media_id
        where qm.question_id = q.id
      ) m on true
      where ua.session_id = p_session
    ), '[]'::json),
    'flagged', coalesce((
      select json_agg(question_id)
      from flagged_questions
      where session_id = p_session
    ), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;

-- ── 4. get_generation_report ────────────────────────────────────────────────
-- What happened while a set was written, for the summary panel.
--
-- Scoped to the caller's own generated rows by created_by, so a guessed
-- generation id reveals nothing — the same access rule claim_generated_questions
-- uses. Counts only; no question text, no rule detail that quotes the item, and
-- above all no indication of WHICH question was blocked or disputed, since a
-- student may still be sitting the set when this is called.
--
-- `blocked` and `disputed` mirror the two filters claim_generated_questions
-- applies, so admitted + blocked + disputed accounts for every row written.
-- The verification test coalesces to true to match the verifier's fail-open
-- posture: an item whose probe never ran is not counted as disputed.

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
