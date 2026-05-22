-- FieldSurvey M1 init: profiles, projects, members, invites, statuses, settings

create extension if not exists "pgcrypto";

-- profiles -----------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_self_read"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

create policy "profiles_share_member_read"
  on public.profiles for select to authenticated
  using (exists (
    select 1
    from public.project_members me
    join public.project_members other on other.project_id = me.project_id
    where me.user_id = auth.uid() and other.user_id = profiles.id
  ));

create policy "profiles_self_update"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- Auto-create profile row on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- projects -----------------------------------------------------------------
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles(id) on delete restrict,
  name         text not null check (char_length(name) between 1 and 80),
  description  text check (description is null or char_length(description) <= 1000),
  center_lat   double precision not null,
  center_lon   double precision not null,
  default_zoom integer not null default 14 check (default_zoom between 1 and 22),
  visibility   text not null default 'private' check (visibility in ('private','public_read')),
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_projects_owner on public.projects(owner_id);
create index if not exists idx_projects_visibility on public.projects(visibility);

alter table public.projects enable row level security;

-- project_members ----------------------------------------------------------
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('owner','admin','surveyor','viewer')),
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists idx_pm_user on public.project_members(user_id);

alter table public.project_members enable row level security;

-- Helper functions ---------------------------------------------------------
create or replace function public.is_project_member(p_project uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = auth.uid()
  );
$$;

create or replace function public.project_role(p_project uuid)
returns text language sql security definer stable set search_path = public as $$
  select role from public.project_members
  where project_id = p_project and user_id = auth.uid();
$$;

create or replace function public.is_public_project(p_project uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.projects where id = p_project and visibility = 'public_read'
  );
$$;

-- projects RLS -------------------------------------------------------------
create policy "projects_read_members_or_public"
  on public.projects for select
  using (
    public.is_project_member(id)
    or visibility = 'public_read'
  );

create policy "projects_insert_authenticated"
  on public.projects for insert to authenticated
  with check (owner_id = auth.uid());

create policy "projects_update_admin"
  on public.projects for update to authenticated
  using (public.project_role(id) in ('owner','admin'))
  with check (public.project_role(id) in ('owner','admin'));

create policy "projects_delete_owner"
  on public.projects for delete to authenticated
  using (public.project_role(id) = 'owner');

-- Make owner a member automatically
create or replace function public.add_owner_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_project_owner_membership on public.projects;
create trigger trg_project_owner_membership
  after insert on public.projects
  for each row execute function public.add_owner_membership();

-- project_members RLS ------------------------------------------------------
create policy "pm_read_members"
  on public.project_members for select
  using (public.is_project_member(project_id));

create policy "pm_insert_admin"
  on public.project_members for insert to authenticated
  with check (public.project_role(project_id) in ('owner','admin'));

create policy "pm_update_admin"
  on public.project_members for update to authenticated
  using (public.project_role(project_id) in ('owner','admin'))
  with check (public.project_role(project_id) in ('owner','admin'));

create policy "pm_delete_admin"
  on public.project_members for delete to authenticated
  using (public.project_role(project_id) in ('owner','admin'));

-- project_invites ----------------------------------------------------------
create table if not exists public.project_invites (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  email       text not null check (char_length(email) <= 255),
  role        text not null check (role in ('admin','surveyor','viewer')),
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by  uuid not null references public.profiles(id),
  expires_at  timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_invites_token on public.project_invites(token);
create index if not exists idx_invites_email on public.project_invites(lower(email));

alter table public.project_invites enable row level security;

create policy "invites_read_admin"
  on public.project_invites for select to authenticated
  using (public.project_role(project_id) in ('owner','admin'));

create policy "invites_insert_admin"
  on public.project_invites for insert to authenticated
  with check (public.project_role(project_id) in ('owner','admin') and invited_by = auth.uid());

create policy "invites_update_admin"
  on public.project_invites for update to authenticated
  using (public.project_role(project_id) in ('owner','admin'));

create policy "invites_delete_admin"
  on public.project_invites for delete to authenticated
  using (public.project_role(project_id) in ('owner','admin'));

-- Accept-invite RPC: validates token, inserts membership, marks accepted
create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_invite public.project_invites%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into v_invite from public.project_invites
    where token = p_token and accepted_at is null and expires_at > now()
    for update;

  if not found then
    raise exception 'invalid_or_expired_invite' using errcode = '22023';
  end if;

  if lower(v_invite.email) <> lower(v_email) then
    raise exception 'invite_email_mismatch' using errcode = '22023';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (v_invite.project_id, auth.uid(), v_invite.role)
  on conflict (project_id, user_id) do nothing;

  update public.project_invites set accepted_at = now() where id = v_invite.id;
  return v_invite.project_id;
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;

-- project_statuses ---------------------------------------------------------
create table if not exists public.project_statuses (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  label      text not null check (char_length(label) between 1 and 40),
  color      text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon       text,
  sort_order integer not null default 0,
  is_default boolean not null default false
);

create index if not exists idx_statuses_project on public.project_statuses(project_id);

alter table public.project_statuses enable row level security;

create policy "statuses_read_members_or_public"
  on public.project_statuses for select
  using (public.is_project_member(project_id) or public.is_public_project(project_id));

create policy "statuses_write_admin"
  on public.project_statuses for all to authenticated
  using (public.project_role(project_id) in ('owner','admin'))
  with check (public.project_role(project_id) in ('owner','admin'));

-- Seed default statuses on project create
create or replace function public.seed_default_statuses()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_statuses (project_id, label, color, icon, sort_order, is_default) values
    (new.id, 'Completed',     '#34d399', 'check-circle',    1, true),
    (new.id, 'No Answer',     '#f59e0b', 'door-closed',     2, false),
    (new.id, 'Inaccessible',  '#9ca3af', 'ban',             3, false),
    (new.id, 'Not Interested','#ef4444', 'x-circle',        4, false),
    (new.id, 'Follow Up',     '#38bdf8', 'rotate-cw',       5, false),
    (new.id, 'Other',         '#a78bfa', 'circle-help',     6, false);
  return new;
end;
$$;

drop trigger if exists trg_seed_statuses on public.projects;
create trigger trg_seed_statuses
  after insert on public.projects
  for each row execute function public.seed_default_statuses();

-- project_settings ---------------------------------------------------------
create table if not exists public.project_settings (
  project_id              uuid primary key references public.projects(id) on delete cascade,
  external_survey_url     text,
  qualtrics_survey_id     text,
  qualtrics_match_field   text default 'address' check (qualtrics_match_field in ('address','street_name','point_id')),
  updated_at              timestamptz not null default now()
);

alter table public.project_settings enable row level security;

create policy "settings_read_members_or_public"
  on public.project_settings for select
  using (public.is_project_member(project_id) or public.is_public_project(project_id));

create policy "settings_write_admin"
  on public.project_settings for all to authenticated
  using (public.project_role(project_id) in ('owner','admin'))
  with check (public.project_role(project_id) in ('owner','admin'));

-- Seed empty settings row on project create
create or replace function public.seed_project_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_settings (project_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists trg_seed_settings on public.projects;
create trigger trg_seed_settings
  after insert on public.projects
  for each row execute function public.seed_project_settings();

-- updated_at trigger -------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_projects_touch on public.projects;
create trigger trg_projects_touch
  before update on public.projects
  for each row execute function public.touch_updated_at();
