-- QBank: a question can be withdrawn after a student has seen it.
--
-- The generation gate decides what reaches a session, but some faults only
-- surface later: the full-explanation writer (qbank-explain) doubting the key,
-- or a reviewer reading an item a student reported. Until now nothing could
-- act on that. The question stayed in the student's review queue, could be
-- re-sat by id, and could be turned into flashcards with its doubtful key.
--
-- A withdrawn question carries generation_meta.held = {reason, source, at}.
-- One marker, read everywhere a question is offered again:
--   - get_qbank_review_queue never offers it.
--   - start_qbank_session admits it by neither branch.
--   - qbank-explain answers "held" for it, and holds the question itself when
--     its writer disputes the key.
--   - a deck built from answered questions leaves it out (medical-notes).
-- The student's past sessions still show it as it was answered; withdrawing it
-- does not rewrite their history.
--
-- Also: start_qbank_session's explicit-ids branch now applies the same quality
-- filter as claim_generated_questions (not qaBlocked, not disputed). A set's
-- first question opens the session through that branch, so it was the one
-- question filtered only in the browser.
--
-- hold_generated_question is service-role only: edge functions and operators
-- withdraw questions, students report them (report_question).

create or replace function public.hold_generated_question(
  p_question uuid,
  p_reason text,
  p_source text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The first hold stands: a later one does not overwrite why it was withdrawn.
  update questions
     set generation_meta = coalesce(generation_meta, '{}'::jsonb) || jsonb_build_object(
       'held', jsonb_build_object(
         'reason', left(coalesce(p_reason, ''), 500),
         'source', left(coalesce(p_source, ''), 40),
         'at', now()
       )
     )
   where id = p_question
     and not (coalesce(generation_meta, '{}'::jsonb) ? 'held');
  return found;
end;
$$;

revoke all on function public.hold_generated_question(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hold_generated_question(uuid, text, text) to service_role;

create or replace function public.get_qbank_review_queue()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_spacing interval := interval '20 hours';
  v_result json;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  with latest as (
    select distinct on (ua.question_id)
      ua.question_id, ua.is_correct, ua.created_at, ua.session_id
    from user_attempts ua
    where ua.user_id = v_user
    order by ua.question_id, ua.created_at desc
  ),
  marked as (
    select fq.question_id, max(fq.flagged_at) as flagged_at
    from flagged_questions fq
    left join latest l on l.question_id = fq.question_id
    where fq.user_id = v_user
      and (l.question_id is null or fq.session_id = l.session_id or fq.flagged_at > l.created_at)
    group by fq.question_id
  ),
  candidates as (
    select
      coalesce(l.question_id, m.question_id) as question_id,
      (l.question_id is not null and l.is_correct = false) as missed,
      (m.question_id is not null) as is_marked,
      greatest(l.created_at, m.flagged_at) as last_seen_at,
      l.created_at as missed_at
    from latest l
    full join marked m on m.question_id = l.question_id
  ),
  reachable as (
    select c.*, q.subject, q.domain, q.topic
    from candidates c
    join questions q on q.id = c.question_id
    where (c.missed or c.is_marked)
      and (q.is_active = true or (q.origin = 'generated' and q.created_by = v_user))
      and not exists (
        select 1 from question_reports qr
        where qr.user_id = v_user
          and qr.question_id = c.question_id
          and qr.status = 'open'
          and qr.reason in ('wrong_key', 'outdated', 'unclear')
      )
      -- Withdrawn after it was served: never offered again.
      and not (coalesce(q.generation_meta, '{}'::jsonb) ? 'held')
  ),
  due as (
    select *,
      case when missed and is_marked then 'both' when missed then 'missed' else 'marked' end as reason
    from reachable
    where is_marked or missed_at <= now() - v_spacing
  ),
  upcoming as (
    select * from reachable
    where missed and not is_marked and missed_at > now() - v_spacing
  )
  select json_build_object(
    'due', coalesce((
      select json_agg(json_build_object(
        'question_id', d.question_id,
        'reason', d.reason,
        'last_seen_at', d.last_seen_at,
        'subject', d.subject,
        'domain', d.domain,
        'topic', d.topic
      ) order by d.last_seen_at asc nulls first)
      from (select * from due order by last_seen_at asc nulls first limit 200) d
    ), '[]'::json),
    'due_count', (select count(*) from due),
    'missed_due', (select count(*) from due where missed),
    'marked', (select count(*) from due where is_marked),
    'upcoming', (select count(*) from upcoming),
    'next_due_at', (select min(missed_at) + v_spacing from upcoming)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_qbank_review_queue() from public, anon;
grant execute on function public.get_qbank_review_queue() to authenticated;

CREATE OR REPLACE FUNCTION public.start_qbank_session(
  p_domains text[],
  p_limit integer,
  p_system text,
  p_question_ids uuid[] DEFAULT NULL::uuid[],
  p_mode text DEFAULT 'tutor'::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_ids uuid[];
  v_domains text[];
  v_session_id uuid;
  v_questions json;
  v_now timestamptz := now();
  v_mode text := case when p_mode = 'timed' then 'timed' else 'tutor' end;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- NULL/[] = no filter.
  -- Reject more than 30 total domain values before unnesting.
  IF p_domains IS NOT NULL AND array_length(p_domains, 1) > 0 THEN
    IF array_length(p_domains, 1) > 30 THEN
      RAISE EXCEPTION 'domain_invalid';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM unnest(p_domains) AS le
      WHERE le IS NULL
        OR btrim(le) = ''
        OR length(le) > 40
    ) THEN
      RAISE EXCEPTION 'domain_invalid';
    END IF;

    v_domains := ARRAY(
      SELECT DISTINCT le
      FROM unnest(p_domains) AS le
    );

    IF array_length(v_domains, 1) IS NOT NULL
       AND array_length(v_domains, 1) > 30 THEN
      RAISE EXCEPTION 'domain_invalid';
    END IF;
  END IF;

  IF p_question_ids IS NOT NULL
     AND array_length(p_question_ids, 1) IS NOT NULL THEN

    SELECT array_agg(id) INTO v_ids
    FROM (
      SELECT id
      FROM questions
      WHERE (
        is_active = true
        OR (origin = 'generated' AND created_by = v_user)
      )
      AND id = ANY(p_question_ids)
      -- The quality filter claim_generated_questions applies, applied here too:
      -- a set's first question is handed straight to this branch, so without it
      -- that one question was filtered only by the client. And nothing withdrawn
      -- after it was served comes back by id.
      AND NOT (coalesce(generation_meta, '{}'::jsonb) ? 'held')
      AND NOT (
        origin = 'generated'
        AND (
          coalesce((generation_meta->>'qaBlocked')::boolean, false)
          OR coalesce((generation_meta->'verification'->>'agreed')::boolean, true) = false
        )
      )
      ORDER BY random()
      LIMIT least(greatest(coalesce(p_limit, 40), 1), 40)
    ) sampled;

  ELSE

    SELECT array_agg(id) INTO v_ids
    FROM (
      SELECT id
      FROM questions
      WHERE is_active = true
        AND NOT (coalesce(generation_meta, '{}'::jsonb) ? 'held')
        AND (p_system IS NULL OR subject = p_system)
        AND (
          coalesce(array_length(v_domains, 1), 0) = 0
          OR domain = ANY(v_domains)
        )
      ORDER BY random()
      LIMIT least(greatest(coalesce(p_limit, 40), 1), 40)
    ) sampled;

  END IF;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no_questions';
  END IF;

  INSERT INTO qbank_sessions (
    user_id, started_at, score, total, total_time_ms,
    system, status, question_ids, mode
  )
  VALUES (
    v_user, v_now, 0, 0, 0,
    coalesce(p_system, 'General'), 'active', v_ids, v_mode
  )
  RETURNING id INTO v_session_id;

  SELECT json_agg(payload ORDER BY ord) INTO v_questions
  FROM (
    SELECT
      ord.ord AS ord,
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
      ) AS payload
    FROM unnest(v_ids) WITH ORDINALITY AS ord(qid, ord)
    JOIN questions q ON q.id = ord.qid
    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'file_url', md.file_url,
          'media_type', md.media_type,
          'caption', qm.caption,
          'attribution', md.attribution,
          'license', md.license,
          'display_context', qm.display_context,
          'display_order', qm.display_order
        ) ORDER BY qm.display_order
      ) AS media
      FROM question_media qm
      JOIN media md ON md.id = qm.media_id
      WHERE qm.question_id = q.id
    ) m ON true
  ) ordered;

  RETURN json_build_object(
    'session_id', v_session_id,
    'mode', v_mode,
    'questions', coalesce(v_questions, '[]'::json)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.start_qbank_session(
  text[], int, text, uuid[], text
) FROM public;

GRANT EXECUTE ON FUNCTION public.start_qbank_session(
  text[], int, text, uuid[], text
) TO authenticated;
