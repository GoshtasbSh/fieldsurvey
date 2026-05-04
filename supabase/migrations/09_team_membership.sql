-- ════════════════════════════════════════════════════════════════════════
-- 09_team_membership.sql
-- Team-membership + invite-code system + bootstrap admin
-- ────────────────────────────────────────────────────────────────────────
-- Model:
--   * Anyone can sign up with email + password (existing auth.users flow).
--   * After sign-up, the user must redeem the day's invite code via
--     claim_membership(code). Admins generate today's code on demand via
--     get_or_create_today_code(); they share it verbally / in person.
--   * On successful claim, a team_members row is created with role='member'.
--   * Admins can promote any team member to admin (promote_member) or
--     demote them back (demote_member) — but never demote the last admin.
--   * RLS on data tables checks team_members membership; admin-only writes
--     are enforced in 10_tighten_writes.sql.
--   * Bootstrap admin = georgeshahriari@gmail.com; promotion is recursive
--     thereafter (any admin can promote others).
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. team_members ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('admin','member')) DEFAULT 'member',
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  promoted_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  promoted_at   TIMESTAMPTZ,
  invited_via   DATE
);

CREATE INDEX IF NOT EXISTS idx_team_members_role ON team_members(role);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Any team member can read the roster (so the dashboard can render team list).
DROP POLICY IF EXISTS "Team members can read roster" ON team_members;
CREATE POLICY "Team members can read roster"
  ON team_members FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = auth.uid()));

-- INSERT/UPDATE/DELETE on team_members are NOT allowed via direct SQL from
-- clients; mutations happen only through SECURITY DEFINER RPCs below.

-- ── 2. invite_codes ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invite_codes (
  date          DATE PRIMARY KEY,
  code          TEXT NOT NULL,
  generated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;
-- No client-side policy. Reads + writes happen via RPC only.

-- ── 3. is_admin(uid) — central role check used by other RLS ───────────
CREATE OR REPLACE FUNCTION is_admin(uid UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' FROM team_members WHERE id = uid),
    false
  );
$$;

REVOKE ALL ON FUNCTION is_admin(UUID) FROM public;
GRANT EXECUTE ON FUNCTION is_admin(UUID) TO authenticated, anon, service_role;

-- ── 4. claim_membership(code) — newly-signed-up user redeems today's code
CREATE OR REPLACE FUNCTION claim_membership(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_today   DATE := (now() AT TIME ZONE 'UTC')::date;
  v_existing TEXT;
  v_role    TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authenticated');
  END IF;
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Empty invite code');
  END IF;
  -- Idempotent: if already a member, return current role.
  SELECT role INTO v_role FROM team_members WHERE id = v_uid;
  IF v_role IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'role', v_role, 'already', true);
  END IF;
  SELECT code INTO v_existing FROM invite_codes WHERE date = v_today;
  IF v_existing IS NULL OR upper(v_existing) <> upper(trim(p_code)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid invite code');
  END IF;
  INSERT INTO team_members (id, role, invited_via)
  VALUES (v_uid, 'member', v_today);
  RETURN jsonb_build_object('ok', true, 'role', 'member');
END;
$$;

REVOKE ALL ON FUNCTION claim_membership(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION claim_membership(TEXT) TO authenticated;

-- ── 5. get_or_create_today_code() — admin-only, returns today's code ──
CREATE OR REPLACE FUNCTION get_or_create_today_code()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
  v_code  TEXT;
  v_raw   BYTEA;
BEGIN
  IF NOT is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin role required');
  END IF;
  SELECT code INTO v_code FROM invite_codes WHERE date = v_today;
  IF v_code IS NULL THEN
    -- 6-char alphanumeric (uppercase) code, derived from random bytes.
    v_raw := gen_random_bytes(8);
    v_code := upper(translate(encode(v_raw, 'base64'), '/+=', 'XYZ'));
    v_code := substr(regexp_replace(v_code, '[^A-Z0-9]', 'X', 'g'), 1, 6);
    INSERT INTO invite_codes (date, code, generated_by)
    VALUES (v_today, v_code, v_uid);
  END IF;
  RETURN jsonb_build_object('ok', true, 'date', v_today, 'code', v_code);
END;
$$;

REVOKE ALL ON FUNCTION get_or_create_today_code() FROM public;
GRANT EXECUTE ON FUNCTION get_or_create_today_code() TO authenticated;

-- ── 6. promote_member(target_uid) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION promote_member(p_target UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin role required');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM team_members WHERE id = p_target) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Target user is not a team member');
  END IF;
  UPDATE team_members
     SET role        = 'admin',
         promoted_by = v_uid,
         promoted_at = now()
   WHERE id = p_target;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION promote_member(UUID) FROM public;
GRANT EXECUTE ON FUNCTION promote_member(UUID) TO authenticated;

-- ── 7. demote_member(target_uid) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION demote_member(p_target UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_admins INT;
BEGIN
  IF NOT is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin role required');
  END IF;
  SELECT count(*) INTO v_admins FROM team_members WHERE role = 'admin';
  IF v_admins <= 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cannot demote the last admin');
  END IF;
  UPDATE team_members
     SET role        = 'member',
         promoted_at = NULL,
         promoted_by = NULL
   WHERE id = p_target AND role = 'admin';
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION demote_member(UUID) FROM public;
GRANT EXECUTE ON FUNCTION demote_member(UUID) TO authenticated;

-- ── 8. list_team() — roster for the admin UI ──────────────────────────
CREATE OR REPLACE FUNCTION list_team()
RETURNS TABLE(
  id          UUID,
  email       TEXT,
  role        TEXT,
  joined_at   TIMESTAMPTZ,
  promoted_at TIMESTAMPTZ
) LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tm.id, u.email::text, tm.role, tm.joined_at, tm.promoted_at
    FROM team_members tm
    JOIN auth.users   u ON u.id = tm.id
   WHERE EXISTS (SELECT 1 FROM team_members me WHERE me.id = auth.uid())
   ORDER BY (tm.role = 'admin') DESC, tm.joined_at;
$$;

REVOKE ALL ON FUNCTION list_team() FROM public;
GRANT EXECUTE ON FUNCTION list_team() TO authenticated;

-- ── 9. my_team_role() — convenience for the client to know its own role
CREATE OR REPLACE FUNCTION my_team_role()
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('ok', true, 'role', role, 'joined_at', joined_at)
       FROM team_members WHERE id = auth.uid()),
    jsonb_build_object('ok', true, 'role', null)
  );
$$;

REVOKE ALL ON FUNCTION my_team_role() FROM public;
GRANT EXECUTE ON FUNCTION my_team_role() TO authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 10. SEED — bootstrap georgeshahriari@gmail.com as admin
-- ────────────────────────────────────────────────────────────────────────
-- Idempotent. Safe to re-run after the user signs up if they hadn't yet.
-- If the user has not yet signed up, this is a no-op; re-run after sign-up.
-- Match is case-insensitive on the email — Supabase normalises but we
-- guard explicitly so cosmetic case differences don't lock you out.
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO team_members (id, role, joined_at)
SELECT id, 'admin', now()
  FROM auth.users
 WHERE lower(trim(email)) = 'georgeshahriari@gmail.com'
ON CONFLICT (id) DO UPDATE SET role = 'admin';
