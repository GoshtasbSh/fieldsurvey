-- FieldSurvey M6 — PostGIS, project boundaries, parcels, snap helper.
--
-- Locked decisions ([[project-fieldsurvey-keystone-backport-decisions]]):
--   • FL parcels via PostGIS + admin-drawn project boundary.
--   • Universe imports snap to parcel centroids when a match is found.
--
-- All new tables ship with RLS day-one (member read, admin write).
-- Helper RPCs are SECURITY INVOKER and pin search_path explicitly so they
-- don't trip the function_search_path_mutable advisor.

-- ────────────────────────────────────────────────────────────────────────
-- 0. PostGIS extension (Supabase pattern: extensions schema)
-- ────────────────────────────────────────────────────────────────────────
create extension if not exists postgis with schema extensions;

-- ────────────────────────────────────────────────────────────────────────
-- 1. project_boundaries — admin-uploaded polygons that bound a canvass
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.project_boundaries (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text,
  geometry    extensions.geometry(MultiPolygon, 4326) not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_boundaries_project
  on public.project_boundaries(project_id);
create index if not exists idx_boundaries_geom
  on public.project_boundaries using gist (geometry);

alter table public.project_boundaries enable row level security;

drop policy if exists "boundaries_read_members" on public.project_boundaries;
create policy "boundaries_read_members"
  on public.project_boundaries for select
  using (public.is_project_member(project_id));

-- Public-read for projects with visibility='public_read'.
drop policy if exists "boundaries_read_public" on public.project_boundaries;
create policy "boundaries_read_public"
  on public.project_boundaries for select
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_boundaries.project_id
        and p.visibility = 'public_read'
    )
  );

drop policy if exists "boundaries_insert_admin" on public.project_boundaries;
create policy "boundaries_insert_admin"
  on public.project_boundaries for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.project_role(project_id) in ('owner','admin')
  );

drop policy if exists "boundaries_delete_admin" on public.project_boundaries;
create policy "boundaries_delete_admin"
  on public.project_boundaries for delete to authenticated
  using (public.project_role(project_id) in ('owner','admin'));

