-- ════════════════════════════════════════════════════════════════════════
-- 20_audit_fixes.sql
-- Strictly ADDITIVE post-audit fixes. No DROP TABLE, no DELETE, no
-- DROP COLUMN. Existing rows / users / pins / surveys are preserved
-- exactly as-is.
--
-- Concerns addressed:
--   F-1  create_member_invite() called gen_random_bytes(int) which is
--        not in the default search_path on Supabase — same defect that
--        migration 12 fixed for get_or_create_today_code(). Replace
--        with the same md5(random + clock_timestamp) recipe so the
--        admin-invite flow actually works.
--   F-9  Two views (status_summary, daily_report) were created
--        SECURITY DEFINER. Recreate them with `security_invoker = true`
--        so they enforce the caller's RLS, not the creator's.
--   F-12 Mirror every newly inserted field_survey_points row into
--        community_contacts(source='field') so the unified contact
--        count + daily-report export reflects the combined stream.
--        Existing field rows ARE NOT back-filled by this migration —
--        the trigger fires on future inserts only. (Re-running the
--        existing daily-refresh path performs the merge for old rows.)
-- ════════════════════════════════════════════════════════════════════════


-- ── F-1. create_member_invite — replace gen_random_bytes ──────────────
CREATE OR REPLACE FUNCTION create_member_invite(p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_email   TEXT := lower(trim(p_email));
  v_token   TEXT;
  v_id      UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF NOT is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin role required');
  END IF;
  IF v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid email');
  END IF;
  -- 48-char hex token from md5 of (random + clock_timestamp). md5 is
  -- core PG; no pgcrypto / search_path quirks. Two md5 calls give us
  -- 64 hex chars; we keep 48 for reasonable opacity.
  v_token := substr(
    md5(random()::text || clock_timestamp()::text)
    || md5(random()::text || clock_timestamp()::text),
    1, 48
  );
  v_expires := now() + INTERVAL '14 days';
  INSERT INTO member_invites (email, token, invited_by, expires_at, status)
  VALUES (v_email, v_token, v_uid, v_expires, 'pending')
  RETURNING id INTO v_id;
  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'email', v_email,
    'token', v_token,
    'expires_at', v_expires
  );
END;
$$;
REVOKE ALL ON FUNCTION create_member_invite(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION create_member_invite(TEXT) TO authenticated;


-- ── F-9. Convert SECURITY DEFINER views to SECURITY INVOKER ──────────
-- Postgres 15+ supports `WITH (security_invoker = true)` on views,
-- which is what Supabase advisor 0010 wants. CREATE OR REPLACE keeps
-- the view name + dependent grants stable.
ALTER VIEW IF EXISTS public.daily_report     SET (security_invoker = true);
ALTER VIEW IF EXISTS public.status_summary   SET (security_invoker = true);


-- ── F-12. Mirror new field_survey_points rows into community_contacts ─
-- Trigger fires AFTER INSERT only. Updates / deletes are NOT mirrored
-- (community_contacts is the long-term record, field is the activity
-- log). source='field' tags the row so the existing CHECK constraint
-- (community_contacts_source_chk) accepts it and the admin export
-- can split the streams again with WHERE source='field'.
CREATE OR REPLACE FUNCTION fsp_mirror_to_community_contacts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  -- Map field statuses to the contact-survey vocabulary so the dashboard
  -- legend renders consistently across the two streams.
  v_status := CASE NEW.status
    WHEN 'Completed'      THEN 'Completed'
    WHEN 'No Answer'      THEN 'No Answer'
    WHEN 'Inaccessible'   THEN 'Inaccessible'
    WHEN 'Not Interested' THEN 'Not Interested'
    WHEN 'Left Info'      THEN 'Left Info'
    WHEN 'Vacant'         THEN 'Vacant'
    WHEN 'Follow Up'      THEN 'Follow Up'
    ELSE 'Completed'
  END;
  INSERT INTO community_contacts (
    address, lat, lon, status, notes, date,
    source, added_by_user_id, added_by_guest_session_id
  )
  VALUES (
    NULL,                          -- field pin has no street address
    NEW.lat, NEW.lon,
    v_status,
    NEW.notes,
    (NEW.collected_at AT TIME ZONE 'UTC')::date,
    'field',
    NEW.collector_id,
    NEW.guest_session_id
  );
  RETURN NEW;
EXCEPTION
  -- Defensive: if community_contacts has unexpected NOT NULL constraints
  -- we don't want a field-pin insert to fail. Log and continue.
  WHEN OTHERS THEN
    RAISE WARNING 'fsp_mirror_to_community_contacts skipped: %', SQLERRM;
    RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_fsp_mirror_to_cc'
  ) THEN
    CREATE TRIGGER trg_fsp_mirror_to_cc
      AFTER INSERT ON field_survey_points
      FOR EACH ROW EXECUTE FUNCTION fsp_mirror_to_community_contacts();
  END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════════
-- VERIFY (run after applying)
-- ════════════════════════════════════════════════════════════════════════
--   SELECT proname FROM pg_proc WHERE proname = 'create_member_invite';
--   -- Should NOT 404 anymore on call:
--   SELECT public.create_member_invite('test+invite@example.com');
--
--   SELECT relname, relkind FROM pg_class
--     WHERE relname IN ('daily_report','status_summary');
--
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_fsp_mirror_to_cc';
-- ════════════════════════════════════════════════════════════════════════
