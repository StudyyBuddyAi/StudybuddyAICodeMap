-- QBank blueprints: retry a build the gateway was too busy for in minutes, not hours.
--
-- PROBLEM
--   The first live build (2026-11-01, Diabetic ketoacidosis) was refused at
--   once by Corti — 429 "The engine is currently busy" — because it starts
--   beside its wave's own stream and probes. claim_qbank_blueprint_build
--   treated that like a build that came out wrong and parked the topic for an
--   hour, doubling after that, so every set on it went without a blueprint.
--
-- CHANGE
--   qbank-generate now retries a busy gateway inside the build, and when it
--   still gives up it records the failure as last_error 'transient: …'. This
--   recreates claim_qbank_blueprint_build with one more case: a transient
--   failure may be reclaimed after five minutes. A real failure — a thin or
--   unparseable list — keeps the 1h-doubling backoff.
--
--   Recreated verbatim from 20261102000000 apart from that clause. The
--   signature is unchanged, so no overload is created and the grants stand;
--   they are restated anyway so this file is correct on its own.

create or replace function public.claim_qbank_blueprint_build(
  p_topic_key text,
  p_exam_track text,
  p_canonical text,
  p_system text,
  p_version text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_topic_key is null or btrim(p_topic_key) = '' or p_exam_track is null
     or p_exam_track not in ('step1', 'step2ck') then
    return null;
  end if;

  insert into qbank_topic_blueprints as b
    (topic_key, exam_track, canonical_topic, system, version, status, attempts)
  values
    (p_topic_key, p_exam_track, p_canonical, p_system, p_version, 'building', 1)
  on conflict (topic_key, exam_track) do update
    set status = 'building',
        attempts = b.attempts + 1,
        canonical_topic = excluded.canonical_topic,
        system = excluded.system,
        version = excluded.version,
        last_error = null,
        updated_at = now()
    -- A builder that died mid-build leaves 'building' behind; after ten
    -- minutes it is presumed dead. A busy gateway is tried again after five
    -- minutes. Any other failure waits 1h, 2h, 4h … capped at 7d.
    where (b.status = 'building' and b.updated_at < now() - interval '10 minutes')
       or (b.status = 'failed' and b.last_error like 'transient:%'
           and b.updated_at < now() - interval '5 minutes')
       or (b.status = 'failed'
           and b.updated_at < now() - least(interval '1 hour' * power(2, least(b.attempts, 8) - 1),
                                            interval '7 days'))
  returning b.id into v_id;

  return v_id;
end;
$$;

revoke all on function public.claim_qbank_blueprint_build(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_qbank_blueprint_build(text, text, text, text, text) to service_role;
