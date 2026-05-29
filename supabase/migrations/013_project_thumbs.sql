-- FieldSurvey M8 — server-rendered /home thumbnails.
--
-- Adds `thumb_path` + `thumb_updated_at` to projects and provisions a
-- public-read storage bucket. The thumb generator (lib/thumb/generate.ts)
-- stitches Carto Dark Matter tiles into a 480×280 PNG and uploads via the
-- service-role client; the bucket has no anon/authenticated write policies
-- so client-side uploads are impossible.

alter table public.projects
  add column if not exists thumb_path text,
  add column if not exists thumb_updated_at timestamptz;

-- ────────────────────────────────────────────────────────────────────────
-- Storage bucket: project-thumbs (public-read, service-role-write)
-- ────────────────────────────────────────────────────────────────────────
-- Setting `public=true` on the bucket is enough — the Supabase storage
-- server exposes `/storage/v1/object/public/project-thumbs/<path>` for
-- public buckets without needing a SELECT policy on storage.objects.
-- A broad SELECT policy would additionally allow listing the bucket,
-- which we don't want; without a write policy, mutations are
-- service-role only.
insert into storage.buckets (id, name, public)
values ('project-thumbs', 'project-thumbs', true)
on conflict (id) do update set public = true;
