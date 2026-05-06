-- ════════════════════════════════════════════════════════════════════════
-- KeyStone Field — Supabase Schema
-- Run this in the Supabase SQL editor (Project → SQL Editor → New query)
-- ════════════════════════════════════════════════════════════════════════

-- ── Enable PostGIS (needed for geography types if you want spatial queries)
-- CREATE EXTENSION IF NOT EXISTS postgis;

-- ════════════════════════════════════════════════════════════════════════
-- 1. FIELD SURVEY POINTS
--    Registered by surveyors in the field (real-time, Realtime-enabled)
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS field_survey_points (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lat             DOUBLE PRECISION NOT NULL,
  lon             DOUBLE PRECISION NOT NULL,
  status          TEXT NOT NULL CHECK (status IN (
                    'Completed','No Answer','Inaccessible','Not Interested',
                    'Left Info','Vacant','Follow Up','Other','Unknown'
                  )),
  notes           TEXT,
  collector_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  collector_name  TEXT,
  collected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_offline      BOOLEAN NOT NULL DEFAULT false  -- true if submitted from offline queue
);

CREATE INDEX IF NOT EXISTS idx_fsp_status       ON field_survey_points(status);
CREATE INDEX IF NOT EXISTS idx_fsp_collected_at ON field_survey_points(collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fsp_collector    ON field_survey_points(collector_id);

-- Enable Realtime so clients receive live INSERT events
ALTER PUBLICATION supabase_realtime ADD TABLE field_survey_points;

-- Row Level Security
ALTER TABLE field_survey_points ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all points (real-time map visibility)
CREATE POLICY "Surveyors can read all points"
  ON field_survey_points FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert their own points
CREATE POLICY "Surveyors can insert their own points"
  ON field_survey_points FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = collector_id);

-- Only the inserter can update their own point (e.g., correct a mistake)
CREATE POLICY "Surveyors can update their own points"
  ON field_survey_points FOR UPDATE
  TO authenticated
  USING (auth.uid() = collector_id);

-- Nobody can delete points (data integrity — admin only via service role)
-- No DELETE policy needed; absence of policy denies it.


-- ════════════════════════════════════════════════════════════════════════
-- 2. COMMUNITY CONTACTS
--    Uploaded from the previous Excel survey file.
--    Future field points update this via the dashboard.
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS community_contacts (
  id              SERIAL PRIMARY KEY,
  address         TEXT,
  status          TEXT,
  status_detail   TEXT,
  second_attempt  TEXT,
  survey_date     DATE,
  notes           TEXT,
  street_name     TEXT,
  matched_address TEXT,
  lat             DOUBLE PRECISION,
  lon             DOUBLE PRECISION,
  color           TEXT,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cc_street ON community_contacts(street_name);
CREATE INDEX IF NOT EXISTS idx_cc_status ON community_contacts(status);

ALTER TABLE community_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read community contacts"
  ON community_contacts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert community contacts"
  ON community_contacts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update community contacts"
  ON community_contacts FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete community contacts"
  ON community_contacts FOR DELETE
  TO authenticated
  USING (true);


-- ════════════════════════════════════════════════════════════════════════
-- 3. IAQ SURVEYS
--    Uploaded from Qualtrics CSV exports.
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS iaq_surveys (
  id            SERIAL PRIMARY KEY,
  street_name   TEXT,
  health_score  INT,
  iaq_score     INT,
  struct_score  INT,
  overall_risk  INT,
  risk_tier     TEXT,
  ownership     TEXT,
  housing_type  TEXT,
  year_built    TEXT,
  condition     TEXT,
  has_mold      BOOLEAN,
  lat           DOUBLE PRECISION,
  lon           DOUBLE PRECISION,
  color         TEXT,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iaq_street ON iaq_surveys(street_name);
CREATE INDEX IF NOT EXISTS idx_iaq_risk   ON iaq_surveys(overall_risk);

ALTER TABLE iaq_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read IAQ surveys"
  ON iaq_surveys FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert IAQ surveys"
  ON iaq_surveys FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can delete IAQ surveys"
  ON iaq_surveys FOR DELETE
  TO authenticated
  USING (true);


-- ════════════════════════════════════════════════════════════════════════
-- 4. PARCELS
--    Pre-loaded once from the GDB file via export_parcels_to_supabase.py.
--    Read-only from the app.
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS parcels (
  id            SERIAL PRIMARY KEY,
  parcel_id     TEXT UNIQUE,
  address       TEXT,
  land_use      TEXT,
  just_value    FLOAT,
  assessed_value FLOAT,
  living_area   FLOAT,
  year_built    INT,
  geometry      JSONB  -- GeoJSON polygon (from shapely to_json())
);

CREATE INDEX IF NOT EXISTS idx_parcels_parcel_id ON parcels(parcel_id);
CREATE INDEX IF NOT EXISTS idx_parcels_address   ON parcels(address);

ALTER TABLE parcels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read parcels"
  ON parcels FOR SELECT
  USING (true);  -- Public read (parcel data is public record)


-- ════════════════════════════════════════════════════════════════════════
-- 5. REPORT CONFIG
--    Daily CSV email target — set via dashboard settings page.
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS report_config (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE report_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read report config"
  ON report_config FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can upsert report config"
  ON report_config FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update report config"
  ON report_config FOR UPDATE
  TO authenticated USING (true);


-- ════════════════════════════════════════════════════════════════════════
-- 6. USEFUL VIEWS
-- ════════════════════════════════════════════════════════════════════════

-- Daily summary view (used by Edge Function to build CSV email)
CREATE OR REPLACE VIEW daily_report AS
SELECT
  fsp.id,
  fsp.lat,
  fsp.lon,
  fsp.status,
  fsp.notes,
  fsp.collector_name,
  fsp.collected_at::date                      AS survey_date,
  fsp.collected_at,
  cc.address                                  AS matched_address,
  cc.street_name
FROM field_survey_points fsp
LEFT JOIN community_contacts cc
  ON round(fsp.lat::numeric, 4) = round(cc.lat::numeric, 4)
 AND round(fsp.lon::numeric, 4) = round(cc.lon::numeric, 4)
ORDER BY fsp.collected_at DESC;

-- Status summary for quick analysis
CREATE OR REPLACE VIEW status_summary AS
SELECT
  status,
  COUNT(*)                                    AS total,
  COUNT(*) FILTER (WHERE collected_at::date = CURRENT_DATE) AS today,
  MAX(collected_at)                           AS last_at
FROM field_survey_points
GROUP BY status
ORDER BY total DESC;


-- ════════════════════════════════════════════════════════════════════════
-- 7. SEED: Insert initial report config row
-- ────────────────────────────────────────────────────────────────────────
-- After running this migration, set the recipient email manually:
--   UPDATE report_config SET email = 'you@example.com', active = true;
-- (Or set KEYSTONE_REPORT_EMAIL in your .env and run a one-off seed script.)
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO report_config (email, active)
VALUES ('CHANGE_ME@example.com', false)
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════════════════
-- HOW TO USE
-- ════════════════════════════════════════════════════════════════════════
-- 1. Go to your new Supabase project → SQL Editor → New query
-- 2. Paste this entire file and click Run
-- 3. Copy your project URL + anon key from Project Settings → API
-- 4. Paste them into keystone_field_web/index.html:
--      const SUPABASE_URL  = 'https://xxxxxxxxxxxxxxxx.supabase.co';
--      const SUPABASE_ANON = 'eyJhbGci...';
-- 5. Enable Realtime: Supabase Dashboard → Database → Replication
--    → Make sure "field_survey_points" is checked
-- ════════════════════════════════════════════════════════════════════════
