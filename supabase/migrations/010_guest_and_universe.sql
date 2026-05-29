-- FieldSurvey M5 — Guest mode + opt-in survey universe.
--
-- Locked decisions (project_fieldsurvey_keystone_backport_decisions):
--   • Guest mode YES, KeyStone-style. Admin issues day-codes; validated
--     guests insert into `points` with `guest_session_id`. No persistent
--     account.
--   • Universe YES, opt-in per-project via `project_settings.canvass_mode`.
--     Admin uploads addresses; mobile shows remaining-to-visit; analytics
--     switch to canvass-completion %.
--
-- All new tables get RLS day-one. Service-role bypass only for the
-- guest-insert API route (which validates the cookie before inserting).

-- ────────────────────────────────────────────────────────────────────────
-- 1. guest_sessions — admin-issued day-codes
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.guest_sessions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  code        text not null,
  label       text,
  issued_by   uuid references public.profiles(id) on delete set null,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '24 hours'),
  revoked_at  timestamptz
);

-- Same code can be reused across projects but never within one
create unique index if not exists ux_guest_sessions_project_code
  on public.guest_sessions(project_id, code)
  where revoked_at is null;

create index if not exists idx_guest_sessions_project_active
  on public.guest_sessions(project_id, expires_at)
  where revoked_at is null;

alter table public.guest_sessions enable row level security;

-- Read = owner + admin only.
drop policy if exists "guest_sessions_read_admin" on public.guest_sessions;
create policy "guest_sessions_read_admin"
  on public.guest_sessions for select
  using (public.project_role(project_id) in ('owner','admin'));

-- Insert/update/delete = owner + admin only.
drop policy if exists "guest_sessions_insert_admin" on public.guest_sessions;
create policy "guest_sessions_insert_admin"
  on public.guest_sessions for insert to authenticated
  with check (
    issued_by = auth.uid()
    and public.project_role(project_id) in ('owner','admin')
  );

drop policy if exists "guest_sessions_update_admin" on public.guest_sessions;
create policy "guest_sessions_update_admin"
  on public.guest_sessions for update to authenticated
  using (public.project_role(project_id) in ('owner','admin'))
  with check (public.project_role(project_id) in ('owner','admin'));

drop policy if exists "guest_sessions_delete_admin" on public.guest_sessions;
create policy "guest_sessions_delete_admin"
  on public.guest_sessions for delete to authenticated
  using (public.project_role(project_id) in ('owner','admin'));

-- ────────────────────────────────────────────────────────────────────────
-- 2. points.guest_session_id — audit which session inserted which point
-- ────────────────────────────────────────────────────────────────────────
alter table public.points
  add column if not exists guest_session_id uuid references public.guest_sessions(id) on delete set null;

create index if not exists idx_points_guest_session
  on public.points(guest_session_id)
  where guest_session_id is not null;

-- ────────────────────────────────────────────────────────────────────────
-- 3. validate_guest_code RPC — resolves a code to a session, with checks
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.validate_guest_code(p_code text)
returns table (session_id uuid, project_id uuid, expires_at timestamptz)
language sql
security definer
set search_path = public, pg_temp
as $$
  select id, project_id, expires_at
  from public.guest_sessions
  where code = p_code
    and revoked_at is null
    and expires_at > now()
  limit 1;
$$;

revoke execute on function public.validate_guest_code(text) from public;
revoke execute on function public.validate_guest_code(text) from anon;
revoke execute on function public.validate_guest_code(text) from authenticated;
grant  execute on function public.validate_guest_code(text) to service_role;

-- ────────────────────────────────────────────────────────────────────────
-- 4. survey_universe — opt-in canvass list per project
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.survey_universe (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  address      text not null,
  lat          double precision,
  lon          double precision,
  status       text not null default 'not_visited'
                  check (status in ('not_visited','visited','skipped')),
  visited_at   timestamptz,
  visited_by   uuid references public.profiles(id) on delete set null,
  point_id     uuid references public.points(id) on delete set null,
  external_id  text,
  raw_data     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_universe_project_status
  on public.survey_universe(project_id, status);
create index if not exists idx_universe_project_address
  on public.survey_universe(project_id, lower(address));

alter table public.survey_universe enable row level security;

-- Read = any project member.
drop policy if exists "universe_read_members" on public.survey_universe;
create policy "universe_read_members"
  on public.survey_universe for select
  using (public.is_project_member(project_id));

-- Insert = owner + admin (bulk upload by admin only).
drop policy if exists "universe_insert_admin" on public.survey_universe;
create policy "universe_insert_admin"
  on public.survey_universe for insert to authenticated
  with check (public.project_role(project_id) in ('owner','admin'));

-- Update = owner/admin/surveyor (surveyor can mark visited).
drop policy if exists "universe_update_members_collect" on public.survey_universe;
create policy "universe_update_members_collect"
  on public.survey_universe for update to authenticated
  using (public.project_role(project_id) in ('owner','admin','surveyor'))
  with check (public.project_role(project_id) in ('owner','admin','surveyor'));

-- Delete = owner + admin only.
drop policy if exists "universe_delete_admin" on public.survey_universe;
create policy "universe_delete_admin"
  on public.survey_universe for delete to authenticated
  using (public.project_role(project_id) in ('owner','admin'));

-- ────────────────────────────────────────────────────────────────────────
-- 5. project_settings.canvass_mode — opt-in per-project flag
-- ────────────────────────────────────────────────────────────────────────
alter table public.project_settings
  add column if not exists canvass_mode boolean not null default false;

-- ────────────────────────────────────────────────────────────────────────
-- 6. Touch updated_at on universe writes
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.touch_universe_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_universe_updated_at on public.survey_universe;
create trigger trg_touch_universe_updated_at
  before update on public.survey_universe
  for each row execute function public.touch_universe_updated_at();
