-- 018_aapor_unmapped_bucket.sql
-- M7 audit fix — statuses with no AAPOR mapping used to be lumped into 'O',
-- which silently corrupted RR1/RR3/RR5/COOP1/REF1/CON1 denominators. They now
-- land in a dedicated UNMAPPED bucket that the TS layer excludes from every
-- rate denominator and surfaces in a UI warning.

set search_path = public, extensions;

-- ── A16/A17/A18 — separate UNMAPPED from 'O' ───────────────────────────────
create or replace function public.aapor_outcome_counts(p_project_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with c as (
    select coalesce(am.aapor_outcome, 'UNMAPPED') as code, count(*) as n
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

-- ── A22 — refusal/not-home pattern: exclude UNMAPPED from the bucket WHERE ─
-- The previous WHERE filter `coalesce(...,'O') in ('R','NC','O')` silently
-- promoted UNMAPPED rows into the 'O' bucket. Tighten so UNMAPPED is excluded
-- from the parcel-level pattern view.
create or replace function public.status_pattern_per_parcel(p_project_id uuid)
returns table(parcel_id uuid, bucket text, n bigint)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  select pa.id as parcel_id,
         am.aapor_outcome as bucket,
         count(*) as n
  from public.points pt
  join public.parcels pa
    on pa.project_id = pt.project_id
   and extensions.ST_Intersects(
         pa.geometry,
         extensions.ST_SetSRID(extensions.ST_MakePoint(pt.lon, pt.lat), 4326)
       )
  join public.project_aapor_mapping am
    on am.project_id = pt.project_id and am.status_id = pt.status_id
  where pt.project_id = p_project_id
    and am.aapor_outcome in ('R', 'NC', 'O')
  group by 1, 2;
$$;
revoke all on function public.status_pattern_per_parcel(uuid) from public, anon;
grant execute on function public.status_pattern_per_parcel(uuid) to authenticated;
