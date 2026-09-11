-- Harden start_qbank_session against oversized / adversarial inputs
--
-- Two server-side fixes to the live definition (20260907020000 is the deployed
-- body; signature is the five-argument overload that migration wrote, the only
-- one that exists on live — 20260907010000 dropped the earlier four-argument
-- overload):
--
--   #1 p_limit — PostgreSQL treats a negative LIMIT as "no limit", so
--               `limit least(coalesce(p_limit, 40), 40)` let p_limit <= 0 dump
--               the entire active question bank in one call. Clamp to [1, 40].
--   #2 p_domains — unbounded caller-supplied array used in `any(...)` filters.
--               Strict contract: NULL/[] mean "no filter"; any other array must
--               hold only non-empty elements of length <= 40, and at most 30
--               distinct values — any violation raises `domain_invalid` rather
--               than silently dropping the element. Deduped results drive the
--               filter, so NULL/[] still keep their no-filter semantics.
--
-- Signature unchanged => CREATE OR REPLACE keeps the existing grants; they are
-- restated below so this migration is self-contained, matching 20260907020000's
-- pattern. No other behavior touched: sampling branch, generated-for-owner
-- admission, mode, ended_at, JSON payload are all byte-identical.

CREATE OR REPLACE FUNCTION public.start_qbank_session(p_domains text[], p_limit integer, p_system text, p_question_ids uuid[] DEFAULT NULL::uuid[], p_mode text DEFAULT 'tutor'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_ids uuid[];
  v_domains text[];
  v_session_id uuid;
  v_questions json;
  v_now timestamptz := now();
  v_mode text := case when p_mode = 'timed' then 'timed' else 'tutor' end;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  -- Strict contract on the caller-supplied domain filter. NULL/[] mean "no
  -- filter"; anything else must be a well-formed, short, deduped set of at most
  -- 30 values. A violation raises `domain_invalid` instead of silently dropping
  -- the offending element.
  if p_domains is not null and array_length(p_domains, 1) > 0 then
      if array_length(p_domains, 1) > 30 then
      raise exception 'domain_invalid';
    end if;
    if exists (
      select 1 from unnest(p_domains) as le
      where le is null or btrim(le) = '' or length(le) > 40
    ) then
      raise exception 'domain_invalid';
    end if;

    v_domains := array(select distinct le from unnest(p_domains) as le);

    if array_length(v_domains, 1) is not null and array_length(v_domains, 1) > 30 then
      raise exception 'domain_invalid';
    end if;
  end if;

  if p_question_ids is not null and array_length(p_question_ids, 1) is not null then
    -- Explicit set ("redo flagged", and a freshly generated set). Stems are not
    -- secret, so accepting caller-supplied ids is safe. Generated rows are
    -- inactive by design, so they are admitted here only for their own author:
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
      limit least(greatest(coalesce(p_limit, 40), 1), 40)
    ) sampled;
  else
    select array_agg(id) into v_ids
    from (
      select id
      from questions
      where is_active = true
        and (p_system is null or subject = p_system)
        and (
          coalesce(array_length(v_domains, 1), 0) = 0
          or domain = any(v_domains)
        )
      order by random()
      limit least(greatest(coalesce(p_limit, 40), 1), 40)
    ) sampled;
  end if;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'no_questions';
  end if;

  -- ended_at stays NULL until end_qbank_session; an in-flight session has not
  -- ended, and NULL is what lets the history view tell the two apart.
  insert into qbank_sessions (
    user_id, started_at, score, total, total_time_ms,
    system, status, question_ids, mode
  )
  values (
    v_user, v_now, 0, 0, 0,
    coalesce(p_system, 'General'), 'active', v_ids, v_mode
  )
  returning id into v_session_id;

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
    'mode', v_mode,
    'questions', coalesce(v_questions, '[]'::json)
  );
end;
$function$
;

-- Grants are not carried by CREATE OR REPLACE when the signature is unchanged,
-- but restated so this migration is self-contained.
revoke all on function public.start_qbank_session(text[], int, text, uuid[], text) from public;
grant execute on function public.start_qbank_session(text[], int, text, uuid[], text) to authenticated;