-- Phase 2.5 — stricter parcel snap.
--
-- Two-stage snap mirrors Keystone's _processing.py logic but uses a
-- definitive point-in-polygon test first instead of relying on a fixed
-- radius. The 50 m default tuned on Keystone's suburban density misses
-- rural parcels in the same dataset, where Census places the coord on a
-- road that's 80-150 m from the lot center.
--
--   parcel_containing()      — ST_Contains test. If the geocoded coord
--                              is literally inside a parcel polygon, that
--                              IS the right lot regardless of distance to
--                              the centroid. Use this first.
--   nearest_parcel_within()  — existing RPC from migration 024. The
--                              matcher now calls it with 150 m (widened
--                              from 50 m) as the fallback when no parcel
--                              polygon contains the coord.

begin;

create or replace function public.parcel_containing(
  p_project_id uuid,
  p_lat double precision,
  p_lon double precision
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
    and extensions.ST_Contains(p.geometry, probe.geom)
  limit 1;
$$;

revoke execute on function public.parcel_containing(uuid, double precision, double precision) from public;
grant  execute on function public.parcel_containing(uuid, double precision, double precision) to authenticated;
grant  execute on function public.parcel_containing(uuid, double precision, double precision) to service_role;

commit;
