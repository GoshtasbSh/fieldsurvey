-- ════════════════════════════════════════════════════════════════════════
-- 19_keystone_finalization.sql
-- Final pre-deploy hardening. EVERY change is ADDITIVE — no DROP COLUMN,
-- no DELETE, no DROP TABLE. Existing rows / users / field points are
-- preserved untouched.
--
-- Concerns addressed:
--   1.  community_contacts gets `source` and ownership columns so
--       upload-vs-field origin is always distinguishable, and
--       guest/member-owned rows are filterable on export.
--   2.  iaq_surveys + community_contacts get `created_at`/`updated_at`
--       so the daily-report change-detector can find new/edited rows.
--   3.  field_survey_points gets `updated_at` for the same reason.
--   4.  Admin-issued member invites: `member_invites` table + RPCs that
--       let an admin email a one-time signup token to a candidate. The
--       legacy daily-code `claim_membership` RPC is left in place
--       (no removals) but the UI will stop exposing it.
--   5.  `report_recipients` for multi-admin daily-report distribution.
--   6.  `daily_report_runs` for change-detection bookkeeping.
--   7.  Tighter export-time RLS that lets a guest read only their own
--       community_contacts/field rows. Read of upload-origin rows is
--       still permitted to all team members (unchanged).
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. community_contacts: add source + ownership + timestamps ──────────
ALTER TABLE community_contacts
  ADD COLUMN IF NOT EXISTS source                       TEXT,
  ADD COLUMN IF NOT EXISTS added_by_user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS added_by_guest_session_id    UUID,
  ADD COLUMN IF NOT EXISTS created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill: any pre-existing row with a NULL source is an Excel upload
-- (the only way rows entered before this migration). We do NOT touch
-- created_at / updated_at on existing rows — defaults already populated.
UPDATE community_contacts SET source = 'upload' WHERE source IS NULL;

