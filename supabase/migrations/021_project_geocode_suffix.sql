-- Add a project-level address suffix that the matcher appends to every street
-- before calling the U.S. Census geocoder. Mirrors Keystone's hardcoded
-- ", Keystone Heights, FL" suffix, but stored per-project so each survey can
-- target its own city/state/ZIP.
--
-- The import wizard pre-fills this from project_settings and forces the user
-- to confirm before geocoding runs.

alter table public.project_settings
  add column if not exists geocode_address_suffix text;

comment on column public.project_settings.geocode_address_suffix is
  'Appended to every street address before geocoding. Format: "City, ST" or "City, ST ZIP". Required for Census one-line geocoder to disambiguate streets like "Harvard Avenue" that exist in many states.';
