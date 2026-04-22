-- ════════════════════════════════════════════════════════════════════════
-- 04. USER PRESENCE
--   Last-active heartbeat so the team panel can show "active now / X min ago"
--   even when a teammate is online but hasn't collected a point yet.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_presence (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name    TEXT,
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_page       TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_presence_active
  ON user_presence(last_active_at DESC);

-- Auto-bump updated_at on every upsert
CREATE OR REPLACE FUNCTION user_presence_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_presence_touch ON user_presence;
CREATE TRIGGER trg_user_presence_touch
  BEFORE INSERT OR UPDATE ON user_presence
  FOR EACH ROW EXECUTE FUNCTION user_presence_touch();

-- Realtime so the team panel live-updates when anyone heartbeats
ALTER PUBLICATION supabase_realtime ADD TABLE user_presence;

ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read everyone's presence (team panel needs this)
CREATE POLICY "Read all presence"
  ON user_presence FOR SELECT
  TO authenticated
  USING (true);

-- A user can only insert/update their own presence row
CREATE POLICY "Insert own presence"
  ON user_presence FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Update own presence"
  ON user_presence FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
