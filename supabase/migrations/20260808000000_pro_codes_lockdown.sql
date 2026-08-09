-- Pro code lockdown (Phase 1 / audit finding #1)
--
-- pro_codes must NEVER be readable by anon/authenticated roles through the API.
-- Redemption is exclusively the redeem_pro_code SECURITY DEFINER RPC, which runs
-- as the function owner and needs no direct table privilege for the caller.
--
-- Two layers of defense (mirrors the QBank answer-key treatment in
-- 20260708130000):
--   1. Drop the SELECT policy so RLS filters every row out for anon/authenticated.
--   2. REVOKE ALL on the table from anon/authenticated so even a raw
--      `SELECT * FROM pro_codes` fails with a permission error instead of
--      returning an empty set.
--
-- Also hardens redeem_pro_code: it now refuses to report success unless the
-- caller's profiles row was actually updated (guards a legacy user whose profile
-- row is missing — previously the RPC returned success while granting nothing).
--
-- NOTE: the 40 bootstrap codes seeded in 20260505154708 are committed in git
-- history and are therefore publicly known. Rotating them is a business
-- decision and nothing is deleted here. See the phase report.
--
-- Additive/privilege-only changes (policy drop + REVOKE + function replace are
-- allowed under the project's additive-only rule).

drop policy if exists "Authenticated users can read codes" on public.pro_codes;

revoke all on public.pro_codes from anon, authenticated;

create or replace function public.redeem_pro_code(code_input text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  code_row pro_codes%ROWTYPE;
  expires_at timestamptz;
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    return json_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if (auth.jwt() ->> 'is_anonymous')::boolean IS TRUE then
    return json_build_object('success', false, 'error', 'account_required');
  end if;

  select * into code_row from pro_codes
    where code = upper(trim(code_input))
    for update;

  if not found then
    return json_build_object('success', false, 'error', 'invalid_code');
  end if;

  if code_row.redeemed_by is not null then
    return json_build_object('success', false, 'error', 'already_redeemed');
  end if;

  expires_at := now() + (code_row.duration_days || ' days')::interval;

  update pro_codes
    set redeemed_by = current_user_id, redeemed_at = now()
    where code = code_row.code;

  update profiles
    set is_pro = true, pro_expires_at = expires_at, pro_source = 'code'
    where id = current_user_id;

  if not found then
    return json_build_object('success', false, 'error', 'profile_not_found');
  end if;

  return json_build_object('success', true, 'expires_at', expires_at);
end;
$$;

-- Re-assert the callable surface: only signed-in (non-anonymous) users may
-- invoke the RPC. Idempotent and self-contained regardless of history.
revoke all on function public.redeem_pro_code(text) from public, anon;
grant execute on function public.redeem_pro_code(text) to authenticated;
