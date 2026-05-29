-- FieldSurvey M4 follow-up — security advisor cleanup for migration 005.
--
-- Surfaced by Supabase advisors after applying 005/006/007:
--   • function_search_path_mutable for touch_dashboard_cache_computed_at
--   • prune_analysis_versions exposed via PostgREST to anon/authenticated
--
-- Both are easy one-liner fixes. We:
--   • pin search_path on the new trigger function
--   • revoke EXECUTE on prune_analysis_versions from PUBLIC + the API roles
--     so PostgREST cannot expose /rest/v1/rpc/prune_analysis_versions
--   • re-grant only to service_role (cron worker)
--
-- Idempotent — safe to re-apply.

-- 1. Pin search_path on the new touch trigger fn (advisor 0011).
create or replace function public.touch_dashboard_cache_computed_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.computed_at := now();
  return new;
end;
$$;

-- 2. Lock down prune_analysis_versions so anon/authenticated can't see it
--    via PostgREST (advisor 0028 / 0029). The cache-refresh worker uses
--    service_role and remains able to call it.
revoke execute on function public.prune_analysis_versions(uuid) from public;
revoke execute on function public.prune_analysis_versions(uuid) from anon;
revoke execute on function public.prune_analysis_versions(uuid) from authenticated;
grant  execute on function public.prune_analysis_versions(uuid) to service_role;
