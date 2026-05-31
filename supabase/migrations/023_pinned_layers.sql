-- 023_pinned_layers.sql
-- M7.2 — persist the user's pinned analysis result layers on user_view_state.
-- Each entry is a PinnedAnalysisLayer: {cardId, layerName, settings, visible,
-- pinnedAt, cachedResult?, cachedAt?}.

set search_path = public, extensions;

alter table public.user_view_state
  add column if not exists pinned_layers jsonb not null default '[]'::jsonb;

comment on column public.user_view_state.pinned_layers is
  'Ordered array of {cardId, layerName, settings, visible, pinnedAt, cachedResult?, cachedAt?}. '
  'Rendered in the left-rail Analysis tab as toggleable map overlays.';

alter table public.user_view_state
  add constraint user_view_state_pinned_layers_is_array
  check (jsonb_typeof(pinned_layers) = 'array');
