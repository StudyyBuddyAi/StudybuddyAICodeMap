ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username)
  VALUES (NEW.id, NEW.email, split_part(NEW.email, '@', 1));
  RETURN NEW;
END;
$$;

GRANT UPDATE (email, preferred_model, username)
  ON public.profiles TO anon, authenticated;

UPDATE public.profiles
SET username = split_part(email, '@', 1)
WHERE username IS NULL AND email IS NOT NULL;

WITH systems AS (
  SELECT id, system FROM public.curriculum_topics WHERE level = 0
), topics(system, title, sort_order) AS (
  VALUES
    ('Renal & Urinary', 'Nephrotic Syndrome', 900),
    ('Cardiovascular', 'Myocardial Infarction', 910),
    ('Respiratory', 'Pneumonia', 920),
    ('Respiratory', 'Pulmonology', 930)
)
INSERT INTO public.curriculum_topics (parent_id, system, title, level, yield_tier, sort_order, is_active)
SELECT systems.id, topics.system, topics.title, 1, 'high', topics.sort_order, true
FROM topics
JOIN systems ON systems.system = topics.system
WHERE NOT EXISTS (
  SELECT 1
  FROM public.curriculum_topics existing
  WHERE existing.title = topics.title AND existing.system = topics.system
);