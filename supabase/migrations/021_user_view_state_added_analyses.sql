-- 021_user_view_state_added_analyses.sql
-- M7.2 Wave 0 — persist the user's added spatial analyses, the global active
-- question, the filter chip, and per-card question overrides on user_view_state.

set search_path = public, extensions;

alter table public.user_view_state
  add column if not exists active_question_key      text,
  add column if not exists filter_chip              jsonb not null default '{}'::jsonb,
  add column if not exists card_question_overrides  jsonb not null default '{}'::jsonb,
  add column if not exists added_analyses           jsonb not null default '[]'::jsonb;

comment on column public.user_view_state.active_question_key is
  'Global active question for the Analyze tab. Spatial cards inherit unless overridden.';
comment on column public.user_view_state.filter_chip is
  'Active filter chip applied to A0 colorizer + all spatial cards. Shape: { questionKey, op, value }.';
comment on column public.user_view_state.card_question_overrides is
  'Per-card question override. Shape: { card_id: question_key }.';
comment on column public.user_view_state.added_analyses is
  'Ordered array of {cardId, settings} added to the Analyze tab. Wave-0 ordering is insert-order.';

-- Lightweight validation: added_analyses must be a JSONB array.
alter table public.user_view_state
  add constraint user_view_state_added_analyses_is_array
  check (jsonb_typeof(added_analyses) = 'array');
