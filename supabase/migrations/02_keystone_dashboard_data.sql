-- ════════════════════════════════════════════════════════════════════════
-- KeyStone Dashboard Data Persistence
-- Stores processed GeoJSON + analysis blobs so data survives server restarts.
-- Run in Supabase SQL Editor: Project → SQL Editor → New query
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS keystone_dashboard_data (
  data_type   TEXT PRIMARY KEY,   -- 'community_contact' | 'iaq_survey'
  payload     JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update timestamp on upsert
CREATE OR REPLACE FUNCTION _kd_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_kd_updated_at ON keystone_dashboard_data;
CREATE TRIGGER trg_kd_updated_at
  BEFORE INSERT OR UPDATE ON keystone_dashboard_data
  FOR EACH ROW EXECUTE FUNCTION _kd_set_updated_at();

-- Row Level Security — service role (server) bypasses automatically
ALTER TABLE keystone_dashboard_data ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read (dashboard frontend)
CREATE POLICY "auth_read_dashboard_data"
  ON keystone_dashboard_data FOR SELECT
  TO authenticated
  USING (true);

-- Only service role (server) writes — no direct client writes
-- (service role bypasses RLS, so no INSERT/UPDATE policy needed for it)
