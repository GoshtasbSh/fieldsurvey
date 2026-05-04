-- ════════════════════════════════════════════════════════════════════════
-- 15_list_all_signups.sql
-- Admin-only: returns every signed-up user (auth.users) joined with their
-- team_members row. Lets the dashboard Team modal show users who have NOT
-- yet claimed today's invite code so an admin can promote them with one
-- click instead of typing each email.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION list_all_signups()
RETURNS TABLE(
  id          UUID,
  email       TEXT,
  created_at  TIMESTAMPTZ,
  role        TEXT,                -- 'admin' | 'member' | NULL (not joined)
  joined_at   TIMESTAMPTZ
) LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id,
         u.email::text,
         u.created_at,
         tm.role,
         tm.joined_at
    FROM auth.users u
    LEFT JOIN team_members tm ON tm.id = u.id
   WHERE is_admin(auth.uid())
   ORDER BY (tm.role = 'admin')  DESC NULLS LAST,
            (tm.role = 'member') DESC NULLS LAST,
            u.created_at DESC;
$$;

REVOKE ALL ON FUNCTION list_all_signups() FROM public;
GRANT EXECUTE ON FUNCTION list_all_signups() TO authenticated;
