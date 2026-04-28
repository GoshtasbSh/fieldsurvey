-- ════════════════════════════════════════════════════════════════════════
-- 05. TEAM CHAT MESSAGES
--   Ephemeral real-time team chat for the dashboard Team tab.
--   Rows for previous UTC days are purged at midnight via pg_cron so the
--   table stays small. The SELECT RLS policy is a second layer that hides
--   old rows from clients even if the cron job hasn't run yet.
-- ════════════════════════════════════════════════════════════════════════

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_chat_messages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT        NOT NULL,
  body         TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tcm_sent_at ON team_chat_messages(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_tcm_user    ON team_chat_messages(user_id);

-- ── Row Level Security ────────────────────────────────────────────────────
ALTER TABLE team_chat_messages ENABLE ROW LEVEL SECURITY;

-- Authenticated users can only see today's messages (UTC)
DROP POLICY IF EXISTS "Read today chat" ON team_chat_messages;
CREATE POLICY "Read today chat"
  ON team_chat_messages FOR SELECT
  TO authenticated
  USING (sent_at::date = CURRENT_DATE);

-- A user can only insert messages as themselves
DROP POLICY IF EXISTS "Insert own chat" ON team_chat_messages;
CREATE POLICY "Insert own chat"
  ON team_chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- No client DELETE policy — cleanup is server-only via SECURITY DEFINER function

-- ── Realtime ──────────────────────────────────────────────────────────────
-- Same pattern as field_survey_points and user_presence
ALTER PUBLICATION supabase_realtime ADD TABLE team_chat_messages;

-- ── Ephemeral cleanup function ────────────────────────────────────────────
-- SECURITY DEFINER runs as the function owner, bypassing RLS for the DELETE.
CREATE OR REPLACE FUNCTION delete_old_chat_messages()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM team_chat_messages
  WHERE sent_at < date_trunc('day', now() AT TIME ZONE 'UTC');
$$;

-- ── pg_cron schedule ──────────────────────────────────────────────────────
-- Enable the pg_cron extension in Supabase Dashboard → Database → Extensions
-- before uncommenting this block, then run it once:
/*
SELECT cron.schedule(
  'keystone-chat-cleanup',
  '0 0 * * *',
  $$ SELECT delete_old_chat_messages() $$
);
*/
-- To verify: SELECT * FROM cron.job WHERE jobname = 'keystone-chat-cleanup';
