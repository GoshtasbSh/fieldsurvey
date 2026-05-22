-- ════════════════════════════════════════════════════════════════════════
-- 22. iaq_matched column + policy hardening
--
-- DATA-SAFE: this migration is purely additive. It does NOT:
--   • DROP any table
--   • DELETE any row
--   • UPDATE any business data (parcels, field points, IAQ surveys,
--     community contacts, team_members, user_presence rows)
--
-- It DOES:
--   • Add the missing iaq_matched column to field_survey_points
--   • Wrap auth.uid() in (select …) on user_presence policies (perf + fixes
--     the "violates RLS" stream — same semantics, different evaluation plan)
--   • Add admin-only SELECT policies to field_guest_sessions and
--     invite_codes (the "RLS Enabled No Policy" advisor lints)
--   • Lock SET search_path on three flagged trigger helper functions
--   • Drop two redundant DUPLICATE permissive policies on field_survey_points
--     (the "or admin" union policies remain — same coverage, cleaner plan)
--
-- Apply with:    supabase db push
--   or via the Supabase MCP / dashboard SQL editor.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Add missing iaq_matched column ──────────────────────────────────
-- Postgres 11+ ADD COLUMN ... DEFAULT is metadata-only (no table rewrite).
-- Existing field_survey_points rows are untouched; iaq_matched=false is
-- materialised lazily.
ALTER TABLE public.field_survey_points
  ADD COLUMN IF NOT EXISTS iaq_matched boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_fsp_iaq_matched
  ON public.field_survey_points(iaq_matched)
  WHERE iaq_matched = true;

-- ── 2. user_presence RLS init-plan fix ─────────────────────────────────
-- Same semantics as the original policies; only the evaluation strategy
-- changes. DROP POLICY removes only the policy metadata, never rows.
DROP POLICY IF EXISTS "Insert own presence" ON public.user_presence;
CREATE POLICY "Insert own presence"
  ON public.user_presence FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Update own presence" ON public.user_presence;
CREATE POLICY "Update own presence"
  ON public.user_presence FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ── 3. Add explicit SELECT policies for "RLS Enabled No Policy" tables ──
-- Service role bypasses RLS, so daily-refresh / admin RPC paths still work.
-- These policies only let admins read directly via PostgREST.
DROP POLICY IF EXISTS "Admins read guest sessions" ON public.field_guest_sessions;
CREATE POLICY "Admins read guest sessions"
  ON public.field_guest_sessions FOR SELECT
  TO authenticated
  USING (public.is_admin((select auth.uid())));

DROP POLICY IF EXISTS "Admins read invite codes" ON public.invite_codes;
CREATE POLICY "Admins read invite codes"
  ON public.invite_codes FOR SELECT
  TO authenticated
  USING (public.is_admin((select auth.uid())));

-- ── 4. Lock search_path on three flagged trigger helper functions ──────
-- Function bodies are untouched; this only adds a SET clause that prevents
-- search_path injection.
ALTER FUNCTION public._kd_set_updated_at()  SET search_path = public, pg_temp;
ALTER FUNCTION public.user_presence_touch() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at()      SET search_path = public, pg_temp;

-- ── 5. Drop the two redundant duplicate permissive policies ────────────
-- The "Team members update/delete their own points" policies are strict
-- subsets of the "… or admin" policies (advisor: multiple_permissive_policies).
-- Removing them does not narrow coverage and does not touch row data.
DROP POLICY IF EXISTS "Team members update their own points" ON public.field_survey_points;
DROP POLICY IF EXISTS "Team members delete their own points" ON public.field_survey_points;
