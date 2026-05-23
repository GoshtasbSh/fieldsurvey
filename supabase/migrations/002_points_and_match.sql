-- FieldSurvey M2 — points, photos, responses, and match-status view
--
-- This migration adds the core spatial-survey data model on top of the
-- M1 foundation. The match-status (M1/F1/R1) concept is the most
-- important addition — it's expressed as a *view*, not a stored column,
-- because it's re-derived on every read so a re-import of responses can
-- flip a point's state without orphaned data.
--
-- M1 (matched)       — Completed field point + survey response linked
-- F1 (field only)    — Completed field point, NO response could be matched
-- R1 (response only) — Survey response, NO field point at that location

-- ────────────────────────────────────────────────────────────────────────
-- points
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.points (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  status_id       uuid not null references public.project_statuses(id) on delete restrict,
  lat             double precision not null,
  lon             double precision not null,
  accuracy_m      double precision,
  address         text,
  notes           text,
  collector_id    uuid references public.profiles(id) on delete set null,
  collected_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  is_offline_sync boolean not null default false,
  client_id       text not null,                      -- idempotency key from the PWA
  -- Geocoding metadata (populated server-side after geocode)
  geocoded_at     timestamptz,
  geocode_source  text check (geocode_source in ('census','nominatim','gps','manual')),
  -- Matching: set by the matcher; cleared on import re-run
  matched_response_id uuid                            -- FK added after survey_responses table
);

create unique index if not exists ux_points_client on public.points(project_id, client_id);
create index        if not exists idx_points_project   on public.points(project_id);
create index        if not exists idx_points_status    on public.points(status_id);
create index        if not exists idx_points_collector on public.points(collector_id);
create index        if not exists idx_points_collected on public.points(collected_at desc);
create index        if not exists idx_points_geo       on public.points(project_id, lat, lon);

alter table public.points enable row level security;

create policy "points_read_members_or_public"
  on public.points for select
  using (
    public.is_project_member(project_id)
    or public.is_public_project(project_id)
  );

create policy "points_insert_collector"
  on public.points for insert to authenticated
  with check (
    public.project_role(project_id) in ('owner','admin','surveyor')
    and collector_id = auth.uid()
  );

create policy "points_update_own_or_admin"
  on public.points for update to authenticated
  using (
    collector_id = auth.uid()
    or public.project_role(project_id) in ('owner','admin')
  )
  with check (
    collector_id = auth.uid()
    or public.project_role(project_id) in ('owner','admin')
  );

create policy "points_delete_own_or_admin"
  on public.points for delete to authenticated
  using (
    collector_id = auth.uid()
    or public.project_role(project_id) in ('owner','admin')
  );

drop trigger if exists trg_points_touch on public.points;
create trigger trg_points_touch
  before update on public.points
  for each row execute function public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- point_photos
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.point_photos (
  id           uuid primary key default gen_random_uuid(),
  point_id     uuid not null references public.points(id) on delete cascade,
  storage_path text not null,
  width_px     integer,
  height_px    integer,
  uploaded_by  uuid references public.profiles(id) on delete set null,
  uploaded_at  timestamptz not null default now()
);

create index if not exists idx_photos_point on public.point_photos(point_id);

alter table public.point_photos enable row level security;

create policy "photos_read_members_or_public"
  on public.point_photos for select
  using (exists (
    select 1 from public.points p
    where p.id = point_photos.point_id
      and (public.is_project_member(p.project_id) or public.is_public_project(p.project_id))
  ));

create policy "photos_insert_member"
  on public.point_photos for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.points p
      where p.id = point_photos.point_id
        and public.is_project_member(p.project_id)
    )
  );

create policy "photos_delete_own_or_admin"
  on public.point_photos for delete to authenticated
  using (
    uploaded_by = auth.uid()
    or exists (
      select 1 from public.points p
      where p.id = point_photos.point_id
        and public.project_role(p.project_id) in ('owner','admin')
    )
  );

