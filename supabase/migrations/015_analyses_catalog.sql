-- 015_analyses_catalog.sql
-- M7 — Analyses Catalog: saved views, AAPOR mapping, demographics schema,
-- baked-in ACS / SVI / PLACES lookups, per-user view state, stub-card votes.
-- See docs/superpowers/specs/2026-05-29-analyses-catalog-design.md

set search_path = public, extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Saved Views — admin-curated card sets per project
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.project_saved_views (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  name          text not null,
  role_gate     text not null default 'member'
                check (role_gate in ('admin','member','guest','surveyor')),
  cards         jsonb not null default '[]'::jsonb,   -- ordered array of card_id strings
  is_default    boolean not null default false,
  is_system     boolean not null default false,       -- shipped views; admin can reset but not delete
  colorize_spec jsonb,                                  -- optional A0 default for this view
  description   text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists ux_views_project_name
  on public.project_saved_views(project_id, name);
create index if not exists idx_views_project
  on public.project_saved_views(project_id);
create index if not exists idx_views_default
  on public.project_saved_views(project_id) where is_default = true;

-- Only one default view per project
create unique index if not exists ux_views_one_default
  on public.project_saved_views(project_id) where is_default = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Per-user view state — "My picks" overrides + colorize persistence
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.user_view_state (
  user_id        uuid not null references public.profiles(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  active_view_id uuid references public.project_saved_views(id) on delete set null,
  card_overrides jsonb not null default '{}'::jsonb,  -- { card_id: boolean }
  colorize_spec  jsonb,                                 -- A0 colorizer last setting
  updated_at     timestamptz not null default now(),
  primary key (user_id, project_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. AAPOR outcome mapping — admin maps project_statuses to AAPOR outcome codes
--    I=interview, P=partial, R=refusal, NC=non-contact, O=other,
--    UH=unknown household, UO=unknown other
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.project_aapor_mapping (
  project_id    uuid not null references public.projects(id) on delete cascade,
  status_id     uuid not null references public.project_statuses(id) on delete cascade,
  aapor_outcome text not null check (aapor_outcome in ('I','P','R','NC','O','UH','UO')),
  updated_at    timestamptz not null default now(),
  primary key (project_id, status_id)
);

create index if not exists idx_aapor_project on public.project_aapor_mapping(project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Demographics schema — admin declares which raw_data keys are stratifiers
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.project_demographics_schema (
  project_id      uuid not null references public.projects(id) on delete cascade,
  raw_data_key    text not null,                       -- key in survey_responses.raw_data
  stratifier_type text not null check (stratifier_type in
                    ('age','race','sex','income','tenure','education','language','other')),
  value_mapping   jsonb,                                -- maps response values → ACS categories
  acs_join_method text not null default 'tract'
                  check (acs_join_method in ('tract','block_group','none')),
  updated_at      timestamptz not null default now(),
  primary key (project_id, raw_data_key)
);

create index if not exists idx_demo_project on public.project_demographics_schema(project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Column profiles — pre-computed type inference per import, drives A0
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.survey_imports
  add column if not exists column_profiles jsonb not null default '{}'::jsonb;

comment on column public.survey_imports.column_profiles is
'Per-column type inference for the A0 colorizer. Shape: {key: {inferred_type, n_non_null, distinct, skewness, min, max, sample_values}}';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Baked-in ACS / SVI / PLACES lookups (Florida tract-level for M7)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.acs_tract_profile (
  tract_geoid         text primary key,                 -- 11-char Census tract GEOID
  year                int  not null default 2023,        -- ACS 5-year vintage (2019-2023)
  total_pop           int,
  pct_white           numeric, pct_black numeric, pct_hispanic numeric,
  pct_asian           numeric, pct_other numeric,
  pct_age_under18     numeric, pct_age_18_64 numeric, pct_age_65_plus numeric,
  median_hh_income    numeric, pct_below_poverty numeric,
  pct_owner_occupied  numeric, pct_renter numeric, pct_vacant numeric,
  pct_english_only    numeric, pct_other_language numeric,
  moe_jsonb           jsonb,                             -- ACS margin-of-error per field
  loaded_at           timestamptz not null default now()
);

create index if not exists idx_acs_year on public.acs_tract_profile(year);

create table if not exists public.cdc_svi_tract (
  tract_geoid text primary key,
  year        int not null default 2022,
  rpl_theme1  numeric,                                   -- socioeconomic status
  rpl_theme2  numeric,                                   -- household composition
  rpl_theme3  numeric,                                   -- minority status & language
  rpl_theme4  numeric,                                   -- housing & transportation
  rpl_themes  numeric,                                   -- overall SVI percentile
  flag_count  int,
  loaded_at   timestamptz not null default now()
);

create table if not exists public.cdc_places_tract (
  tract_geoid text not null,
  year        int  not null default 2022,
  indicator   text not null,                             -- e.g. 'CASTHMA','BPHIGH','OBESITY'
  value       numeric,
  ci_low      numeric,
  ci_high     numeric,
  loaded_at   timestamptz not null default now(),
  primary key (tract_geoid, year, indicator)
);

create index if not exists idx_places_indicator on public.cdc_places_tract(indicator);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Catalog upvotes — record interest in "Coming" stub cards
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.catalog_card_votes (
  card_id    text not null,                              -- e.g. 'A30_time_per_stop'
  project_id uuid not null references public.projects(id) on delete cascade,
  voter_id   uuid references public.profiles(id) on delete set null,
  voted_at   timestamptz not null default now(),
  primary key (card_id, project_id, voter_id)
);

create index if not exists idx_votes_card on public.catalog_card_votes(card_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Curbstoning audit — every view of A31 is logged
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.curbstoning_audit (
  id             uuid primary key default gen_random_uuid(),
  viewer_id      uuid not null references public.profiles(id) on delete set null,
  project_id     uuid not null references public.projects(id) on delete cascade,
  surveyor_id    uuid references public.profiles(id) on delete set null,
  action         text not null check (action in ('view_card','open_review','mark_reviewed','open_ticket')),
  viewed_at      timestamptz not null default now()
);

create index if not exists idx_curb_project on public.curbstoning_audit(project_id, viewed_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RLS — viewers read, admin/member writes per existing project-membership pattern
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.project_saved_views          enable row level security;
alter table public.user_view_state              enable row level security;
alter table public.project_aapor_mapping        enable row level security;
alter table public.project_demographics_schema  enable row level security;
alter table public.catalog_card_votes           enable row level security;
alter table public.curbstoning_audit            enable row level security;

-- ACS / SVI / PLACES are public-read reference data; service-role-only writes.
alter table public.acs_tract_profile enable row level security;
alter table public.cdc_svi_tract     enable row level security;
alter table public.cdc_places_tract  enable row level security;

create policy if not exists acs_read_all  on public.acs_tract_profile for select using (true);
create policy if not exists svi_read_all  on public.cdc_svi_tract     for select using (true);
create policy if not exists plc_read_all  on public.cdc_places_tract  for select using (true);

-- Project-scoped tables: members of the project can read; admin can write
-- (mirrors the pattern in supabase/migrations/003 and 004).
create policy if not exists views_member_read on public.project_saved_views
  for select using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = project_saved_views.project_id
        and pm.user_id    = auth.uid()
    )
  );

create policy if not exists views_admin_write on public.project_saved_views
  for all using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = project_saved_views.project_id
        and pm.user_id    = auth.uid()
        and pm.role       in ('owner','admin')
    )
  ) with check (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = project_saved_views.project_id
        and pm.user_id    = auth.uid()
        and pm.role       in ('owner','admin')
    )
  );

create policy if not exists uvs_self on public.user_view_state
  for all using (user_id = auth.uid())
        with check (user_id = auth.uid());

create policy if not exists aapor_member_read on public.project_aapor_mapping
  for select using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = project_aapor_mapping.project_id
        and pm.user_id    = auth.uid()
    )
  );

create policy if not exists aapor_admin_write on public.project_aapor_mapping
  for all using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = project_aapor_mapping.project_id
        and pm.user_id    = auth.uid()
        and pm.role       in ('owner','admin')
    )
  ) with check (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = project_aapor_mapping.project_id
        and pm.user_id    = auth.uid()
        and pm.role       in ('owner','admin')
    )
  );

