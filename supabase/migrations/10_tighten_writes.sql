-- ════════════════════════════════════════════════════════════════════════
-- 10_tighten_writes.sql
-- Replace permissive RLS on data tables with team-member-only reads and
-- admin-only writes. Field-survey inserts continue to be self-only.
-- ────────────────────────────────────────────────────────────────────────
-- IMPORTANT — apply 09_team_membership.sql FIRST and verify your user has
-- a team_members row with role='admin' before running this migration; once
-- this lands, only admins can run the upload pipelines. Bootstrap path:
--
--   1. Sign in to the dashboard / field app at least once so auth.users has your row.
--   2. Run 09_team_membership.sql (seeds your email as admin via the INSERT … SELECT … WHERE email).
--   3. Verify: SELECT * FROM team_members WHERE id = auth.uid();   -- role='admin'
--   4. Run 10_tighten_writes.sql.
-- ════════════════════════════════════════════════════════════════════════

-- ── community_contacts ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can read community contacts"   ON community_contacts;
DROP POLICY IF EXISTS "Authenticated users can insert community contacts" ON community_contacts;
DROP POLICY IF EXISTS "Authenticated users can update community contacts" ON community_contacts;
DROP POLICY IF EXISTS "Authenticated users can delete community contacts" ON community_contacts;
DROP POLICY IF EXISTS "Team members read community_contacts"              ON community_contacts;
DROP POLICY IF EXISTS "Admins write community_contacts (insert)"          ON community_contacts;
DROP POLICY IF EXISTS "Admins write community_contacts (update)"          ON community_contacts;
DROP POLICY IF EXISTS "Admins write community_contacts (delete)"          ON community_contacts;

CREATE POLICY "Team members read community_contacts"
  ON community_contacts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = auth.uid()));

CREATE POLICY "Admins write community_contacts (insert)"
  ON community_contacts FOR INSERT TO authenticated
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Admins write community_contacts (update)"
  ON community_contacts FOR UPDATE TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Admins write community_contacts (delete)"
  ON community_contacts FOR DELETE TO authenticated
  USING (is_admin(auth.uid()));

-- ── iaq_surveys ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can read IAQ surveys"   ON iaq_surveys;
DROP POLICY IF EXISTS "Authenticated users can insert IAQ surveys" ON iaq_surveys;
DROP POLICY IF EXISTS "Authenticated users can delete IAQ surveys" ON iaq_surveys;
DROP POLICY IF EXISTS "Team members read iaq_surveys"              ON iaq_surveys;
DROP POLICY IF EXISTS "Admins write iaq_surveys (insert)"          ON iaq_surveys;
DROP POLICY IF EXISTS "Admins write iaq_surveys (update)"          ON iaq_surveys;
DROP POLICY IF EXISTS "Admins write iaq_surveys (delete)"          ON iaq_surveys;

CREATE POLICY "Team members read iaq_surveys"
  ON iaq_surveys FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = auth.uid()));

CREATE POLICY "Admins write iaq_surveys (insert)"
  ON iaq_surveys FOR INSERT TO authenticated
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Admins write iaq_surveys (update)"
  ON iaq_surveys FOR UPDATE TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Admins write iaq_surveys (delete)"
  ON iaq_surveys FOR DELETE TO authenticated
  USING (is_admin(auth.uid()));

-- ── report_config ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can read report config"   ON report_config;
DROP POLICY IF EXISTS "Authenticated users can upsert report config" ON report_config;
DROP POLICY IF EXISTS "Authenticated users can update report config" ON report_config;
DROP POLICY IF EXISTS "Team members read report_config"              ON report_config;
DROP POLICY IF EXISTS "Admins write report_config (insert)"          ON report_config;
DROP POLICY IF EXISTS "Admins write report_config (update)"          ON report_config;

CREATE POLICY "Team members read report_config"
  ON report_config FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = auth.uid()));

CREATE POLICY "Admins write report_config (insert)"
  ON report_config FOR INSERT TO authenticated
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Admins write report_config (update)"
  ON report_config FOR UPDATE TO authenticated
  USING (is_admin(auth.uid()));

-- ── field_survey_points ───────────────────────────────────────────────
-- SELECT: team members only (was: any authenticated).
-- INSERT: own row only AND user must be a team member.
-- UPDATE: own row only AND user must be a team member.
-- DELETE: own row only AND user must be a team member (was: 08_field_point_rls_fix
--         allowed any authenticated owner; we tighten to team-member-only so
--         stale auth.users rows that aren't in team_members can't delete).
DROP POLICY IF EXISTS "Surveyors can read all points"           ON field_survey_points;
DROP POLICY IF EXISTS "Surveyors can insert their own points"   ON field_survey_points;
DROP POLICY IF EXISTS "Surveyors can update their own points"   ON field_survey_points;
DROP POLICY IF EXISTS "Surveyors can delete their own points"   ON field_survey_points;
DROP POLICY IF EXISTS "Team members can read field points"      ON field_survey_points;
DROP POLICY IF EXISTS "Team members insert their own points"    ON field_survey_points;
DROP POLICY IF EXISTS "Team members update their own points"    ON field_survey_points;
DROP POLICY IF EXISTS "Team members delete their own points"    ON field_survey_points;

CREATE POLICY "Team members can read field points"
  ON field_survey_points FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = auth.uid()));

CREATE POLICY "Team members insert their own points"
  ON field_survey_points FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = collector_id
    AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = auth.uid())
  );

CREATE POLICY "Team members update their own points"
  ON field_survey_points FOR UPDATE TO authenticated
  USING (
    auth.uid() = collector_id
    AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = auth.uid())
  )
  WITH CHECK (
    auth.uid() = collector_id
    AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = auth.uid())
  );

CREATE POLICY "Team members delete their own points"
  ON field_survey_points FOR DELETE TO authenticated
  USING (
    auth.uid() = collector_id
    AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = auth.uid())
  );
