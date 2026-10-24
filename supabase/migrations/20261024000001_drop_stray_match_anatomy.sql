-- Drop the 3-argument match_anatomy left behind on the live project.
--
-- The anatomy schema already existed there in its final form (4 arguments,
-- with `regions`) when 20260921 was pushed, so 20260921 recreated the original
-- 3-argument version beside it, and 20260922 — whose first statement drops
-- that version — could not run (it was marked applied by hand, since 20260924
-- supersedes the rest of it). With both overloads present, a call that passes
-- three arguments is ambiguous. This removes the stale one; a no-op anywhere it
-- is already gone.

drop function if exists public.match_anatomy(vector(1536), int, float);
