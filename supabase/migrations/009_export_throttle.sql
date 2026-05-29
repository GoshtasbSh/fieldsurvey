-- FieldSurvey M4 follow-up — DB-side export throttle.
--
-- Replaces the in-memory throttle in /api/export/my-data with a
-- persistent column so concurrent serverless invocations honour the
-- same 1/hr-per-user window.
--
-- Idempotent: safe to re-apply.

alter table public.profiles
  add column if not exists last_export_at timestamptz;
