-- 022_dashboard_cache_spatial_cards.sql
-- M7.2 Wave 0 — extend dashboard_cache.card_id CHECK to allow S1-S8 keys.
-- Wave-0 doesn't compute these, but the new cards' descriptors register the IDs
-- and the dispatcher's allow-list must include them before Wave 1.

set search_path = public, extensions;

alter table public.dashboard_cache
  drop constraint if exists dashboard_cache_card_id_check;

alter table public.dashboard_cache
  add constraint dashboard_cache_card_id_check
  check (card_id in (
    'A0_colorizer','match_donut',
    'A16_rr','A17_coop_ref','A18_con','A19_universe_map','A20_undersampled',
    'A21_finish','A22_refusal_pattern','A23_hour_local','A24_dow','A25_velocity',
    'A28_productivity','A29_gps_outlier','A33_off_boundary',
    'A40_sample_vs_acs','A51_topk','A52_f1_queue',
    'A11_kde','A8_gi_star','A13_cov_heatmap',
    'S1_autocorr','S2_gi_star_q','S3_lisa_q','S4_satscan','S5_distance_decay',
    'S6_coverage_response','S7_local_geary','S8_bivariate'
  ));

-- Mirror the same update on the analysis_versions audit table.
alter table public.analysis_versions
  drop constraint if exists analysis_versions_card_id_check;

alter table public.analysis_versions
  add constraint analysis_versions_card_id_check
  check (card_id in (
    'A0_colorizer','match_donut',
    'A16_rr','A17_coop_ref','A18_con','A19_universe_map','A20_undersampled',
    'A21_finish','A22_refusal_pattern','A23_hour_local','A24_dow','A25_velocity',
    'A28_productivity','A29_gps_outlier','A33_off_boundary',
    'A40_sample_vs_acs','A51_topk','A52_f1_queue',
    'A11_kde','A8_gi_star','A13_cov_heatmap',
    'S1_autocorr','S2_gi_star_q','S3_lisa_q','S4_satscan','S5_distance_decay',
    'S6_coverage_response','S7_local_geary','S8_bivariate',
    'add_analysis','remove_analysis','reorder_analyses'
  ));