create policy if not exists demo_admin_write on public.project_demographics_schema
  for all using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = project_demographics_schema.project_id
        and pm.user_id    = auth.uid()
        and pm.role       in ('owner','admin')
    )
  ) with check (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = project_demographics_schema.project_id
        and pm.user_id    = auth.uid()
        and pm.role       in ('owner','admin')
    )
  );

create policy if not exists demo_member_read on public.project_demographics_schema
  for select using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = project_demographics_schema.project_id
        and pm.user_id    = auth.uid()
    )
  );

create policy if not exists votes_member_write on public.catalog_card_votes
  for all using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = catalog_card_votes.project_id
        and pm.user_id    = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = catalog_card_votes.project_id
        and pm.user_id    = auth.uid()
    )
  );

create policy if not exists curb_admin_read on public.curbstoning_audit
  for select using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = curbstoning_audit.project_id
        and pm.user_id    = auth.uid()
        and pm.role       in ('owner','admin')
    )
  );

create policy if not exists curb_admin_write on public.curbstoning_audit
  for insert with check (
    viewer_id = auth.uid()
    and exists (
      select 1 from public.project_members pm
      where pm.project_id = curbstoning_audit.project_id
        and pm.user_id    = auth.uid()
        and pm.role       in ('owner','admin')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Seed the five system Saved Views for every existing project
--     (also fires for new projects via trigger below)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.seed_system_saved_views(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Default — research-backed default pack
  insert into public.project_saved_views (project_id, name, role_gate, cards, is_default, is_system, description)
  values (
    p_project_id, 'Default', 'member',
    jsonb_build_array(
      'match_donut','A16_rr','A17_coop_ref','A18_con','A21_finish','A23_hour_local',
      'A24_dow','A25_velocity','A28_productivity','A39_freshness','A51_topk'),
    true, true, 'Research-backed default pack — every project starts here.'
  ) on conflict do nothing;

  -- Coverage
  insert into public.project_saved_views (project_id, name, role_gate, cards, is_default, is_system, description)
  values (
    p_project_id, 'Coverage', 'member',
    jsonb_build_array(
      'A19_universe_map','A20_undersampled','A21_finish','A22_refusal_pattern',
      'A13_cov_heatmap','A51_topk','A16_rr','A17_coop_ref','A18_con','A39_freshness'),
    false, true, 'Action-oriented view for project leads — where to go next.'
  ) on conflict do nothing;

  -- QC (admin-only)
  insert into public.project_saved_views (project_id, name, role_gate, cards, is_default, is_system, description)
  values (
    p_project_id, 'QC', 'admin',
    jsonb_build_array(
      'A28_productivity','A29_gps_outlier','A30_time_per_stop','A31_curbstone',
      'A32_photo_skip','A33_off_boundary','A34_missing_heatmap','A39_freshness'),
    false, true, 'Admin-only QC view — surveyor productivity, GPS QC, falsification indicators.'
  ) on conflict do nothing;

  -- Health-equity
  insert into public.project_saved_views (project_id, name, role_gate, cards, is_default, is_system, description)
  values (
    p_project_id, 'Health-equity', 'member',
    jsonb_build_array(
      'A40_sample_vs_acs','A41_whos_missing','A42_lorenz','A15_svi_cross',
      'A8_gi_star','A11_kde','A13_cov_heatmap','A39_freshness'),
    false, true, 'Representativeness, equity overlays, and SVI cross-mapping.'
  ) on conflict do nothing;

  -- Velocity
  insert into public.project_saved_views (project_id, name, role_gate, cards, is_default, is_system, description)
  values (
    p_project_id, 'Velocity', 'member',
    jsonb_build_array(
      'A23_hour_local','A24_dow','A25_velocity','A26_decay','A27_wow','A21_finish','A39_freshness'),
    false, true, 'How are we doing this week? Temporal-only view.'
  ) on conflict do nothing;
end $$;

revoke all on function public.seed_system_saved_views(uuid) from public, anon, authenticated;
grant execute on function public.seed_system_saved_views(uuid) to service_role;

-- Trigger: seed views on new project insert
create or replace function public.tg_seed_saved_views_on_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_system_saved_views(new.id);
  return new;
end $$;

drop trigger if exists tg_projects_seed_views on public.projects;
create trigger tg_projects_seed_views
  after insert on public.projects
  for each row execute function public.tg_seed_saved_views_on_project();

-- Backfill: seed the system views for any existing projects
do $$
declare r record;
begin
  for r in select id from public.projects loop
    perform public.seed_system_saved_views(r.id);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Helper RPC: get_active_view — resolve a viewer's active view + overrides
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_active_view(p_project_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_state record;
  v_view  record;
  v_cards jsonb;
begin
  select active_view_id, card_overrides, colorize_spec
    into v_state
    from public.user_view_state
   where user_id = auth.uid() and project_id = p_project_id;

  if v_state.active_view_id is not null then
    select id, name, role_gate, cards, is_default, colorize_spec
      into v_view
      from public.project_saved_views
     where id = v_state.active_view_id;
  end if;

  if v_view.id is null then
    select id, name, role_gate, cards, is_default, colorize_spec
      into v_view
      from public.project_saved_views
     where project_id = p_project_id and is_default = true
     limit 1;
  end if;

  v_cards := coalesce(v_view.cards, '[]'::jsonb);

  return jsonb_build_object(
    'view_id',        v_view.id,
    'view_name',      v_view.name,
    'role_gate',      v_view.role_gate,
    'cards',          v_cards,
    'card_overrides', coalesce(v_state.card_overrides, '{}'::jsonb),
    'colorize_spec',  coalesce(v_state.colorize_spec, v_view.colorize_spec)
  );
end $$;

revoke all on function public.get_active_view(uuid) from public, anon;
grant execute on function public.get_active_view(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Helper RPC: vote_for_stub_card — idempotent upvote, member+ allowed
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.vote_for_stub_card(p_card_id text, p_project_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.catalog_card_votes(card_id, project_id, voter_id)
  values (p_card_id, p_project_id, auth.uid())
  on conflict do nothing;
end $$;

revoke all on function public.vote_for_stub_card(text, uuid) from public, anon;
grant execute on function public.vote_for_stub_card(text, uuid) to authenticated;
