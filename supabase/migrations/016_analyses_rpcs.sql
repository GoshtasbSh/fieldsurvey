-- 016_analyses_rpcs.sql
-- M7 Analyses Catalog — RPCs for AAPOR, coverage, productivity, off-boundary, top-K.
--
-- Schema notes (audited against migrations 001/002/010/012/015):
--   • `parcels` (M6/012) ships with `geometry` + `centroid` and NO
--     `geoid_block_group` column. The plan was written from spec; here we
--     use `pa.id::text as block_geoid` so coverage is parcel-level (the
--     right scope for M7 — we'd need ACS BG joins to ladder up).
--   • `parcels.geometry`, `project_boundaries.geometry` are extensions.geometry
--     (PostGIS). All PostGIS calls schema-qualify via `extensions.` or rely on
--     the `set search_path = public, extensions` hint on each function.
--   • `survey_universe` has `lat` + `lon` (double precision). ✓
--   • `points` has `lat`, `lon`, `accuracy_m`, `collector_id`, `status_id`,
--     `collected_at`. ✓
--   • `profiles` has `display_name` + `email`. ✓
--   • `project_aapor_mapping(project_id, status_id, aapor_outcome)` from 015. ✓

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────────────
-- A16/A17/A18 — AAPOR outcome counts
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.aapor_outcome_counts(p_project_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with c as (
    select coalesce(am.aapor_outcome, 'O') as code, count(*) as n
    from public.points p
    left join public.project_aapor_mapping am
      on am.project_id = p.project_id and am.status_id = p.status_id
    where p.project_id = p_project_id
    group by 1
  )
  select coalesce(jsonb_object_agg(code, n), '{}'::jsonb) from c;
$$;
revoke all on function public.aapor_outcome_counts(uuid) from public, anon;
grant execute on function public.aapor_outcome_counts(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- A13 / A19 — Coverage vs universe, grouped by parcel
-- block_geoid column carries the parcel UUID as text (see schema notes).
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.coverage_by_block(p_project_id uuid)
returns table(block_geoid text, universe_addresses bigint, points_collected bigint)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with u as (
    select pa.id::text as bg, count(*) as universe
    from public.survey_universe su
    left join public.parcels pa
      on pa.project_id = su.project_id
     and su.lat is not null and su.lon is not null
     and extensions.ST_Intersects(
           pa.geometry,
           extensions.ST_SetSRID(extensions.ST_MakePoint(su.lon, su.lat), 4326)
         )
    where su.project_id = p_project_id
    group by 1
  ),
  p as (
    select pa.id::text as bg, count(*) as pts
    from public.points pt
    left join public.parcels pa
      on pa.project_id = pt.project_id
     and extensions.ST_Intersects(
           pa.geometry,
           extensions.ST_SetSRID(extensions.ST_MakePoint(pt.lon, pt.lat), 4326)
         )
    where pt.project_id = p_project_id
    group by 1
  )
  select coalesce(u.bg, p.bg) as block_geoid,
         coalesce(u.universe, 0)::bigint as universe_addresses,
         coalesce(p.pts, 0)::bigint     as points_collected
  from u full outer join p on u.bg = p.bg;
$$;
revoke all on function public.coverage_by_block(uuid) from public, anon;
grant execute on function public.coverage_by_block(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- A20 — Under-sampled ranking (top-K by deficit vs target)
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.undersampled_blocks(
  p_project_id uuid,
  p_target_pct numeric default 0.7,
  p_limit      int     default 10
)
returns table(block_geoid text, achieved_pct numeric, gap_pct numeric, universe_addresses bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with c as (
    select block_geoid, universe_addresses, points_collected
    from public.coverage_by_block(p_project_id)
    where universe_addresses >= 5
  )
  select block_geoid,
         round((points_collected::numeric / nullif(universe_addresses, 0)) * 100, 1) as achieved_pct,
         round(((p_target_pct * universe_addresses - points_collected) / nullif(universe_addresses, 0)) * 100, 1) as gap_pct,
         universe_addresses
  from c
  order by gap_pct desc nulls last
  limit p_limit;
$$;
revoke all on function public.undersampled_blocks(uuid, numeric, int) from public, anon;
grant execute on function public.undersampled_blocks(uuid, numeric, int) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- A22 — Refusal / not-home pattern per parcel
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.status_pattern_per_parcel(p_project_id uuid)
returns table(parcel_id uuid, bucket text, n bigint)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  select pa.id as parcel_id,
         coalesce(am.aapor_outcome, 'O') as bucket,
         count(*) as n
  from public.points pt
  join public.parcels pa
    on pa.project_id = pt.project_id
   and extensions.ST_Intersects(
         pa.geometry,
         extensions.ST_SetSRID(extensions.ST_MakePoint(pt.lon, pt.lat), 4326)
       )
  left join public.project_aapor_mapping am
    on am.project_id = pt.project_id and am.status_id = pt.status_id
  where pt.project_id = p_project_id
    and coalesce(am.aapor_outcome, 'O') in ('R', 'NC', 'O')
  group by 1, 2;
$$;
revoke all on function public.status_pattern_per_parcel(uuid) from public, anon;
grant execute on function public.status_pattern_per_parcel(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- A28 — Productivity per surveyor (points/shift)
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.productivity_per_surveyor(p_project_id uuid)
returns table(collector_id uuid, name text, points bigint, shifts bigint, ppshift numeric)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with shifts as (
    select collector_id, date_trunc('day', collected_at) as d, count(*) as n
    from public.points
    where project_id = p_project_id and collector_id is not null
    group by 1, 2
  ),
  totals as (
    select s.collector_id,
           coalesce(pr.display_name, pr.email, '—') as name,
           sum(s.n)::bigint as points,
           count(*)::bigint as shifts,
           round(avg(s.n)::numeric, 2) as ppshift
    from shifts s
    join public.profiles pr on pr.id = s.collector_id
    group by 1, 2
    having count(*) >= 3
  )
  select * from totals
  order by ppshift desc nulls last;
$$;
revoke all on function public.productivity_per_surveyor(uuid) from public, anon;
grant execute on function public.productivity_per_surveyor(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- A29 — GPS accuracy outliers per surveyor
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.gps_accuracy_outliers(
  p_project_id uuid,
  p_thresh_m   numeric default 50
)
returns table(collector_id uuid, name text, median_acc numeric, flagged bigint, total bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select pt.collector_id,
         coalesce(pr.display_name, pr.email, '—') as name,
         percentile_disc(0.5) within group (order by pt.accuracy_m)::numeric as median_acc,
         count(*) filter (where pt.accuracy_m > p_thresh_m)::bigint as flagged,
         count(*)::bigint as total
  from public.points pt
  left join public.profiles pr on pr.id = pt.collector_id
  where pt.project_id = p_project_id and pt.accuracy_m is not null
  group by 1, 2;
$$;
revoke all on function public.gps_accuracy_outliers(uuid, numeric) from public, anon;
grant execute on function public.gps_accuracy_outliers(uuid, numeric) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- A33 — Off-boundary stops (points outside the union of project boundaries
-- by more than p_buffer_m metres)
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.off_boundary_points(
  p_project_id uuid,
  p_buffer_m   int default 30
)
returns table(id uuid, lat numeric, lon numeric, distance_m numeric)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with b as (
    select extensions.ST_Union(geometry) as g
    from public.project_boundaries
    where project_id = p_project_id
  )
  select pt.id,
         pt.lat::numeric,
         pt.lon::numeric,
         round(
           extensions.ST_Distance(
             extensions.ST_SetSRID(extensions.ST_MakePoint(pt.lon, pt.lat), 4326)::extensions.geography,
             b.g::extensions.geography
           )::numeric,
           1
         ) as distance_m
  from public.points pt cross join b
  where pt.project_id = p_project_id
    and b.g is not null
    and not extensions.ST_DWithin(
      extensions.ST_SetSRID(extensions.ST_MakePoint(pt.lon, pt.lat), 4326)::extensions.geography,
      b.g::extensions.geography,
      p_buffer_m
    );
$$;
revoke all on function public.off_boundary_points(uuid, int) from public, anon;
grant execute on function public.off_boundary_points(uuid, int) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- A51 — Top-K blocks (parcels) to revisit (composite score)
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.topk_revisit_blocks(
  p_project_id uuid,
  p_limit      int default 10
)
returns table(block_geoid text, score numeric, universe_addresses bigint, achieved_pct numeric)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with u as (
    select block_geoid,
           universe_addresses,
           points_collected,
           round((points_collected::numeric / nullif(universe_addresses, 0)) * 100, 1) as ach_pct
    from public.coverage_by_block(p_project_id)
    where universe_addresses >= 5
  )
  select block_geoid,
         round(((100 - coalesce(ach_pct, 0)) * 0.7 + universe_addresses * 0.001), 2) as score,
         universe_addresses,
         ach_pct as achieved_pct
  from u
  order by score desc nulls last
  limit p_limit;
$$;
revoke all on function public.topk_revisit_blocks(uuid, int) from public, anon;
grant execute on function public.topk_revisit_blocks(uuid, int) to authenticated;
