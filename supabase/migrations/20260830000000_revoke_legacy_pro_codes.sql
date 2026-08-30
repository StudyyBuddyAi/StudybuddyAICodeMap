-- Revoke the 40 legacy bootstrap pro codes (audit finding #1, phase 2)
--
-- The 40 codes seeded in 20260505154708 are committed in git history and
-- therefore publicly known. They must never grant Pro again, even if they were
-- never redeemed (or were redeemed in error).
--
-- Approach (chosen for the project's additive-only rule):
--   1. Add a `revoked` flag column (NO row deletes, no destructive DDL).
--   2. Mark the 40 known codes revoked.
--   3. Harden redeem_pro_code: codes with revoked = true are rejected with
--      'code_revoked' before any redemption logic runs.
--   4. Re-assert the callable surface (idempotent).
--
-- The flag is checked in the SECURITY DEFINER RPC, so it applies to all
-- callers including the current hardened version of the function.

alter table public.pro_codes
  add column if not exists revoked boolean not null default false;

update public.pro_codes
  set revoked = true
  where code in (
    'X7A9K2QZ','M4P8L1DX','Q9Z2W6TR','B7N3X8FV','K2R5T9LP',
    'Z8X4M1QA','J3L9V7KC','T6P2W8RY','H9D4X2MN','R5Q8Z3LB',
    'V2K7T1XF','N8M4P9ZA','C3X7L2QR','P9T5B1KM','D4W8Z6NX',
    'Y7R3M2QP','L2X9V5ZT','F8Q1K4RB','A6T3N9XM','U5Z8P2LC',
    'X1M7K9RD','Q4L2Z8VT','B9P5X3KF','R2T8M6ZA','J7W4N1QP',
    'H3Z9L5XM','T1K8Q2VR','D7M4P9XB','V8R2L1ZT','N5X9K3QA',
    'C6T2M8RP','P1Z7X4KL','Y9Q5R2MN','F3K8T1ZX','A7M4L9QP',
    'U2X6R8ZT','X9P1K3MF','Q7Z4L2RN','B5T8M1XA','R3K9P6QZ'
  );

-- Harden redeem_pro_code: never report success for a revoked (leaked) code.
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

  if code_row.revoked then
    return json_build_object('success', false, 'error', 'code_revoked');
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