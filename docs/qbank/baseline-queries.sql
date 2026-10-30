-- QBank baseline queries (read-only). Run each block with:
--   npx --no-install supabase db query --linked -f <file-with-one-block>.sql
-- Results from 2026-10-30 are in research-2026-10.md §2.

-- ════ q1 ════
select
  coalesce(origin,'(null)') as origin, is_active,
  coalesce(generation_meta->>'promptVersion','-') as pv,
  coalesce(exam_mode,'-') as exam_mode,
  count(*) as n,
  count(*) filter (where (generation_meta->>'qaBlocked')::boolean) as blocked,
  count(*) filter (where (generation_meta->'verification'->>'agreed')::boolean = false) as disputed,
  count(*) filter (where generation_meta->'verification'->>'error' is not null) as verifier_err,
  count(*) filter (where coalesce(generation_meta->>'reviewerFlag','None.') !~* '^none\.?$') as writer_flagged,
  count(distinct created_by) as authors,
  min(created_at)::date as first, max(created_at)::date as last
from questions
group by 1,2,3,4 order by n desc;

-- ════ q2 ════
-- Real accuracy on generated items vs. the 65-70% target, by self-labelled difficulty,
-- reasoning order, challenge level and exam track. Attempts by real users only.
with a as (
  select ua.is_correct, ua.time_taken_ms, q.difficulty, q.reasoning_order,
         coalesce(q.generation_meta->>'challenge','-') as challenge,
         coalesce(q.exam_mode,'-') as track, q.origin
  from user_attempts ua join questions q on q.id = ua.question_id
)
select 'difficulty' as dim, difficulty as k, count(*) n, round(100.0*avg(is_correct::int),1) pct, round(avg(time_taken_ms)/1000.0,1) avg_s from a where origin='generated' group by difficulty
union all
select 'order', reasoning_order, count(*), round(100.0*avg(is_correct::int),1), round(avg(time_taken_ms)/1000.0,1) from a where origin='generated' group by reasoning_order
union all
select 'challenge', challenge, count(*), round(100.0*avg(is_correct::int),1), round(avg(time_taken_ms)/1000.0,1) from a where origin='generated' group by challenge
union all
select 'track', track, count(*), round(100.0*avg(is_correct::int),1), round(avg(time_taken_ms)/1000.0,1) from a where origin='generated' group by track
union all
select 'origin', coalesce(origin,'(null)'), count(*), round(100.0*avg(is_correct::int),1), round(avg(time_taken_ms)/1000.0,1) from a group by origin
order by 1,2;

-- ════ q3 ════
-- Usage: sessions, completion, modes, systems; findings frequency; answer-key position spread.
select 'sessions' as what, json_build_object(
  'total', count(*),
  'completed', count(*) filter (where status = 'completed'),
  'active', count(*) filter (where status = 'active'),
  'timed', count(*) filter (where mode = 'timed'),
  'users', count(distinct user_id),
  'avg_total', round(avg(total)::numeric,1),
  'avg_pct_completed', round(avg(case when status='completed' and total>0 then 100.0*score/total end)::numeric,1),
  'last_30d', count(*) filter (where started_at > now() - interval '30 days')
)::text as v from qbank_sessions
union all
select 'systems', (select json_object_agg(system, n)::text from (select coalesce(system,'-') system, count(*) n from qbank_sessions group by 1 order by 2 desc) s)
union all
select 'findings', (select json_object_agg(rule, n)::text from (
  select f->>'rule' rule, count(*) n from questions q,
    lateral jsonb_array_elements(case when jsonb_typeof(q.generation_meta->'qa')='array' then q.generation_meta->'qa' else '[]'::jsonb end) f
  where q.origin='generated' group by 1 order by 2 desc) s)
union all
select 'key_positions', (select json_object_agg(correct_option, n)::text from (select correct_option, count(*) n from questions where origin='generated' group by 1) s)
union all
select 'challenge_mix', (select json_object_agg(c, n)::text from (select coalesce(generation_meta->>'challenge','-') c, count(*) n from questions where origin='generated' group by 1) s)
union all
select 'difficulty_label_by_order', (select json_object_agg(k, n)::text from (select reasoning_order||'/'||difficulty k, count(*) n from questions where origin='generated' group by 1) s)
union all
select 'wants_image', (select json_object_agg(t, n)::text from (select coalesce(generation_meta->'suggestedImage'->>'type','-') t, count(*) n from questions where origin='generated' and generation_meta->'suggestedImage'->>'needed'='Yes' group by 1 order by 2 desc) s)
union all
select 'flags', (select json_build_object('flagged_rows', count(*), 'users', count(distinct user_id))::text from flagged_questions)
union all
select 'generators_by_tier', (select json_object_agg(tier, n)::text from (
  select case when p.is_pro and (p.pro_expires_at is null or p.pro_expires_at > now()) then 'pro' else 'free' end tier, count(distinct q.created_by) n
  from questions q join profiles p on p.id = q.created_by where q.origin='generated' group by 1) s)
union all
select 'top_generators', (select json_agg(n order by n desc)::text from (select count(*) n from questions where origin='generated' group by created_by order by 1 desc limit 10) s);

-- ════ q5 ════
-- Accuracy on attempts where the student actually read the item (>= 20s), excluding the heaviest generator;
-- plus how often a student's wrong pick matched the verifier's disputed pick (would only apply to admitted items, so expect none).
with heavy as (
  select created_by from questions where origin='generated' group by 1 order by count(*) desc limit 1
)
select q.exam_mode, (ua.time_taken_ms >= 20000) as read_it,
       count(*) n, round(100.0*avg(ua.is_correct::int),1) pct, count(distinct ua.user_id) users,
       round(avg(ua.time_taken_ms)/1000.0,1) avg_s
from user_attempts ua join questions q on q.id = ua.question_id
where q.origin='generated' and ua.user_id not in (select created_by from heavy)
group by 1,2 order by 1,2;

