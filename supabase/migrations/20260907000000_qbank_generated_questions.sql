-- On-demand QBank generation: generated questions live in `questions` (00 / qbank-ondemand)
--
-- Generated items have to be persisted before they can be answered — submit_answer
-- grades server-side against a stored row — so rather than build a parallel table
-- with parallel RPCs, generated items land in `questions` and reuse the entire
-- existing session engine (start_qbank_session → submit_answer → get_session_review).
--
-- They are written is_active = false, which the random-sampling branch of
-- start_qbank_session already filters out, so a generated row can never leak into
-- a curated session or into the landing-page counts. Only the explicit-ids branch
-- (built for "redo flagged") needs widening so an owner can play their own items.
--
-- Additive only, per the repo convention. Verify live column state before applying.

-- ── Provenance columns ──────────────────────────────────────────────────────
-- origin defaults to 'curated' so the 120 existing hand-authored rows stay valid
-- without a backfill. generation_meta carries the audit trail the model produced
-- (reasoning chain, self-check, reviewer flag, verifier verdict, prompt version)
-- — kept out of the question columns proper so nothing reaches the player.
alter table public.questions
  add column if not exists origin text not null default 'curated',
  add column if not exists created_by uuid references auth.users(id) on delete cascade,
  add column if not exists generation_meta jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'questions_origin_check'
  ) then
    alter table public.questions
      add constraint questions_origin_check check (origin in ('curated', 'generated'));
  end if;
end $$;

-- Partial index: the only query shape against generated rows is "this user's
-- items, newest first". Curated rows are excluded so the index stays small.
create index if not exists idx_questions_created_by
  on public.questions (created_by, created_at desc)
  where origin = 'generated';

-- ── start_qbank_session: let owners play their own generated items ──────────
-- Identical to 20260708120000 except for the explicit-ids WHERE clause. The
-- sampling branch is deliberately untouched: `is_active = true` there already
-- excludes every generated row, so curated sessions are unaffected.
create or replace function public.start_qbank_session(
  p_domains text[],
  p_limit int,
  p_system text,
  p_question_ids uuid[] default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ids uuid[];
  v_session_id uuid;
  v_questions json;
  v_now timestamptz := now();
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if p_question_ids is not null and array_length(p_question_ids, 1) is not null then
    -- Explicit set ("redo flagged", and now a freshly generated set). Stems are
    -- not secret, so accepting caller-supplied ids is safe. Generated rows are
    -- inactive by design, so they are admitted here only for their own author —
    -- one user can never pull another user's generated items into a session.
    select array_agg(id) into v_ids
    from (
      select id
      from questions
      where (
              is_active = true
              or (origin = 'generated' and created_by = v_user)
            )
        and id = any(p_question_ids)
      order by random()
      limit least(coalesce(p_limit, 40), 40)
    ) sampled;
  else
    -- Sample ids: active only, optional system + domain filters, capped at 40.
    select array_agg(id) into v_ids
    from (
      select id
      from questions
      where is_active = true
        and (p_system is null or subject = p_system)
        and (
          p_domains is null
          or array_length(p_domains, 1) is null
          or domain = any(p_domains)
        )
      order by random()
      limit least(coalesce(p_limit, 40), 40)
    ) sampled;
  end if;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'no_questions';
  end if;

  insert into qbank_sessions (
    user_id, started_at, ended_at, score, total, total_time_ms,
    system, status, question_ids
  )
  values (
    v_user, v_now, v_now, 0, 0, 0,
    coalesce(p_system, 'Cardiovascular'), 'active', v_ids
  )
  returning id into v_session_id;

  -- Build sanitized payload, preserving sampled order via WITH ORDINALITY.
  select json_agg(payload order by ord) into v_questions
  from (
    select
      ord.ord as ord,
      json_build_object(
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
        'media', coalesce(m.media, '[]'::json)
      ) as payload
    from unnest(v_ids) with ordinality as ord(qid, ord)
    join questions q on q.id = ord.qid
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
  ) ordered;

  return json_build_object(
    'session_id', v_session_id,
    'questions', coalesce(v_questions, '[]'::json)
  );
end;
$$;

revoke all on function public.start_qbank_session(text[], int, text, uuid[]) from public;
grant execute on function public.start_qbank_session(text[], int, text, uuid[]) to authenticated;

-- ── Column grants for the new columns ───────────────────────────────────────
-- 20260708130000 replaced the blanket SELECT with an explicit column grant, so
-- new columns are unreadable by the client until named here. origin is needed so
-- the generator page can tell its own items apart; created_by and
-- generation_meta stay server-side (the audit trail is for review tooling, not
-- for the player, and nothing in the client reads them).
grant select (origin) on public.questions to anon, authenticated;
