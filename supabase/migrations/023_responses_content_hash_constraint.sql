-- Replace the partial unique index on (project_id, content_hash) with a real
-- UNIQUE constraint. Same lesson as migration 020 on the external_id index:
-- PostgREST's .upsert({ onConflict: "project_id,content_hash" }) cannot infer
-- a partial unique index in ON CONFLICT unless the SQL also names the same
-- WHERE predicate, and the Supabase JS client has no way to attach one.
--
-- The import route always computes a non-null content_hash, so a regular
-- UNIQUE constraint preserves the prior dedup semantics. PG17 NULLS DISTINCT
-- (default) still allows any pre-existing rows with NULL hash to coexist.

begin;

drop index if exists public.ux_responses_content_hash;

alter table public.survey_responses
  add constraint survey_responses_project_content_hash_unique
  unique (project_id, content_hash);

commit;
