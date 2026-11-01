with g as (
  select lower(trim(generation_meta->>'requestedTopic')) as t,
         generation_meta->>'generationId' as gid, min(created_at) over (partition by generation_meta->>'generationId') as sess_at,
         q.*
  from questions q
  where origin = 'generated' and generation_meta ? 'generationId'
), s as (
  select created_by, t from g group by 1,2 having count(distinct gid) >= 2
)
select g.created_by::text as author, g.t, g.gid, g.sess_at, g.created_at,
  (g.generation_meta->>'index')::int as idx,
  g.topic as subtopic, g.exam_mode, g.generation_meta->>'challenge' as challenge,
  g.generation_meta->>'promptVersion' as pv,
  (g.generation_meta->>'qaBlocked')::boolean as blocked,
  (g.generation_meta->'verification'->>'agreed')::boolean as agreed,
  regexp_replace(g.question_text, '^.*\n\n', '') as lead_in,
  g.question_text,
  case g.correct_option when 'a' then g.option_a when 'b' then g.option_b when 'c' then g.option_c when 'd' then g.option_d when 'e' then g.option_e end as key_text,
  g.teaching_point,
  (select count(*) from user_attempts ua where ua.question_id = g.id and ua.user_id = g.created_by) as author_attempts,
  (select bool_or(ua.is_correct) from user_attempts ua where ua.question_id = g.id and ua.user_id = g.created_by) as author_correct
from g join s using (created_by, t)
order by g.t, g.sess_at, idx;
