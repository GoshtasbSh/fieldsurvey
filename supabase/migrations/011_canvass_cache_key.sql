-- FieldSurvey M5 — let dashboard_cache & analysis_versions store canvass_blob.
--
-- Migration 005 enumerated the 5 cache keys in a CHECK constraint:
--   pulse_blob | analyze_blob | match_status_blob | points_geojson | responses_geojson
--
-- M5 adds a sixth — canvass_blob — that records total / visited / skipped /
-- by_surveyor for projects with project_settings.canvass_mode = true.
-- This migration rewrites both CHECK constraints to admit the new key.

alter table public.dashboard_cache
  drop constraint if exists dashboard_cache_data_type_check;
alter table public.dashboard_cache
  add constraint dashboard_cache_data_type_check
  check (
    data_type in (
      'pulse_blob',
      'analyze_blob',
      'match_status_blob',
      'points_geojson',
      'responses_geojson',
      'canvass_blob'
    )
  );

alter table public.analysis_versions
  drop constraint if exists analysis_versions_data_type_check;
alter table public.analysis_versions
  add constraint analysis_versions_data_type_check
  check (
    data_type in (
      'pulse_blob',
      'analyze_blob',
      'match_status_blob',
      'points_geojson',
      'responses_geojson',
      'canvass_blob'
    )
  );
