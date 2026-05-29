-- FieldSurvey M4 — chat_message_attachments + chat-attachments Storage bucket
--
-- Locked decisions (see project-fieldsurvey-m4-locked-decisions memory):
--   • Images only: image/jpeg, image/png, image/webp, image/heic, image/gif.
--   • 10 MB per file (enforced at API layer + Storage bucket policy).
--   • Multi-attachment per message via this join table (not JSONB column).
--   • New `chat-attachments` Storage bucket — separate from point-photos for
--     RLS clarity and bucket-level retention.
--   • Path convention: {project_id}/{message_id}/{filename}
--   • RLS: read = team member of project; write = message author; delete =
--     message author OR owner/admin of project (moderation).
--   • Signed URLs (1 hour TTL) used for rendering — never public read.

-- ────────────────────────────────────────────────────────────────────────
-- 1. chat_message_attachments
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.chat_message_attachments (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.chat_messages(id) on delete cascade,
  path        text not null,                       -- {project_id}/{message_id}/{filename}
  mime        text not null
                check (mime in (
                  'image/jpeg',
                  'image/png',
                  'image/webp',
                  'image/heic',
                  'image/heif',
                  'image/gif'
                )),
  size        integer not null check (size > 0 and size <= 10 * 1024 * 1024),
  name        text not null check (char_length(name) between 1 and 256),
  width_px    integer,                             -- optional thumbnail hints
  height_px   integer,
  created_at  timestamptz not null default now()
);

create index if not exists idx_chat_attach_message
  on public.chat_message_attachments(message_id);
create index if not exists idx_chat_attach_path
  on public.chat_message_attachments(path);

alter table public.chat_message_attachments enable row level security;

-- Read = anyone who can read the parent message (project member).
drop policy if exists "chat_attach_read_members" on public.chat_message_attachments;
create policy "chat_attach_read_members"
  on public.chat_message_attachments for select
  using (
    exists (
      select 1 from public.chat_messages m
      where m.id = chat_message_attachments.message_id
        and public.is_project_member(m.project_id)
    )
  );

-- Insert = the author of the parent message inserting their own attachment.
drop policy if exists "chat_attach_insert_author" on public.chat_message_attachments;
create policy "chat_attach_insert_author"
  on public.chat_message_attachments for insert to authenticated
  with check (
    exists (
      select 1 from public.chat_messages m
      where m.id = chat_message_attachments.message_id
        and m.author_id = auth.uid()
        and public.is_project_member(m.project_id)
    )
  );

-- Delete = author of the message OR project owner/admin (moderation).
drop policy if exists "chat_attach_delete_author_or_admin" on public.chat_message_attachments;
create policy "chat_attach_delete_author_or_admin"
  on public.chat_message_attachments for delete to authenticated
  using (
    exists (
      select 1 from public.chat_messages m
      where m.id = chat_message_attachments.message_id
        and (
          m.author_id = auth.uid()
          or public.project_role(m.project_id) in ('owner','admin')
        )
    )
  );

-- ────────────────────────────────────────────────────────────────────────
-- 2. Storage bucket — chat-attachments (private)
-- ────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  10 * 1024 * 1024,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/gif'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ────────────────────────────────────────────────────────────────────────
-- 3. Storage RLS — bucket-scoped policies on storage.objects
-- ────────────────────────────────────────────────────────────────────────
-- Read: project member of the project encoded in the path's first segment.
drop policy if exists "chat_attach_storage_read_members" on storage.objects;
create policy "chat_attach_storage_read_members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and public.is_project_member((string_to_array(name, '/'))[1]::uuid)
  );

-- Insert: any authenticated user who is a project member; the API enforces
-- that the message_id (path segment 2) is one the user authored.
drop policy if exists "chat_attach_storage_insert_member" on storage.objects;
create policy "chat_attach_storage_insert_member"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and public.is_project_member((string_to_array(name, '/'))[1]::uuid)
  );

-- Delete: project owner/admin of the project encoded in path[1] OR the
-- original uploader (storage tracks uploader in owner_id).
drop policy if exists "chat_attach_storage_delete_owner_or_admin" on storage.objects;
create policy "chat_attach_storage_delete_owner_or_admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (
      owner_id::uuid = auth.uid()
      or public.project_role((string_to_array(name, '/'))[1]::uuid) in ('owner','admin')
    )
  );
