-- Fix: Pro model toggle was stuck on GPT-OSS.
--
-- 20260516000000 created profiles.preferred_model with DEFAULT 'flash' and
-- CHECK (preferred_model IN ('flash', 'gpt-oss')). The app has since moved to
-- 'claude' | 'gpt-oss' (Gemini Flash is gone), so every attempt to save 'claude'
-- was rejected with 23514 and the UI silently snapped back to GPT-OSS.
--
-- Drop the stale constraint, migrate legacy 'flash' rows to 'gpt-oss' (which is
-- how they already rendered and routed), then re-add the correct constraint.

-- The 20260516000000 constraint was auto-named by Postgres, and the live DB may
-- have been altered by hand. Drop whatever check constraint currently guards the
-- column rather than guessing at its name.
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
SET preferred_model = 'gpt-oss'
WHERE preferred_model IS DISTINCT FROM 'claude'
  AND preferred_model IS DISTINCT FROM 'gpt-oss';

ALTER TABLE public.profiles
  ALTER COLUMN preferred_model SET DEFAULT 'gpt-oss';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_model_check
    CHECK (preferred_model IN ('claude', 'gpt-oss'));
