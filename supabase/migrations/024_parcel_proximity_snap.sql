-- Phase 2 — parcel-centroid snap (50 m).
--
-- After Census returns lat/lon (which typically lands on the road
-- centerline), the matcher snaps to the nearest parcel centroid within
-- 50 m. Mirrors Keystone's STRtree snap at api/_processing.py:600 — the
-- 50 m threshold was tuned on 2026-05-05 on the Keystone Heights dataset
-- and works well for the suburban-density places this app targets.
--
--   • survey_responses.parcel_id  — records which parcel each row landed
--     on. Phase 3 tier-3 matcher uses this for parcel-equality.
--   • nearest_parcel_within()     — RPC the matcher calls per row.

begin;

alter table public.survey_responses
  add column if not exists parcel_id uuid references public.parcels(id) on delete set null;

create index if not exists idx_responses_parcel
  on public.survey_responses (parcel_id)
  where parcel_id is not null;

comment on column public.survey_responses.parcel_id is
  'Set by the matcher when the geocoded coordinate snapped to a parcel within 50 m. Used by Phase 3 tier-3 parcel-equality matching.';

-- Nearest-parcel-within RPC.
-- Uses the existing GIST index on parcels.centroid (idx_parcels_centroid).
-- ST_DWithin with geography casts gives accurate meter distances; the
-- KNN `<->` operator on geometry picks the nearest in index order.
create or replace function public.nearest_parcel_within(
  p_project_id uuid,
  p_lat double precision,
  p_lon double precision,
  p_radius_m double precision default 50
)
returns table (
  parcel_id uuid,
  centroid_lat double precision,
  centroid_lon double precision,
  distance_m double precision
)
language sql
stable
security invoker
set search_path = extensions, public, pg_temp
as $$
  with probe as (
    select extensions.ST_SetSRID(extensions.ST_MakePoint(p_lon, p_lat), 4326) as geom
  )
  select
    p.id,
    extensions.ST_Y(p.centroid)::double precision as centroid_lat,
    extensions.ST_X(p.centroid)::double precision as centroid_lon,
    extensions.ST_Distance(p.centroid::extensions.geography, probe.geom::extensions.geography)::double precision as distance_m
  from public.parcels p
  cross join probe
  where p.project_id = p_project_id
    and extensions.ST_DWithin(p.centroid::extensions.geography, probe.geom::extensions.geography, p_radius_m)
  order by p.centroid <-> probe.geom
  limit 1;
$$;

revoke execute on function public.nearest_parcel_within(uuid, double precision, double precision, double precision) from public;
grant  execute on function public.nearest_parcel_within(uuid, double precision, double precision, double precision) to authenticated;
grant  execute on function public.nearest_parcel_within(uuid, double precision, double precision, double precision) to service_role;

-- Extend the geocode_source CHECK so the matcher can record when a row was
-- snapped to a parcel on top of the raw Census/Nominatim geocode.
alter table public.survey_responses
  drop constraint if exists survey_responses_geocode_source_check;
alter table public.survey_responses
  add constraint survey_responses_geocode_source_check
  check (geocode_source in ('census', 'census+parcel', 'nominatim', 'nominatim+parcel', 'manual'));

commit;
