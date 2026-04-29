-- ════════════════════════════════════════════════════════════════════════
-- 08. FIX FIELD_SURVEY_POINTS RLS
--   • UPDATE policy was missing WITH CHECK, allowing collector_id hijack.
--   • DELETE policy did not exist; owners could not remove their own points.
-- ════════════════════════════════════════════════════════════════════════

-- Recreate UPDATE policy with proper WITH CHECK
DROP POLICY IF EXISTS "Surveyors can update their own points" ON field_survey_points;
CREATE POLICY "Surveyors can update their own points"
  ON field_survey_points FOR UPDATE
  TO authenticated
  USING  (auth.uid() = collector_id)
  WITH CHECK (auth.uid() = collector_id);

-- Allow owners to delete their own points
CREATE POLICY "Surveyors can delete their own points"
  ON field_survey_points FOR DELETE
  TO authenticated
  USING (auth.uid() = collector_id);
