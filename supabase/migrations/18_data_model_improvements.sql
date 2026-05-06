-- ════════════════════════════════════════════════════════════════════════
-- 18_data_model_improvements.sql
-- Three standalone improvements:
--   1. survey_responses  — stores raw QID-keyed Qualtrics answers per IAQ
--      survey row, enabling future re-analysis without re-upload.
--   2. invite_codes cleanup — delete codes older than 30 days automatically.
--   3. team_chat_messages — prevent empty body + null attachment messages.
--   4. keystone_analysis_versions — tighten READ to team members (was any auth)
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. survey_responses — raw QID-keyed Qualtrics answers ───────────────
-- Each row pairs an IAQ survey feature's stable geocoded identity (address
-- + parcel_id) with the full raw_answers JSONB from the uploaded CSV.
-- Enables weight changes, new question additions, and auditing without
-- requiring a CSV re-upload.
CREATE TABLE IF NOT EXISTS survey_responses (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_batch_id     UUID        NOT NULL,         -- groups rows from one upload
  qualtrics_resp_id   TEXT,                         -- Qualtrics ResponseId column
  address             TEXT,                         -- Q212 typed address
  parcel_id           TEXT,                         -- matched FL DOR parcel ID
  street_name         TEXT,                         -- canonicalised street
  geocode_source      TEXT,                         -- 'gps' | 'address_matched' | 'geocoded'
  raw_answers         JSONB       NOT NULL,         -- full QID-keyed answer map
  computed_scores     JSONB,                        -- health/iaq/struct/risk at upload time
  recorded_at         TIMESTAMPTZ,                  -- Qualtrics EndDate / RecordedDate
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sr_batch   ON survey_responses(upload_batch_id);
CREATE INDEX IF NOT EXISTS idx_sr_parcel  ON survey_responses(parcel_id);
CREATE INDEX IF NOT EXISTS idx_sr_street  ON survey_responses(street_name);
CREATE INDEX IF NOT EXISTS idx_sr_created ON survey_responses(created_at DESC);

ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;

-- Team members can read; only service role (upload pipeline) writes.
CREATE POLICY "Team members read survey_responses"
  ON survey_responses FOR SELECT
  TO authenticated
  USING (is_team_member(auth.uid()));

-- ── 2. invite_codes — automatic cleanup of codes older than 30 days ─────
-- Invite codes accumulate one per day with no expiry. This function deletes
-- codes older than 30 days and is scheduled via pg_cron.
CREATE OR REPLACE FUNCTION cleanup_old_invite_codes()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM invite_codes
  WHERE date < (CURRENT_DATE - INTERVAL '30 days');
$$;

REVOKE ALL ON FUNCTION cleanup_old_invite_codes() FROM public;
GRANT EXECUTE ON FUNCTION cleanup_old_invite_codes() TO service_role;

-- Enable with: SELECT cron.schedule('keystone-invite-cleanup', '0 1 * * *',
--   $$ SELECT cleanup_old_invite_codes() $$);

-- ── 3. team_chat_messages — prevent empty body + null attachment rows ────
-- Migration 07 relaxed body to allow 0 length; migration 14 allowed
-- user_id = NULL for guests. Together they permit a row with no body AND
-- no attachment — semantically meaningless.
ALTER TABLE team_chat_messages
  DROP CONSTRAINT IF EXISTS chk_chat_has_content;
ALTER TABLE team_chat_messages
  ADD CONSTRAINT chk_chat_has_content
  CHECK (char_length(body) > 0 OR attachment_url IS NOT NULL);

-- ── 4. keystone_analysis_versions — tighten READ to team members ─────────
-- Migration 03 set it to any authenticated; migration 17 fixed dashboard
-- data but versions table was missed.
DROP POLICY IF EXISTS "auth_read_versions"           ON keystone_analysis_versions;
DROP POLICY IF EXISTS "Team members read analysis versions" ON keystone_analysis_versions;

CREATE POLICY "Team members read analysis versions"
  ON keystone_analysis_versions FOR SELECT
  TO authenticated
  USING (is_team_member(auth.uid()));
