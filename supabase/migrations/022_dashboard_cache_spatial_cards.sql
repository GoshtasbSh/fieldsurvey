-- 022_dashboard_cache_spatial_cards.sql
-- M7.2 Wave 0 — extend dashboard_cache.data_type + analysis_versions.data_type
-- CHECK constraints to allow S1-S8 spatial card IDs.
-- NOTE: the discriminator column in both tables is `data_type`, not `card_id`.
-- This migration was applied to prod as 022_dashboard_cache_spatial_cards_v2.

set search_path = public, extensions;

alter table public.dashboard_cache
  drop constraint if exists dashboard_cache_data_type_check;

alter table public.dashboard_cache
  add constraint dashboard_cache_data_type_check
  check (data_type = any (array[
    'pulse_blob','analyze_blob','match_status_blob',
    'points_geojson','responses_geojson','canvass_blob',
    'A21_finish','A25_velocity','A11_kde','A8_gi_star',
    'S1_autocorr','S2_gi_star_q','S3_lisa_q','S4_satscan','S5_distance_decay',
    'S6_coverage_response','S7_local_geary','S8_bivariate'
  ]));

alter table public.analysis_versions
  drop constraint if exists analysis_versions_data_type_check;

alter table public.analysis_versions
  add constraint analysis_versions_data_type_check
  check (data_type = any (array[
    'pulse_blob','analyze_blob','match_status_blob',
    'points_geojson','responses_geojson','canvass_blob',
    'A21_finish','A25_velocity','A11_kde','A8_gi_star',
    'S1_autocorr','S2_gi_star_q','S3_lisa_q','S4_satscan','S5_distance_decay',
    'S6_coverage_response','S7_local_geary','S8_bivariate'
  ]));
