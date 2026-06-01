-- Phase 4 — dual upload: field-canvass CSVs can now be bulk-imported into
-- public.points (the existing mobile/manual paths are unchanged).
--
-- A canvass-log CSV ("which houses surveyors visited and what happened")
-- creates one row per address. The matcher geocodes the address and snaps
-- to a parcel centroid the same way it does for survey_responses (Phase 2).
--
--   • points.source        — 'mobile' (default, surveyor PWA), 'csv_import'
--                            (this new path), 'manual' (admin add-point
--                            dialog), 'guest' (guest-day-code path).
--                            Drives replace-mode so re-importing a canvass
--                            log only wipes prior CSV-imported rows, never
--                            the surveyors' own work.
--   • points.content_hash  — same dedup story as survey_responses: SHA-256
--                            over (project_id, address, status text).
--   • points.parcel_id     — snapped parcel for Phase 3 tier-3 matching.
--   • lat/lon nullable     — CSV rows arrive without coords; the matcher
--                            fills them after Census + parcel snap.
--   • survey_imports.kind  — 'survey_responses' (existing) or
--                            'field_canvass' (this new path). The wizard's
--                            progress poller is now flow-aware.

begin;

alter table public.points
  add column if not exists source text not null default 'mobile',
  add column if not exists content_hash text,
  add column if not exists parcel_id uuid references public.parcels(id) on delete set null;

-- Replace the implicit "lat/lon must be set" invariant — fine for the
-- mobile/manual paths because they always have GPS — with a column
-- nullable so CSV rows can be inserted ahead of geocoding. Re-add a CHECK
-- so any non-CSV insert still requires coords (defence in depth).
alter table public.points alter column lat drop not null;
alter table public.points alter column lon drop not null;

alter table public.points
  drop constraint if exists points_source_check;
alter table public.points
  add constraint points_source_check
  check (source in ('mobile','csv_import','manual','guest'));

alter table public.points
  drop constraint if exists points_coords_when_not_csv;
alter table public.points
  add constraint points_coords_when_not_csv
  check (source = 'csv_import' or (lat is not null and lon is not null));

-- Dedup hash. Real UNIQUE constraint (not partial index) so PostgREST
-- upsert with onConflict can infer it — Phase 1's lesson on migration 020.
alter table public.points
  drop constraint if exists points_project_content_hash_unique;
alter table public.points
  add constraint points_project_content_hash_unique
  unique (project_id, content_hash);

create index if not exists idx_points_source
  on public.points (project_id, source);

create index if not exists idx_points_parcel
  on public.points (parcel_id)
  where parcel_id is not null;

-- Audit-row kind discriminator
alter table public.survey_imports
  add column if not exists kind text not null default 'survey_responses';

alter table public.survey_imports
  drop constraint if exists survey_imports_kind_check;
alter table public.survey_imports
  add constraint survey_imports_kind_check
  check (kind in ('survey_responses','field_canvass'));

commit;
