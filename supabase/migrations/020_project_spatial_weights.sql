-- 020_project_spatial_weights.sql
-- M7.2 Wave 0 — materialized k-NN / distance-band spatial weights cache.
-- Used by Waves 2–4 sidecar (PySAL esda). Schema lands now to avoid Wave-2 DDL churn.

set search_path = public, extensions;

create table if not exists public.project_spatial_weights (
  project_id   uuid primary key references public.projects(id) on delete cascade,
  weights_type text not null check (weights_type in ('knn8','dband_500m','queen')),
  matrix       bytea not null,
  matrix_hash  text  not null,
  point_ids    uuid[] not null,
  computed_at  timestamptz not null default now(),
  computed_by  uuid references public.profiles(id) on delete set null
);

create index if not exists idx_psw_hash
  on public.project_spatial_weights(matrix_hash);

alter table public.project_spatial_weights enable row level security;

create policy "weights_read_member"
  on public.project_spatial_weights for select to authenticated
  using (public.project_role(project_id) in ('owner','admin','member'));

create policy "weights_write_admin"
  on public.project_spatial_weights for all to authenticated
  using (public.project_role(project_id) in ('owner','admin'))
  with check (public.project_role(project_id) in ('owner','admin'));

comment on table public.project_spatial_weights is
  'Cached scipy.sparse CSR spatial-weights matrix for PySAL esda. Recomputed when point count drifts >5%.';
