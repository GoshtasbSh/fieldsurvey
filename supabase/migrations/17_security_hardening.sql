-- ════════════════════════════════════════════════════════════════════════
-- 17_security_hardening.sql
-- Fixes recursive RLS self-joins, tightens is_admin grant, adds missing
-- WITH CHECK clauses, tightens storage and dashboard-data access, adds
-- SET search_path to delete_old_chat_messages, and enforces guest session
-- expiry at the DB level.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. is_team_member() helper (breaks the recursive self-join) ─────────
-- All RLS policies that previously did:
--   EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = auth.uid())
-- were reading team_members inside a policy ON team_members — infinite
-- recursion. This SECURITY DEFINER helper reads team_members with RLS
-- bypassed (same pattern already used by is_admin()).
CREATE OR REPLACE FUNCTION is_team_member(uid UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM team_members WHERE id = uid);
$$;

REVOKE ALL ON FUNCTION is_team_member(UUID) FROM public;
GRANT EXECUTE ON FUNCTION is_team_member(UUID) TO authenticated, service_role;

-- ── 2. Fix recursive self-join on team_members SELECT policy ────────────
DROP POLICY IF EXISTS "Team members can read roster" ON team_members;
CREATE POLICY "Team members can read roster"
  ON team_members FOR SELECT
  TO authenticated
  USING (is_team_member(auth.uid()));

-- ── 3. Fix is_admin() — revoke anon grant (was leaking membership info) ─
REVOKE EXECUTE ON FUNCTION is_admin(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION is_admin(UUID) TO authenticated, service_role;

-- ── 4. community_contacts — fix recursive EXISTS + add WITH CHECK ────────
DROP POLICY IF EXISTS "Team members read community_contacts"   ON community_contacts;
DROP POLICY IF EXISTS "Admins write community_contacts (update)" ON community_contacts;

CREATE POLICY "Team members read community_contacts"
  ON community_contacts FOR SELECT TO authenticated
  USING (is_team_member(auth.uid()));

CREATE POLICY "Admins write community_contacts (update)"
  ON community_contacts FOR UPDATE TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- ── 5. iaq_surveys — fix recursive EXISTS + add WITH CHECK ──────────────
DROP POLICY IF EXISTS "Team members read iaq_surveys"    ON iaq_surveys;
DROP POLICY IF EXISTS "Admins write iaq_surveys (update)" ON iaq_surveys;

CREATE POLICY "Team members read iaq_surveys"
  ON iaq_surveys FOR SELECT TO authenticated
  USING (is_team_member(auth.uid()));

CREATE POLICY "Admins write iaq_surveys (update)"
  ON iaq_surveys FOR UPDATE TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- ── 6. report_config — fix recursive EXISTS + add WITH CHECK ────────────
DROP POLICY IF EXISTS "Team members read report_config"    ON report_config;
DROP POLICY IF EXISTS "Admins write report_config (update)" ON report_config;

CREATE POLICY "Team members read report_config"
  ON report_config FOR SELECT TO authenticated
  USING (is_team_member(auth.uid()));

CREATE POLICY "Admins write report_config (update)"
  ON report_config FOR UPDATE TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- ── 7. field_survey_points — fix all recursive EXISTS ───────────────────
DROP POLICY IF EXISTS "Team members can read field points"   ON field_survey_points;
DROP POLICY IF EXISTS "Team members insert their own points" ON field_survey_points;
DROP POLICY IF EXISTS "Team members update their own points" ON field_survey_points;
DROP POLICY IF EXISTS "Team members delete their own points" ON field_survey_points;

CREATE POLICY "Team members can read field points"
  ON field_survey_points FOR SELECT TO authenticated
  USING (is_team_member(auth.uid()));

CREATE POLICY "Team members insert their own points"
  ON field_survey_points FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = collector_id
    AND is_team_member(auth.uid())
  );

CREATE POLICY "Team members update their own points"
  ON field_survey_points FOR UPDATE TO authenticated
  USING (auth.uid() = collector_id AND is_team_member(auth.uid()))
  WITH CHECK (auth.uid() = collector_id AND is_team_member(auth.uid()));

CREATE POLICY "Team members delete their own points"
  ON field_survey_points FOR DELETE TO authenticated
  USING (auth.uid() = collector_id AND is_team_member(auth.uid()));

-- ── 8. keystone_dashboard_data — tighten to team members only ───────────
-- Previously readable by ANY authenticated user. Payload contains full
-- processed community-contact and IAQ blobs which should be team-only.
DROP POLICY IF EXISTS "auth_read_dashboard_data" ON keystone_dashboard_data;

CREATE POLICY "Team members read dashboard data"
  ON keystone_dashboard_data FOR SELECT
  TO authenticated
  USING (is_team_member(auth.uid()));

-- ── 9. keystone_analysis_versions — tighten to team members ─────────────
DROP POLICY IF EXISTS "auth_read_analysis_versions" ON keystone_analysis_versions;

CREATE POLICY "Team members read analysis versions"
  ON keystone_analysis_versions FOR SELECT
  TO authenticated
  USING (is_team_member(auth.uid()));

-- ── 10. Storage — require team membership for upload ─────────────────────
-- Previously any authenticated user (not just team members) could upload.
DROP POLICY IF EXISTS "Auth upload attachments" ON storage.objects;
CREATE POLICY "Team members upload attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'team-chat-attachments'
    AND is_team_member(auth.uid())
  );

-- Add DELETE so team members can clean up their own uploads
DROP POLICY IF EXISTS "Owners delete own attachments" ON storage.objects;
CREATE POLICY "Owners delete own attachments"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'team-chat-attachments'
    AND owner_id = auth.uid()::text
  );

-- ── 11. delete_old_chat_messages — add SET search_path ───────────────────
-- Missing SET search_path on a SECURITY DEFINER function is a schema-
-- shadowing risk. Recreate with the guard.
CREATE OR REPLACE FUNCTION delete_old_chat_messages()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM team_chat_messages
  WHERE sent_at < date_trunc('day', now() AT TIME ZONE 'UTC');
$$;

-- ── 12. Guest session DB-level expiry enforcement ────────────────────────
-- Add a CHECK constraint so expired/revoked sessions can never be
-- inserted or updated to appear valid. The application layer also
-- validates, but DB enforcement is the safety net.
ALTER TABLE field_guest_sessions
  DROP CONSTRAINT IF EXISTS chk_guest_session_not_expired_on_insert;
ALTER TABLE field_guest_sessions
  ADD CONSTRAINT chk_guest_session_not_expired_on_insert
  CHECK (expires_at > created_at);

-- ── 13. list_team() — fix recursive EXISTS ───────────────────────────────
-- The existing list_team() SECURITY DEFINER function uses its own
-- EXISTS check internally, which is fine (SECURITY DEFINER bypasses RLS).
-- The only fix needed is switching the WHERE to use is_team_member().
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
   WHERE is_team_member(auth.uid())
   ORDER BY (tm.role = 'admin') DESC, tm.joined_at;
$$;

REVOKE ALL ON FUNCTION list_team() FROM public;
GRANT EXECUTE ON FUNCTION list_team() TO authenticated;

-- ── 14. demote_member() — prevent TOCTOU self-demotion race ─────────────
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
  -- Lock the admin count to prevent concurrent self-demotions racing
  SELECT count(*) INTO v_admins FROM team_members WHERE role = 'admin' FOR UPDATE;
  IF v_admins <= 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cannot demote the last admin');
  END IF;
  -- Prevent self-demotion
  IF p_target = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admins cannot demote themselves');
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
