-- FieldSurvey M7 wave-1 — widen dashboard_cache + analysis_versions CHECK
-- constraints to admit the 4 sidecar payload keys.
--
-- Background:
--   Migration 005 enumerated the original 5 cache keys; migration 011 added
--   `canvass_blob` for the M5 universe canvass block. The M7 wave-1 sidecar
--   (FastAPI / Python 3.13 on Vercel Fluid Compute) writes 4 additional keys
--   back into dashboard_cache so the Next.js dispatcher can short-circuit
--   subsequent reads from the 15-minute cache layer:
--
--     A21_finish    — Monte Carlo finish-date forecast (A21)
--     A25_velocity  — PELT change-point detection on daily counts (A25)
--     A11_kde       — Gaussian FFT KDE raster (A11)
--     A8_gi_star    — Getis-Ord Gi* hot/cold-spot map (A8)
--
-- This migration drops the existing CHECK constraints (by name; falls back
-- to a catalog lookup if the literal name differs) and re-adds them with
-- the union of M6 keys + canvass_blob + the 4 new sidecar keys.

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────────────
-- dashboard_cache.data_type CHECK
-- ────────────────────────────────────────────────────────────────────────
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
   where conrelid = 'public.dashboard_cache'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%data_type%';
  if cname is not null then
    execute format('alter table public.dashboard_cache drop constraint %I', cname);
  end if;
end $$;

alter table public.dashboard_cache
  add constraint dashboard_cache_data_type_check
  check (data_type in (
    -- M6 keys (migration 005)
    'pulse_blob',
    'analyze_blob',
    'match_status_blob',
    'points_geojson',
    'responses_geojson',
    -- M5 universe canvass (migration 011)
    'canvass_blob',
    -- M7 wave-1 sidecar keys (this migration)
    'A21_finish',
    'A25_velocity',
    'A11_kde',
    'A8_gi_star'
  ));

-- ────────────────────────────────────────────────────────────────────────
-- analysis_versions.data_type CHECK — mirrors dashboard_cache so History
-- snapshots can include sidecar payloads.
-- ────────────────────────────────────────────────────────────────────────
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
   where conrelid = 'public.analysis_versions'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%data_type%';
  if cname is not null then
    execute format('alter table public.analysis_versions drop constraint %I', cname);
  end if;
end $$;

alter table public.analysis_versions
  add constraint analysis_versions_data_type_check
  check (data_type in (
    'pulse_blob',
    'analyze_blob',
    'match_status_blob',
    'points_geojson',
    'responses_geojson',
    'canvass_blob',
    'A21_finish',
    'A25_velocity',
    'A11_kde',
    'A8_gi_star'
  ));