-- ────────────────────────────────────────────────────────────────────────
-- survey_responses (imported from Qualtrics/Google Forms CSV)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.survey_responses (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  point_id        uuid references public.points(id) on delete set null,
  source          text not null check (source in ('qualtrics_csv','google_forms_csv','manual','online_form')),
  raw_data        jsonb not null,
  -- The address we used for matching (after the import wizard's column picker)
  address_used    text,
  -- Geocoded coordinates (NEVER trust the response's own lat/lon — see memory)
  geocoded_lat    double precision,
  geocoded_lon    double precision,
  geocode_source  text check (geocode_source in ('census','nominatim','manual')),
  match_distance_m double precision,
  matched_at      timestamptz,
  imported_at     timestamptz not null default now(),
  imported_by     uuid references public.profiles(id) on delete set null,
  external_id     text                                -- e.g. Qualtrics ResponseID for dedup
);

create index if not exists idx_responses_project  on public.survey_responses(project_id);
create index if not exists idx_responses_point    on public.survey_responses(point_id);
create index if not exists idx_responses_geo      on public.survey_responses(project_id, geocoded_lat, geocoded_lon);
create unique index if not exists ux_responses_external on public.survey_responses(project_id, external_id)
  where external_id is not null;

alter table public.survey_responses enable row level security;

-- Now add the FK on points.matched_response_id (was deferred so survey_responses could be created)
alter table public.points
  add constraint fk_points_matched_response
  foreign key (matched_response_id)
  references public.survey_responses(id) on delete set null;

-- Responses are admin-only — surveyors and viewers don't see them
-- (and the mobile PWA never reads this table, see project_fieldsurvey_mobile_scope)
create policy "responses_read_admin"
  on public.survey_responses for select to authenticated
  using (public.project_role(project_id) in ('owner','admin','member'));

create policy "responses_write_admin"
  on public.survey_responses for all to authenticated
  using (public.project_role(project_id) in ('owner','admin'))
  with check (public.project_role(project_id) in ('owner','admin'));

-- ────────────────────────────────────────────────────────────────────────
-- survey_imports (audit log of CSV imports)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.survey_imports (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  filename        text not null,
  row_count       integer not null default 0,
  matched_count   integer not null default 0,
  field_only_count integer not null default 0,
  response_only_count integer not null default 0,
  ambiguous_count integer not null default 0,
  status          text not null check (status in ('processing','completed','failed')),
  error_message   text,
  -- Column mapping chosen in the import wizard
  address_column  text,
  external_id_column text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists idx_imports_project on public.survey_imports(project_id, created_at desc);

alter table public.survey_imports enable row level security;

create policy "imports_read_admin"
  on public.survey_imports for select to authenticated
  using (public.project_role(project_id) in ('owner','admin','member'));

create policy "imports_write_admin"
  on public.survey_imports for all to authenticated
  using (public.project_role(project_id) in ('owner','admin'))
  with check (public.project_role(project_id) in ('owner','admin'));

-- ────────────────────────────────────────────────────────────────────────
-- project_settings — add matching configuration
-- ────────────────────────────────────────────────────────────────────────
alter table public.project_settings
  add column if not exists response_address_column text,
  add column if not exists external_id_column      text,
  add column if not exists trust_response_geo      boolean not null default false,
  add column if not exists match_radius_m          integer not null default 30 check (match_radius_m between 1 and 500),
  add column if not exists geocoder                text not null default 'census' check (geocoder in ('census','nominatim'));

-- ────────────────────────────────────────────────────────────────────────
-- v_match_status — single source of truth for M1/F1/R1 derivation
-- Reads from points (joined to statuses) and responses; never trust stored.
-- ────────────────────────────────────────────────────────────────────────
create or replace view public.v_match_status
with (security_invoker = true)
as
  -- Field points: M1 if matched, F1 if Completed-but-unmatched, null otherwise
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
    end as match_status
  from public.points p
  join public.project_statuses s on s.id = p.status_id

  union all

  -- Response-only points (R1): responses with no point_id and geocoded coords
  select
    null::uuid        as point_id,
    r.id              as response_id,
    r.project_id,
    null::uuid        as status_id,
    null::text        as status_label,
    r.geocoded_lat    as lat,
    r.geocoded_lon    as lon,
    false             as is_matched,
    'R1'              as match_status
  from public.survey_responses r
  where r.point_id is null
    and r.geocoded_lat is not null
    and r.geocoded_lon is not null;

-- Aggregate counts (used by the left rail Match Status section)
create or replace view public.v_match_status_counts
with (security_invoker = true)
as
  select
    project_id,
    count(*) filter (where match_status = 'M1') as m1_count,
    count(*) filter (where match_status = 'F1') as f1_count,
    count(*) filter (where match_status = 'R1') as r1_count,
    count(*) filter (where match_status is not null) as total_with_status
  from public.v_match_status
  group by project_id;

-- ────────────────────────────────────────────────────────────────────────
-- Storage buckets
-- ────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('point-photos', 'point-photos', false, 10485760, array['image/jpeg','image/png','image/webp']),
    ('avatars',      'avatars',      true,  5242880,  array['image/jpeg','image/png','image/webp'])
  on conflict (id) do nothing;

-- Storage RLS — point-photos path: {project_id}/{point_id}/{filename}
create policy "point-photos_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'point-photos'
    and public.is_project_member((storage.foldername(name))[1]::uuid)
  );

create policy "point-photos_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'point-photos'
    and public.is_project_member((storage.foldername(name))[1]::uuid)
  );

create policy "point-photos_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'point-photos'
    and (
      auth.uid()::text = (storage.foldername(name))[3]   -- uploader prefix
      or public.project_role((storage.foldername(name))[1]::uuid) in ('owner','admin')
    )
  );
