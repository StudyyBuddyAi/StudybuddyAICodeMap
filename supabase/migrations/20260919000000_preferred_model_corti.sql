-- Pro model preference: premium Corti vs fastest GPT-OSS.
--
-- The premium tier moved from Claude Haiku 4.5 to Corti (medical-notes, see
-- docs/corti-provider-spike.md), so the Pro toggle is now a quality/speed
-- choice: 'corti' (best quality, the default) or 'gpt-oss' (fastest).
--
-- Every existing Pro preference is reset to 'corti'. Most rows hold 'gpt-oss'
-- only because it was the column default, not a choice; the premium model is
-- what Pro is for, and anyone who wants speed can switch back in one click.
--
-- 'claude' stays legal as a legacy alias for the premium tier, so a client
-- built before this change can still save its toggle during rollout. The
-- server treats every value except 'gpt-oss' as premium.

DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%preferred_model%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

UPDATE public.profiles
SET preferred_model = 'corti'
WHERE preferred_model IS DISTINCT FROM 'corti';

ALTER TABLE public.profiles
  ALTER COLUMN preferred_model SET DEFAULT 'corti';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_model_check
    CHECK (preferred_model IN ('corti', 'gpt-oss', 'claude'));
