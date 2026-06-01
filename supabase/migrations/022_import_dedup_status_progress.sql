-- Phase 1b: content-hash dedup, R1 status coloring, matcher progress.
--
-- 1. survey_responses.content_hash: SHA-256 over (project_id, address_used,
--    canonical(raw_data)). Lets re-imports of the same CSV without an
--    external_id skip duplicates instead of doubling the table (previous
--    behavior: 317-row CSV imported twice ended up with 634 rows because
--    Postgres NULLS DISTINCT treats every null external_id as unique).
--
-- 2. project_settings.response_status_column: which raw_data key carries
--    the canvassing status (e.g. "First attempt" in this user's CSV). The
--    v_match_status view reads it for R1 rows so the map can color
--    response-only markers by their survey status.
--
-- 3. survey_imports progress columns: matcher writes processing_step +
--    processing_done / processing_total every ~10 geocodes so the wizard
--    can poll and show a real progress bar instead of an opaque spinner.

begin;

-- ── dedup hash on survey_responses ─────────────────────────────────────
alter table public.survey_responses
  add column if not exists content_hash text;

create unique index if not exists ux_responses_content_hash
  on public.survey_responses (project_id, content_hash)
  where content_hash is not null;

comment on column public.survey_responses.content_hash is
  'SHA-256 over (address_used, canonical raw_data JSON). Used to dedup re-imports of the same CSV when no external_id column is picked. NULLS DISTINCT is fine because rows without a hash (legacy or hand-inserted) opt out of dedup.';

-- ── status column choice on project_settings ───────────────────────────
alter table public.project_settings
  add column if not exists response_status_column text;

comment on column public.project_settings.response_status_column is
  'Which raw_data key holds the canvassing status / outcome for each response. Drives R1 marker color on the map. NULL means "no per-row status, color all R1 markers with the default palette".';

-- ── progress + status-column audit on survey_imports ───────────────────
alter table public.survey_imports
  add column if not exists status_column      text,
  add column if not exists processing_step    text,
  add column if not exists processing_done    integer not null default 0,
  add column if not exists processing_total   integer not null default 0,
  add column if not exists processing_at      timestamptz;

comment on column public.survey_imports.processing_step is
  'Free-form label of the current matcher step: "inserting", "geocoding", "matching", "done".';

-- ── recreate v_match_status so R1 rows surface the raw status text ─────
-- The view now JOINs against project_settings and reads raw_data->>response_status_column
-- as status_label for R1 rows. M1/F1 unchanged.
create or replace view public.v_match_status
with (security_invoker = true)
as
  -- Column order MUST match the existing view exactly:
  -- point_id, response_id, project_id, status_id, status_label, lat, lon,
  -- is_matched, match_status, collected_at.
  select
    p.id              as point_id,
    null::uuid        as response_id,
    p.project_id,
    p.status_id,
    s.label           as status_label,
    p.lat,
    p.lon,
    p.matched_response_id is not null as is_matched,
    case
      when lower(s.label) = 'completed' and p.matched_response_id is not null then 'M1'
      when lower(s.label) = 'completed' and p.matched_response_id is null     then 'F1'
      else null
    end as match_status,
    p.collected_at
  from public.points p
  join public.project_statuses s on s.id = p.status_id

  union all

  select
    null::uuid     as point_id,
    r.id           as response_id,
    r.project_id,
    null::uuid     as status_id,
    case
      when ps.response_status_column is not null
        then nullif(trim(r.raw_data ->> ps.response_status_column), '')
      else null
    end            as status_label,
    r.geocoded_lat as lat,
    r.geocoded_lon as lon,
    false          as is_matched,
    'R1'           as match_status,
    r.imported_at  as collected_at
  from public.survey_responses r
  left join public.project_settings ps on ps.project_id = r.project_id
  where r.point_id is null
    and r.geocoded_lat is not null
    and r.geocoded_lon is not null;

commit;
