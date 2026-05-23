-- FieldSurvey M3 — chat, presence, soft caps, public read-only.
--
-- Adds: chat_messages, system_limits, project_caps view, public_read RLS
-- expansion, role-change audit, soft-cap helpers.

-- ────────────────────────────────────────────────────────────────────────
-- chat_messages
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 4000),
  mentions    uuid[] not null default '{}',           -- profile ids mentioned via @name
  edited_at   timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_chat_project_created on public.chat_messages(project_id, created_at desc);
create index if not exists idx_chat_mentions       on public.chat_messages using gin(mentions);

alter table public.chat_messages enable row level security;

-- Members can read all messages in their projects
create policy "chat_read_members"
  on public.chat_messages for select
  using (public.is_project_member(project_id));

-- Members can post their own messages
create policy "chat_insert_self_member"
  on public.chat_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.is_project_member(project_id)
  );

-- Authors can edit their own messages
create policy "chat_update_self"
  on public.chat_messages for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- Authors and admins can delete
create policy "chat_delete_self_or_admin"
  on public.chat_messages for delete to authenticated
  using (
    author_id = auth.uid()
    or public.project_role(project_id) in ('owner','admin')
  );

-- Bump edited_at on update
create or replace function public.touch_chat_edited()
returns trigger language plpgsql as $$
begin
  if new.body is distinct from old.body then
    new.edited_at = now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_chat_edited on public.chat_messages;
create trigger trg_chat_edited
  before update on public.chat_messages
  for each row execute function public.touch_chat_edited();

-- ────────────────────────────────────────────────────────────────────────
-- system_limits — configurable soft caps
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.system_limits (
  id                          int primary key default 1 check (id = 1),
  max_projects_per_user       int  not null default 10,
  max_points_per_project      int  not null default 10000,
  max_photo_bytes_per_project bigint not null default 104857600,   -- 100 MB
  max_pending_invites         int  not null default 20,
  warn_at_pct                 int  not null default 90 check (warn_at_pct between 50 and 100),
  updated_at                  timestamptz not null default now()
);

insert into public.system_limits (id) values (1) on conflict (id) do nothing;

-- Anyone can read the limits (they're caps the user should know)
alter table public.system_limits enable row level security;
create policy "limits_read_all" on public.system_limits for select using (true);

-- ────────────────────────────────────────────────────────────────────────
-- v_project_caps — per-project usage vs cap, for the warning UI
-- ────────────────────────────────────────────────────────────────────────
create or replace view public.v_project_caps
with (security_invoker = true)
as
  select
    p.id as project_id,
    (select count(*) from public.points pt where pt.project_id = p.id) as points_count,
    sl.max_points_per_project,
    (select count(*) from public.project_invites i where i.project_id = p.id and i.accepted_at is null and i.expires_at > now()) as pending_invites,
    sl.max_pending_invites,
    sl.warn_at_pct
  from public.projects p
  cross join public.system_limits sl
  where p.archived = false;

-- ────────────────────────────────────────────────────────────────────────
-- Soft caps — block inserts at 100%, warn at warn_at_pct in the UI.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_points_cap()
returns trigger language plpgsql as $$
declare
  v_count int;
  v_max   int;
begin
  select max_points_per_project into v_max from public.system_limits where id = 1;
  select count(*) into v_count from public.points where project_id = new.project_id;
  if v_count >= v_max then
    raise exception 'project_points_cap_reached: this project has reached the % point cap', v_max
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_points_cap on public.points;
create trigger trg_points_cap
  before insert on public.points
  for each row execute function public.enforce_points_cap();

create or replace function public.enforce_invites_cap()
returns trigger language plpgsql as $$
declare
  v_count int;
  v_max   int;
begin
  select max_pending_invites into v_max from public.system_limits where id = 1;
  select count(*) into v_count from public.project_invites
    where project_id = new.project_id and accepted_at is null and expires_at > now();
  if v_count >= v_max then
    raise exception 'project_invites_cap_reached: % pending invites cap reached', v_max
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invites_cap on public.project_invites;
create trigger trg_invites_cap
  before insert on public.project_invites
  for each row execute function public.enforce_invites_cap();

create or replace function public.enforce_projects_cap()
returns trigger language plpgsql as $$
declare
  v_count int;
  v_max   int;
begin
  select max_projects_per_user into v_max from public.system_limits where id = 1;
  select count(*) into v_count from public.projects
    where owner_id = new.owner_id and archived = false;
  if v_count >= v_max then
    raise exception 'user_projects_cap_reached: you have hit the % project cap', v_max
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_cap on public.projects;
create trigger trg_projects_cap
  before insert on public.projects
  for each row execute function public.enforce_projects_cap();

-- ────────────────────────────────────────────────────────────────────────
-- Public read-only — expand RLS so visibility='public_read' lets anon read
-- ────────────────────────────────────────────────────────────────────────
-- projects: existing policy already covers public_read for SELECT (M1).

-- project_statuses: existing policy covers public via is_public_project
-- project_settings: same

-- points: existing read policy already includes is_public_project.

-- chat_messages: members only (chat stays private even on public projects).

-- ────────────────────────────────────────────────────────────────────────
-- Notification preferences
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.notification_prefs (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  email_invites  boolean not null default true,
  email_role     boolean not null default true,
  email_digest   boolean not null default false,    -- opt-in daily digest
  email_caps     boolean not null default true,
  updated_at     timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;
create policy "notif_read_self"   on public.notification_prefs for select to authenticated using (user_id = auth.uid());
create policy "notif_upsert_self" on public.notification_prefs for insert to authenticated with check (user_id = auth.uid());
create policy "notif_update_self" on public.notification_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
