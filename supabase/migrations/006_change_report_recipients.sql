-- FieldSurvey M4 — change_report_recipients
--
-- Locked decisions (see project-fieldsurvey-m4-locked-decisions memory):
--   • Per-project table of arbitrary email addresses (NOT user accounts).
--   • Owner + admin only can manage.
--   • Daily cadence reusing the existing daily-digest body.
--   • Cron skips a recipient if there have been zero new points/responses
--     since last_sent_at.
--   • "Send now" button bypasses the skip check and fires immediately.

create table if not exists public.change_report_recipients (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  name          text,                              -- optional display name
  email         text not null
                  check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  paused        boolean not null default false,
  added_by      uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_sent_at  timestamptz
);

-- Function-expression uniques can't ride inline UNIQUE in Postgres — use an index.
create unique index if not exists ux_change_recipients_project_email
  on public.change_report_recipients(project_id, lower(email));

create index if not exists idx_change_recipients_project
  on public.change_report_recipients(project_id);
create index if not exists idx_change_recipients_active
  on public.change_report_recipients(project_id)
  where paused = false;

alter table public.change_report_recipients enable row level security;

-- Read = owner + admin only (these are PI/stakeholder emails, not public)
drop policy if exists "recipients_read_admin" on public.change_report_recipients;
create policy "recipients_read_admin"
  on public.change_report_recipients for select
  using (public.project_role(project_id) in ('owner','admin'));

-- Insert = owner + admin
drop policy if exists "recipients_insert_admin" on public.change_report_recipients;
create policy "recipients_insert_admin"
  on public.change_report_recipients for insert to authenticated
  with check (
    added_by = auth.uid()
    and public.project_role(project_id) in ('owner','admin')
  );

-- Update (pause/unpause, edit name) = owner + admin
drop policy if exists "recipients_update_admin" on public.change_report_recipients;
create policy "recipients_update_admin"
  on public.change_report_recipients for update to authenticated
  using (public.project_role(project_id) in ('owner','admin'))
  with check (public.project_role(project_id) in ('owner','admin'));

-- Delete = owner + admin
drop policy if exists "recipients_delete_admin" on public.change_report_recipients;
create policy "recipients_delete_admin"
  on public.change_report_recipients for delete to authenticated
  using (public.project_role(project_id) in ('owner','admin'));
