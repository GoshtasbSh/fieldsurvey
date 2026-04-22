-- ════════════════════════════════════════════════════════════════════════
-- KeyStone Analysis Version History
-- Stores named snapshots of processed community-contact and IAQ data
-- so the dashboard can roll back to any past analysis.
-- Run in Supabase SQL Editor: Project → SQL Editor → New query
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS keystone_analysis_versions (
  id          SERIAL PRIMARY KEY,
  data_type   TEXT NOT NULL,           -- 'community_contact' | 'iaq_survey'
  payload     JSONB NOT NULL,
  label       TEXT,                    -- e.g. "Daily Update 2026-04-22 — 12 new visits"
  n_points    INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kav_type_date
  ON keystone_analysis_versions (data_type, created_at DESC);

ALTER TABLE keystone_analysis_versions ENABLE ROW LEVEL SECURITY;

-- Authenticated dashboard users can read history
CREATE POLICY "auth_read_versions"
  ON keystone_analysis_versions FOR SELECT
  TO authenticated USING (true);

-- Only service role (server) may write (RLS bypass) — no client-side INSERT


-- ════════════════════════════════════════════════════════════════════════
-- Daily cron: call /api/daily-refresh every day at 06:00 UTC
-- Requires pg_cron + pg_net extensions (enable in Supabase Dashboard →
-- Database → Extensions).  Replace YOUR_SERVER_URL with your server's URL.
--
-- SELECT cron.schedule(
--   'keystone-daily-refresh',
--   '0 6 * * *',
--   $$ SELECT net.http_post(
--        url     := 'https://YOUR_SERVER_URL/api/daily-refresh',
--        headers := '{"Content-Type":"application/json"}'::jsonb,
--        body    := '{}'::jsonb
--      ) $$
-- );
-- ════════════════════════════════════════════════════════════════════════
