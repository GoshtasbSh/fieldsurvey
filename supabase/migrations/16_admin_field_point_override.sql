-- ════════════════════════════════════════════════════════════════════════
-- 16_admin_field_point_override.sql
-- Lets admins edit/delete ANY field-survey point, not just their own.
-- Members + guests still own their pins exclusively (a member can't touch
-- another member's pins; guests use /api/guest with server-side session
-- ownership check).
--
-- Why: by default migration 10 restricted UPDATE/DELETE on
-- field_survey_points to `auth.uid() = collector_id` (own row only).
-- Admins (PIs reviewing field work) need to be able to correct or
-- remove any pin, regardless of who collected it. The server's
-- is_admin(auth.uid()) helper from migration 09 makes the gate trivial.
-- ════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Team members update their own points"          ON field_survey_points;
DROP POLICY IF EXISTS "Team members update their own points or admin" ON field_survey_points;
DROP POLICY IF EXISTS "Team members delete their own points"          ON field_survey_points;
DROP POLICY IF EXISTS "Team members delete their own points or admin" ON field_survey_points;

CREATE POLICY "Team members update their own points or admin"
  ON field_survey_points FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = auth.uid())
    AND (auth.uid() = collector_id OR is_admin(auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = auth.uid())
    AND (auth.uid() = collector_id OR is_admin(auth.uid()))
  );

CREATE POLICY "Team members delete their own points or admin"
  ON field_survey_points FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = auth.uid())
    AND (auth.uid() = collector_id OR is_admin(auth.uid()))
  );