-- ────────────────────────────────────────────────────────────────────────
-- 2. parcels — admin-uploaded parcel polygons used for snap-on-import
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.parcels (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  county       text,
  parcel_apn   text,
  address      text,
  geometry     extensions.geometry(MultiPolygon, 4326) not null,
  centroid     extensions.geometry(Point, 4326) not null,
  source       text not null default 'admin-upload',
  external_id  text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_parcels_project
  on public.parcels(project_id);
create index if not exists idx_parcels_geom
  on public.parcels using gist (geometry);
create index if not exists idx_parcels_centroid
  on public.parcels using gist (centroid);
create index if not exists idx_parcels_address
  on public.parcels(project_id, lower(address));

alter table public.parcels enable row level security;

drop policy if exists "parcels_read_members" on public.parcels;
create policy "parcels_read_members"
  on public.parcels for select
  using (public.is_project_member(project_id));

drop policy if exists "parcels_insert_admin" on public.parcels;
create policy "parcels_insert_admin"
  on public.parcels for insert to authenticated
  with check (public.project_role(project_id) in ('owner','admin'));

drop policy if exists "parcels_delete_admin" on public.parcels;
create policy "parcels_delete_admin"
  on public.parcels for delete to authenticated
  using (public.project_role(project_id) in ('owner','admin'));

-- ────────────────────────────────────────────────────────────────────────
-- 3. find_parcel_for_address — exact-address snap RPC
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.find_parcel_for_address(
  p_project uuid,
  p_address text
)
returns table (parcel_id uuid, centroid_lat double precision, centroid_lon double precision)
language sql
security invoker
set search_path = extensions, public, pg_temp
as $$
  select
    id,
    extensions.ST_Y(centroid)::double precision as centroid_lat,
    extensions.ST_X(centroid)::double precision as centroid_lon
  from public.parcels
  where project_id = p_project
    and lower(address) = lower(p_address)
  limit 1;
$$;

revoke execute on function public.find_parcel_for_address(uuid, text) from public;
grant  execute on function public.find_parcel_for_address(uuid, text) to authenticated;
grant  execute on function public.find_parcel_for_address(uuid, text) to service_role;

-- ────────────────────────────────────────────────────────────────────────
-- 4. boundaries_geojson — return a project's boundaries as GeoJSON
-- ────────────────────────────────────────────────────────────────────────
-- A single round-trip helper so the API layer doesn't have to call
-- ST_AsGeoJSON itself. Returns one row per boundary.
create or replace function public.boundaries_geojson(p_project uuid)
returns table (id uuid, name text, geojson jsonb, created_at timestamptz)
language sql
security invoker
set search_path = extensions, public, pg_temp
as $$
  select
    id,
    name,
    extensions.ST_AsGeoJSON(geometry)::jsonb as geojson,
    created_at
  from public.project_boundaries
  where project_id = p_project
  order by created_at desc;
$$;

revoke execute on function public.boundaries_geojson(uuid) from public;
grant  execute on function public.boundaries_geojson(uuid) to anon;
grant  execute on function public.boundaries_geojson(uuid) to authenticated;
grant  execute on function public.boundaries_geojson(uuid) to service_role;

-- ────────────────────────────────────────────────────────────────────────
-- 5. insert_project_boundary — geometry-from-geojson INSERT helper
-- ────────────────────────────────────────────────────────────────────────
-- Supabase JS can't send PostGIS geometries directly; we accept a GeoJSON
-- string here, cast via ST_GeomFromGeoJSON + ST_Multi, and rely on the
-- table's RLS policy (SECURITY INVOKER) for the admin gate.
create or replace function public.insert_project_boundary(
  p_project uuid,
  p_name    text,
  p_geojson text
)
returns table (id uuid, name text, created_at timestamptz)
language plpgsql
security invoker
set search_path = extensions, public, pg_temp
as $$
declare
  v_geom extensions.geometry(MultiPolygon, 4326);
  v_row  record;
begin
  v_geom := extensions.ST_Multi(extensions.ST_GeomFromGeoJSON(p_geojson))::extensions.geometry(MultiPolygon, 4326);

  insert into public.project_boundaries (project_id, name, geometry, created_by)
  values (p_project, p_name, extensions.ST_SetSRID(v_geom, 4326), auth.uid())
  returning project_boundaries.id, project_boundaries.name, project_boundaries.created_at
  into v_row;

  id := v_row.id;
  name := v_row.name;
  created_at := v_row.created_at;
  return next;
end;
$$;

revoke execute on function public.insert_project_boundary(uuid, text, text) from public;
grant  execute on function public.insert_project_boundary(uuid, text, text) to authenticated;
grant  execute on function public.insert_project_boundary(uuid, text, text) to service_role;

-- ────────────────────────────────────────────────────────────────────────
-- 6. insert_parcels_batch — bulk parcel ingest with centroid computed
-- ────────────────────────────────────────────────────────────────────────
-- Accepts a JSON array of {address, parcel_apn, county, external_id,
-- geojson} objects. Geometry comes in as a GeoJSON Polygon/MultiPolygon
-- string; we coerce to MultiPolygon and compute the centroid here so the
-- API layer doesn't have to send two geometry payloads per row.
create or replace function public.insert_parcels_batch(
  p_project uuid,
  p_rows    jsonb
)
returns integer
language plpgsql
security invoker
set search_path = extensions, public, pg_temp
as $$
declare
  v_inserted integer := 0;
  v_row      jsonb;
  v_geom     extensions.geometry(MultiPolygon, 4326);
begin
  for v_row in select * from jsonb_array_elements(p_rows) loop
    begin
      v_geom := extensions.ST_Multi(
        extensions.ST_GeomFromGeoJSON(v_row->>'geojson')
      )::extensions.geometry(MultiPolygon, 4326);

      insert into public.parcels (
        project_id, county, parcel_apn, address, geometry, centroid, source, external_id
      ) values (
        p_project,
        nullif(v_row->>'county', ''),
        nullif(v_row->>'parcel_apn', ''),
        nullif(v_row->>'address', ''),
        extensions.ST_SetSRID(v_geom, 4326),
        extensions.ST_Centroid(v_geom),
        coalesce(nullif(v_row->>'source', ''), 'admin-upload'),
        nullif(v_row->>'external_id', '')
      );
      v_inserted := v_inserted + 1;
    exception when others then
      -- Skip malformed rows silently; the API returns count vs total so
      -- the admin can see the gap.
      continue;
    end;
  end loop;

  return v_inserted;
end;
$$;

revoke execute on function public.insert_parcels_batch(uuid, jsonb) from public;
grant  execute on function public.insert_parcels_batch(uuid, jsonb) to authenticated;
grant  execute on function public.insert_parcels_batch(uuid, jsonb) to service_role;
