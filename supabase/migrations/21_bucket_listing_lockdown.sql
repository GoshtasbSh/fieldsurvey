-- ════════════════════════════════════════════════════════════════════════
-- 21_bucket_listing_lockdown.sql
-- F-10: Stop anonymous listing of the team-chat-attachments storage
-- bucket. Public buckets serve objects via direct URL without needing
-- a SELECT policy, so we narrow the existing "Public read attachments"
-- policy to authenticated team members only.
--
-- Files in the bucket are PRESERVED — only the policy expression
-- changes. No DELETE, no DROP, no destructive ops.
--
-- Already applied to production via Supabase MCP on 2026-05-07.
-- This file is committed for reproducibility / re-deploy parity.
-- ════════════════════════════════════════════════════════════════════════

ALTER POLICY "Public read attachments"
  ON storage.objects
  USING (
    bucket_id = 'team-chat-attachments'
    AND auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.id = auth.uid())
  );


-- ════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ════════════════════════════════════════════════════════════════════════
--   SELECT policyname, qual
--     FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND policyname = 'Public read attachments';
-- ════════════════════════════════════════════════════════════════════════
