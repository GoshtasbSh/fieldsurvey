-- Fix CSV import error: "there is no unique or exclusion constraint matching
-- the ON CONFLICT specification".
--
-- Root cause: app/api/responses/import/route.ts upserts with
--   onConflict: "project_id,external_id"
-- but the table only had a PARTIAL unique index
--   (project_id, external_id) WHERE external_id IS NOT NULL.
-- PostgreSQL cannot infer a partial unique index in ON CONFLICT unless the
-- statement also names the same WHERE predicate, and the Supabase JS client
-- has no way to attach one. So every import hit this error.
--
-- Replace the partial index with a real UNIQUE constraint. Postgres 17
-- defaults to NULLS DISTINCT, so multiple rows with NULL external_id remain
-- allowed per project (same behavior as the partial index), while non-null
-- external_ids are deduped per project.

begin;

drop index if exists public.ux_responses_external;

alter table public.survey_responses
  add constraint survey_responses_project_external_unique
  unique (project_id, external_id);

commit;
