-- Reject oversized domain arrays before unnesting them.
-- This closes the remaining input-amplification case where an attacker
-- could send many duplicate domain values.

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
      ORDER BY random()
      LIMIT least(greatest(coalesce(p_limit, 40), 1), 40)
    ) sampled;

  ELSE

    SELECT array_agg(id) INTO v_ids
    FROM (
      SELECT id
      FROM questions
      WHERE is_active = true
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