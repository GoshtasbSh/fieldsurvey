-- Fix create-project flow: let the owner read their own project directly.
--
-- The previous SELECT policy on `projects` required either project
-- membership (via the AFTER INSERT trigger trg_project_owner_membership)
-- or `visibility='public_read'`. When the create-project UI inserts a
-- row with `RETURNING id`, the RETURNING SELECT evaluates against a
-- snapshot taken before the INSERT — at that point the membership row
-- doesn't exist yet, and `is_project_member()` returns false. The
-- ANON-key Supabase client then surfaces:
--
--   new row violates row-level security policy for table "projects"
--
-- (technically a SELECT denial during RETURNING, but the client wraps
-- it under the WITH CHECK error.) Adding `owner_id = auth.uid()` as a
-- third allowed condition is the obvious fix: the owner can read their
-- own project at all times, regardless of trigger ordering.

drop policy if exists "projects_read_members_or_public" on public.projects;
drop policy if exists "projects_read_owner_member_or_public" on public.projects;
create policy "projects_read_owner_member_or_public"
  on public.projects for select
  using (
    owner_id = auth.uid()
    or public.is_project_member(id)
    or visibility = 'public_read'
  );
