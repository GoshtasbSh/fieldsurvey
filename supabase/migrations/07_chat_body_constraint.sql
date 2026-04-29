-- ════════════════════════════════════════════════════════════════════════
-- 07. RELAX CHAT BODY CHECK CONSTRAINT
--   The original CHECK required body length BETWEEN 1 AND 1000, which
--   blocked attachment-only messages (empty body string). Relax to
--   allow empty body while keeping the 1000-char upper limit.
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE team_chat_messages
  DROP CONSTRAINT IF EXISTS team_chat_messages_body_check;

ALTER TABLE team_chat_messages
  ADD CONSTRAINT team_chat_messages_body_check
  CHECK (char_length(body) <= 1000);
