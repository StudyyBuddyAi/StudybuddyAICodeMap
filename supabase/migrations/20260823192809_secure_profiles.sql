-- Revoke the default table-level UPDATE privilege from frontend roles.
-- This prevents anon and authenticated users from updating ALL columns in their profile row.
REVOKE UPDATE ON public.profiles FROM anon, authenticated;

-- Grant column-level UPDATE privilege back for only the safe columns.
-- This allows users to still update their email and preferred model, 
-- but completely locks them out of modifying is_pro, pro_expires_at, and billing fields.
GRANT UPDATE (
  email,
  preferred_model
) ON public.profiles TO anon, authenticated;
