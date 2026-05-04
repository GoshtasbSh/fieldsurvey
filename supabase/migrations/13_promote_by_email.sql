-- ════════════════════════════════════════════════════════════════════════
-- 13_promote_by_email.sql
-- Lets an admin grant the admin role to any signed-up user directly by
-- email — without requiring that user to first claim today's invite code.
--
-- Behavior:
--   * Looks up auth.users by lowered/trimmed email.
--   * If the user is already in team_members  → UPDATE role='admin'.
--   * If the user is NOT in team_members      → INSERT them as admin.
--   * If no auth.users row matches            → returns an error JSON
--     telling the caller the target needs to sign up first.
--
-- Security:
--   * SECURITY DEFINER + check is_admin(auth.uid()) so only existing
--     admins can call it.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION promote_by_email(p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_email  TEXT := lower(trim(coalesce(p_email, '')));
  v_target UUID;
  v_existing TEXT;
BEGIN
  IF NOT is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin role required');
  END IF;
  IF v_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Email is required');
  END IF;

  SELECT id INTO v_target
    FROM auth.users
   WHERE lower(trim(email)) = v_email
   LIMIT 1;

  IF v_target IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'No account with that email yet. Ask them to sign up at /login first.'
    );
  END IF;

  SELECT role INTO v_existing FROM team_members WHERE id = v_target;
  IF v_existing IS NULL THEN
    -- Not a team member — insert directly as admin (skips the claim-code step).
    INSERT INTO team_members (id, role, joined_at, promoted_by, promoted_at)
    VALUES (v_target, 'admin', now(), v_uid, now());
    RETURN jsonb_build_object('ok', true, 'role', 'admin', 'created', true);
  END IF;

  IF v_existing = 'admin' THEN
    RETURN jsonb_build_object('ok', true, 'role', 'admin', 'already', true);
  END IF;

  -- Existing member → upgrade to admin.
  UPDATE team_members
     SET role = 'admin', promoted_by = v_uid, promoted_at = now()
   WHERE id = v_target;
  RETURN jsonb_build_object('ok', true, 'role', 'admin', 'created', false);
END;
$$;

REVOKE ALL ON FUNCTION promote_by_email(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION promote_by_email(TEXT) TO authenticated;
