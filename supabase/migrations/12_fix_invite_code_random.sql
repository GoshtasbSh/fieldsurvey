-- ════════════════════════════════════════════════════════════════════════
-- 12_fix_invite_code_random.sql
-- get_or_create_today_code() was calling gen_random_bytes(int), which
-- lives in the pgcrypto extension installed in the `extensions` schema
-- on Supabase. The SECURITY DEFINER function has SET search_path =
-- public, pg_temp — so the unqualified call fails with
--     "function gen_random_bytes(integer) does not exist".
--
-- Fix: rewrite the random-code generator using core PostgreSQL functions
-- (md5 + random + clock_timestamp), which don't need pgcrypto and don't
-- need to be schema-qualified. Same 6-char A-Z 0-9 output.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_or_create_today_code()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
  v_code  TEXT;
BEGIN
  IF NOT is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin role required');
  END IF;
  SELECT code INTO v_code FROM invite_codes WHERE date = v_today;
  IF v_code IS NULL THEN
    -- 6-char alphanumeric (uppercase) code derived from md5 of (random
    -- + timestamp). md5 is core PG; no extension needed. md5 returns a
    -- 32-char hex string; uppercasing gives A-F + 0-9, plenty of entropy
    -- for a one-day code.
    v_code := upper(
      substr(md5(random()::text || clock_timestamp()::text), 1, 6)
    );
    INSERT INTO invite_codes (date, code, generated_by)
    VALUES (v_today, v_code, v_uid);
  END IF;
  RETURN jsonb_build_object('ok', true, 'date', v_today, 'code', v_code);
END;
$$;

REVOKE ALL ON FUNCTION get_or_create_today_code() FROM public;
GRANT EXECUTE ON FUNCTION get_or_create_today_code() TO authenticated;
