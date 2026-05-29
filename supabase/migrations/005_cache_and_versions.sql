-- FieldSurvey M4 — Precomputed dashboard cache + analysis_versions (History/Restore)
-- + symbology_overrides column on project_settings.
--
-- Locked decisions (see project-fieldsurvey-m4-locked-decisions memory):
--   • Cache scope = MODERATE: analytics blobs + points GeoJSON + responses GeoJSON.
--   • Refresh trigger = debounced 30s after writes + after import + admin "Recompute now".
--   • Snapshot trigger = on every cache refresh.
--   • Retention = last 50 snapshots per project + 1 daily rollup beyond that.
--   • Restore semantic = READ-ONLY view replacement; never mutates `points`.
--
-- All tables get RLS day-one. Service-role bypass only via the cron secret
-- (no anon writes). Read access = project membership (matches analytics
-- permission per Q7 decision).

-- ────────────────────────────────────────────────────────────────────────
-- 1. dashboard_cache — current latest precomputed blob, per project & key
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.dashboard_cache (
  project_id   uuid not null references public.projects(id) on delete cascade,
  data_type    text not null check (
                  data_type in (
                    'pulse_blob',
                    'analyze_blob',
                    'match_status_blob',
                    'points_geojson',
                    'responses_geojson'
                  )
                ),
  payload      jsonb not null,
  computed_at  timestamptz not null default now(),
  primary key (project_id, data_type)
);

create index if not exists idx_dashcache_project on public.dashboard_cache(project_id);
create index if not exists idx_dashcache_computed_at on public.dashboard_cache(computed_at desc);

alter table public.dashboard_cache enable row level security;

drop policy if exists "dashcache_read_members" on public.dashboard_cache;
create policy "dashcache_read_members"
  on public.dashboard_cache for select
  using (public.is_project_member(project_id));

-- Public-read carve-out for projects with visibility='public_read'
-- so the public dashboard can read the cached blobs.
drop policy if exists "dashcache_read_public" on public.dashboard_cache;
create policy "dashcache_read_public"
  on public.dashboard_cache for select
  using (
    exists (
      select 1 from public.projects p
      where p.id = dashboard_cache.project_id
        and p.visibility = 'public_read'
    )
  );

-- Writes only via service-role (cron worker) — no policy created for anon/authenticated.

-- ────────────────────────────────────────────────────────────────────────
-- 2. analysis_versions — snapshot per cache refresh (History/Restore)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.analysis_versions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  data_type    text not null check (
                  data_type in (
                    'pulse_blob',
                    'analyze_blob',
                    'match_status_blob',
                    'points_geojson',
                    'responses_geojson'
                  )
                ),
  payload      jsonb not null,
  snapshot_at  timestamptz not null default now(),
  -- Why this snapshot fired: cache write source.
  trigger      text not null default 'auto'
                  check (trigger in ('auto','import','cron','manual')),
  -- Optional summary computed at snapshot time so the History list can render
  -- "+12 points · 3 status changes · 1 import" without re-deriving from payload.
  delta_summary jsonb not null default '{}'::jsonb,
  -- True when this snapshot is the daily rollup; spared from the keep-last-50
  -- prune below.
  is_daily_rollup boolean not null default false
);

create index if not exists idx_versions_project_snapshot
  on public.analysis_versions(project_id, snapshot_at desc);
create index if not exists idx_versions_project_type
  on public.analysis_versions(project_id, data_type, snapshot_at desc);
create index if not exists idx_versions_daily_rollup
  on public.analysis_versions(project_id, is_daily_rollup)
  where is_daily_rollup = true;

alter table public.analysis_versions enable row level security;

drop policy if exists "versions_read_members" on public.analysis_versions;
create policy "versions_read_members"
  on public.analysis_versions for select
  using (public.is_project_member(project_id));

-- Writes only via service-role.

-- ────────────────────────────────────────────────────────────────────────
-- 3. Retention helper — keep last 50 + daily rollups, prune the rest.
--    Called by the cache-refresh worker after each snapshot insert.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.prune_analysis_versions(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Keep the 50 most recent per (project_id, data_type) plus any daily rollup
  delete from public.analysis_versions av
  where av.project_id = p_project_id
    and av.is_daily_rollup = false
    and av.id not in (
      select id from (
        select id,
               row_number() over (
                 partition by data_type
                 order by snapshot_at desc
               ) as rn
        from public.analysis_versions
        where project_id = p_project_id
      ) ranked
      where rn <= 50
    );
end;
$$;

revoke all on function public.prune_analysis_versions(uuid) from public;
grant execute on function public.prune_analysis_versions(uuid) to service_role;

-- ────────────────────────────────────────────────────────────────────────
-- 4. project_settings.symbology_overrides — per-status size/opacity/outline.
--    Shared team-wide (Q4 decision). Shape:
--      {
--        "<status_id>": {
--          "size": number,           -- px, default 8
--          "fill_opacity": number,   -- 0..1, default 0.85
--          "outline_px": number      -- px, default 1.5
--        }, ...
--      }
-- ────────────────────────────────────────────────────────────────────────
alter table public.project_settings
  add column if not exists symbology_overrides jsonb not null default '{}'::jsonb;

-- Schema sanity: must be an object (not array / scalar / null)
do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'project_settings'
      and constraint_name = 'symbology_overrides_is_object'
  ) then
    alter table public.project_settings
      add constraint symbology_overrides_is_object
      check (jsonb_typeof(symbology_overrides) = 'object');
  end if;
end$$;

-- ────────────────────────────────────────────────────────────────────────
-- 5. Touch updated_at on cache writes so the dashboard can show "as of <time>"
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.touch_dashboard_cache_computed_at()
returns trigger
language plpgsql
as $$
begin
  new.computed_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_dashboard_cache on public.dashboard_cache;
create trigger trg_touch_dashboard_cache
  before update on public.dashboard_cache
  for each row execute function public.touch_dashboard_cache_computed_at();
