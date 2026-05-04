-- ════════════════════════════════════════════════════════════════════════
-- 11_guest_sessions.sql
-- Ephemeral "guest surveyor" sessions — one-day field workers who add
-- points without ever creating a Supabase account.
-- ────────────────────────────────────────────────────────────────────────
-- Architecture:
--   * Guests have NO row in auth.users. They identify themselves with a
--     name string + the day's invite code.
--   * api/guest/claim.py validates the code, creates a row here, returns
--     the session_id to the device. The device stores the session_id in
--     sessionStorage and sends it with every subsequent request.
--   * api/guest/add-point.py inserts into field_survey_points using the
--     SERVICE-ROLE supabase client (bypassing RLS). It sets
--     collector_id=NULL, collector_name=session.name, guest_session_id=row.id.
--   * RLS on field_survey_points is unchanged for persistent users (admins +
--     members) — they continue to insert via the Supabase JS client with
--     auth.uid()=collector_id. Guests bypass RLS entirely via the proxy.
--   * Sessions auto-expire after 12 hours; sliding-window extended on each
--     successful insert/heartbeat.
--   * Admins can mass-list and revoke active guest sessions via
--     api/team/guest-history and api/team/revoke-guest.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS field_guest_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  invite_date   DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '12 hours'),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_ua     TEXT,
  ip_hash       TEXT,
  revoked_at    TIMESTAMPTZ,
  revoked_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fgs_invite_date  ON field_guest_sessions(invite_date);
CREATE INDEX IF NOT EXISTS idx_fgs_expires      ON field_guest_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_fgs_active       ON field_guest_sessions(revoked_at, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE field_guest_sessions ENABLE ROW LEVEL SECURITY;
-- No client-side policy. Reads + writes happen ONLY via the api/guest/* and
-- api/team/* proxy endpoints with the service-role key.

-- ── Add guest_session_id to field_survey_points ───────────────────────
ALTER TABLE field_survey_points
  ADD COLUMN IF NOT EXISTS guest_session_id UUID
    REFERENCES field_guest_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fsp_guest_session
  ON field_survey_points(guest_session_id);

-- ── list_guest_sessions(p_date) — admin-only ──────────────────────────
-- Returns guest sessions for a given day with point counts.
CREATE OR REPLACE FUNCTION list_guest_sessions(p_date DATE)
RETURNS TABLE(
  id            UUID,
  name          TEXT,
  invite_date   DATE,
  created_at    TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  revoked_by    UUID,
  ip_hash       TEXT,
  device_ua     TEXT,
  point_count   BIGINT
) LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH cnt AS (
    SELECT guest_session_id, COUNT(*)::bigint AS n
      FROM field_survey_points
     WHERE guest_session_id IS NOT NULL
     GROUP BY guest_session_id
  )
  SELECT g.id, g.name, g.invite_date, g.created_at, g.expires_at,
         g.last_seen_at, g.revoked_at, g.revoked_by, g.ip_hash, g.device_ua,
         COALESCE(c.n, 0) AS point_count
    FROM field_guest_sessions g
    LEFT JOIN cnt c ON c.guest_session_id = g.id
   WHERE g.invite_date = COALESCE(p_date, (now() AT TIME ZONE 'UTC')::date)
     AND is_admin(auth.uid())
   ORDER BY g.created_at DESC;
$$;

REVOKE ALL ON FUNCTION list_guest_sessions(DATE) FROM public;
GRANT EXECUTE ON FUNCTION list_guest_sessions(DATE) TO authenticated;

-- ── revoke_guest_session(session_id) — admin-only ─────────────────────
CREATE OR REPLACE FUNCTION revoke_guest_session(p_session UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin role required');
  END IF;
  UPDATE field_guest_sessions
     SET revoked_at = COALESCE(revoked_at, now()),
         revoked_by = v_uid
   WHERE id = p_session;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION revoke_guest_session(UUID) FROM public;
GRANT EXECUTE ON FUNCTION revoke_guest_session(UUID) TO authenticated;
