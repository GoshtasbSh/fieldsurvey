-- ════════════════════════════════════════════════════════════════════════
-- 14_guest_chat_and_team.sql
-- Make team_chat_messages accept rows authored by ephemeral guest
-- sessions, so the mobile field app's team chat works for everyone
-- (admin / member / guest).
--
-- Schema changes:
--   * user_id becomes NULLABLE (was NOT NULL → references auth.users).
--     Guests have no auth.users row, so we set user_id = NULL on their
--     messages.
--   * Add guest_session_id UUID FK → field_guest_sessions(id) for audit.
--
-- Constraint: every message must have either a user_id (authed members)
-- OR a guest_session_id (guest surveyors). Both NULL is rejected.
--
-- RLS: existing policies remain in place for direct PostgREST writes by
-- members. Guest writes go through /api/guest (service-role) which
-- bypasses RLS entirely.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE team_chat_messages
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE team_chat_messages
  ADD COLUMN IF NOT EXISTS guest_session_id UUID
    REFERENCES field_guest_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tcm_guest_session
  ON team_chat_messages(guest_session_id);

-- Either user_id OR guest_session_id must be set. Idempotent — drop
-- first in case this migration is re-run.
ALTER TABLE team_chat_messages
  DROP CONSTRAINT IF EXISTS team_chat_messages_author_present;
ALTER TABLE team_chat_messages
  ADD  CONSTRAINT team_chat_messages_author_present
       CHECK (user_id IS NOT NULL OR guest_session_id IS NOT NULL);