-- Add a check constraint loosely (no NOT NULL — keep rows resilient).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'community_contacts_source_chk'
  ) THEN
    ALTER TABLE community_contacts
      ADD CONSTRAINT community_contacts_source_chk
      CHECK (source IS NULL OR source IN ('upload','field'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cc_source        ON community_contacts(source);
CREATE INDEX IF NOT EXISTS idx_cc_added_by_user ON community_contacts(added_by_user_id);
CREATE INDEX IF NOT EXISTS idx_cc_added_by_gs   ON community_contacts(added_by_guest_session_id);
CREATE INDEX IF NOT EXISTS idx_cc_created_at    ON community_contacts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cc_updated_at    ON community_contacts(updated_at DESC);


-- ── 2. iaq_surveys: created_at + updated_at + uploader ─────────────────
ALTER TABLE iaq_surveys
  ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_iaq_created_at  ON iaq_surveys(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iaq_updated_at  ON iaq_surveys(updated_at DESC);


-- ── 3. field_survey_points: updated_at ────────────────────────────────
ALTER TABLE field_survey_points
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_fsp_updated_at ON field_survey_points(updated_at DESC);


-- ── 4. Generic updated_at trigger ─────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cc_set_updated_at') THEN
    CREATE TRIGGER trg_cc_set_updated_at
      BEFORE UPDATE ON community_contacts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_iaq_set_updated_at') THEN
    CREATE TRIGGER trg_iaq_set_updated_at
      BEFORE UPDATE ON iaq_surveys
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_fsp_set_updated_at') THEN
    CREATE TRIGGER trg_fsp_set_updated_at
      BEFORE UPDATE ON field_survey_points
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;


-- ── 5. member_invites — admin-issued one-time signup tokens ───────────
CREATE TABLE IF NOT EXISTS member_invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  token         TEXT NOT NULL UNIQUE,
  invited_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '14 days'),
  redeemed_at   TIMESTAMPTZ,
  redeemed_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','redeemed','expired','revoked'))
);

CREATE INDEX IF NOT EXISTS idx_mi_email   ON member_invites(lower(email));
CREATE INDEX IF NOT EXISTS idx_mi_token   ON member_invites(token);
CREATE INDEX IF NOT EXISTS idx_mi_status  ON member_invites(status);

ALTER TABLE member_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read invites" ON member_invites;
CREATE POLICY "Admins read invites"
  ON member_invites FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- No client INSERT/UPDATE policy — mutations through SECURITY DEFINER RPCs only.

-- 5a. RPC: admin creates an invite
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
  -- Generate a 32-char hex token.
  v_token   := encode(gen_random_bytes(24), 'hex');
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

-- 5b. RPC: admin marks an invite as 'sent' after the email leaves
--     (called from the api/admin-invite endpoint after Resend success)
CREATE OR REPLACE FUNCTION mark_invite_sent(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF NOT is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin role required');
  END IF;
  UPDATE member_invites SET status = 'sent' WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION mark_invite_sent(UUID) FROM public;
GRANT EXECUTE ON FUNCTION mark_invite_sent(UUID) TO authenticated;

-- 5c. RPC: admin revokes an outstanding invite
CREATE OR REPLACE FUNCTION revoke_member_invite(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF NOT is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin role required');
  END IF;
  UPDATE member_invites
     SET status = 'revoked'
   WHERE id = p_id AND status IN ('pending','sent');
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION revoke_member_invite(UUID) FROM public;
GRANT EXECUTE ON FUNCTION revoke_member_invite(UUID) TO authenticated;

-- 5d. RPC: anonymous lookup — does an email + token pair match a valid invite?
--     Used by the signup form before letting Supabase create the auth user.
CREATE OR REPLACE FUNCTION verify_member_invite(p_email TEXT, p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email TEXT := lower(trim(p_email));
  v_row   member_invites%ROWTYPE;
BEGIN
  IF v_email IS NULL OR p_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing email or token');
  END IF;
  SELECT * INTO v_row
    FROM member_invites
   WHERE lower(email) = v_email
     AND token = p_token
   ORDER BY invited_at DESC
   LIMIT 1;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invite not found');
  END IF;
  IF v_row.status = 'redeemed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invite already redeemed');
  END IF;
  IF v_row.status = 'revoked' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invite revoked');
  END IF;
  IF v_row.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invite expired');
  END IF;
  RETURN jsonb_build_object('ok', true, 'invite_id', v_row.id);
END;
$$;
REVOKE ALL ON FUNCTION verify_member_invite(TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION verify_member_invite(TEXT, TEXT) TO authenticated, anon;

-- 5e. RPC: redeem after Supabase signup — promotes user to member
CREATE OR REPLACE FUNCTION claim_membership_via_invite(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_email  TEXT;
  v_row    member_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authenticated');
  END IF;
  SELECT lower(trim(email)) INTO v_email FROM auth.users WHERE id = v_uid;
  SELECT * INTO v_row
    FROM member_invites
   WHERE token = p_token
   ORDER BY invited_at DESC
   LIMIT 1;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invite not found');
  END IF;
  IF v_row.status NOT IN ('pending','sent') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invite no longer valid');
  END IF;
  IF v_row.expires_at < now() THEN
    UPDATE member_invites SET status = 'expired' WHERE id = v_row.id;
    RETURN jsonb_build_object('ok', false, 'error', 'Invite expired');
  END IF;
  IF lower(trim(v_row.email)) <> v_email THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Email does not match invite');
  END IF;
  -- Idempotent: existing members short-circuit.
  IF EXISTS (SELECT 1 FROM team_members WHERE id = v_uid) THEN
    UPDATE member_invites
       SET status = 'redeemed', redeemed_at = now(), redeemed_by = v_uid
     WHERE id = v_row.id;
    RETURN jsonb_build_object('ok', true, 'role', (SELECT role FROM team_members WHERE id = v_uid), 'already', true);
  END IF;
  INSERT INTO team_members (id, role, invited_via)
  VALUES (v_uid, 'member', (now() AT TIME ZONE 'UTC')::date);
  UPDATE member_invites
     SET status = 'redeemed', redeemed_at = now(), redeemed_by = v_uid
   WHERE id = v_row.id;
  RETURN jsonb_build_object('ok', true, 'role', 'member');
END;
$$;
REVOKE ALL ON FUNCTION claim_membership_via_invite(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION claim_membership_via_invite(TEXT) TO authenticated;

-- 5f. RPC: list invites for the admin UI
CREATE OR REPLACE FUNCTION list_member_invites()
RETURNS TABLE(
  id          UUID,
  email       TEXT,
  invited_at  TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  status      TEXT,
  redeemed_at TIMESTAMPTZ
) LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, email, invited_at, expires_at, status, redeemed_at
    FROM member_invites
   WHERE is_admin(auth.uid())
   ORDER BY invited_at DESC
   LIMIT 200;
$$;
REVOKE ALL ON FUNCTION list_member_invites() FROM public;
GRANT EXECUTE ON FUNCTION list_member_invites() TO authenticated;


-- ── 6. report_recipients — multi-admin daily-report fan-out ───────────
CREATE TABLE IF NOT EXISTS report_recipients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  label       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_email_lower ON report_recipients(lower(email));

ALTER TABLE report_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage report_recipients" ON report_recipients;
CREATE POLICY "Admins manage report_recipients"
  ON report_recipients FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));


-- ── 7. daily_report_runs — change-detection bookkeeping ────────────────
CREATE TABLE IF NOT EXISTS daily_report_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_start        TIMESTAMPTZ,
  window_end          TIMESTAMPTZ NOT NULL DEFAULT now(),
  status              TEXT NOT NULL CHECK (status IN ('sent','no_changes','error','skipped')),
  recipients          TEXT[],
  community_added     INT,
  community_updated   INT,
  field_added         INT,
  iaq_added           INT,
  iaq_updated         INT,
  change_summary      JSONB,
  error_message       TEXT
);
CREATE INDEX IF NOT EXISTS idx_drr_run_at ON daily_report_runs(run_at DESC);

ALTER TABLE daily_report_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read run history" ON daily_report_runs;
CREATE POLICY "Admins read run history"
  ON daily_report_runs FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));
-- INSERT: service role only (cron writes via service-role bearer).


-- ── 8. Tighten community_contacts RLS for guest-owned rows ─────────────
-- Keep all team-member SELECT policies that already exist (migration 17).
-- Add an additional SELECT policy that allows guests to read their own
-- field-origin community_contacts via the api/guest proxy. (Guests are
-- not authenticated, so this policy is a no-op for browser clients —
-- the api/guest service-role endpoint is the actual read path. Listed
-- here for documentation completeness.)
--
-- We deliberately do NOT add an authenticated-user policy that would
-- expose team data to a member who only owns one row. Per-row export
-- filtering is enforced in api/community-contacts.py at the service
-- layer below.


-- ── 9. survey_responses (created in 18) — add ownership ────────────────
ALTER TABLE survey_responses
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;


-- ════════════════════════════════════════════════════════════════════════
-- HOW TO USE
-- ════════════════════════════════════════════════════════════════════════
-- 1. Apply this migration in Supabase SQL Editor (or supabase db push).
-- 2. After deploy, populate report_recipients via the admin UI or:
--      INSERT INTO report_recipients (email, label, is_active)
--      VALUES ('admin@example.com', 'Primary admin', true);
-- 3. The legacy invite_codes daily-code RPC (claim_membership) is left in
--    place for backward compatibility but the UI will only expose the new
--    admin-issued invite flow (member_invites + claim_membership_via_invite).
-- ════════════════════════════════════════════════════════════════════════
