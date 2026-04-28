-- ════════════════════════════════════════════════════════════════════════
-- 06. TEAM CHAT ATTACHMENTS
--   Adds optional attachment_url and attachment_type columns so team
--   members can share images and documents in chat messages.
--   attachment_type values: 'image' | 'document' | NULL (text-only)
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE team_chat_messages
  ADD COLUMN IF NOT EXISTS attachment_url  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_type TEXT;

-- ── Supabase Storage bucket ───────────────────────────────────────────────
-- Creates the public storage bucket for chat attachments.
-- Max 5 MB per file; images + PDF + Word documents allowed.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'team-chat-attachments',
  'team-chat-attachments',
  true,
  5242880,
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ── Storage RLS policies ──────────────────────────────────────────────────
-- Anyone can read (images render publicly in chat bubbles)
DROP POLICY IF EXISTS "Public read attachments" ON storage.objects;
CREATE POLICY "Public read attachments"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'team-chat-attachments');

-- Authenticated users can upload
DROP POLICY IF EXISTS "Auth upload attachments" ON storage.objects;
CREATE POLICY "Auth upload attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'team-chat-attachments');
