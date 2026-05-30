-- 019_get_active_view_typed_record.sql
-- HOTFIX: Stage C verification caught `get_active_view` erroring with
--   ERROR: record "v_view" is not assigned yet
-- when the caller has no row in user_view_state (every first-time user, plus
-- service-role MCP calls). PL/pgSQL cannot inspect fields on an unassigned
-- generic record. Switch v_view to a typed %rowtype so it's always inspectable
-- (NULL on every field until the SELECT INTO succeeds).

set search_path = public, extensions;

create or replace function public.get_active_view(p_project_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_state_view_id uuid;
  v_state_overrides jsonb;
  v_state_colorize jsonb;
  v_view public.project_saved_views%rowtype;
  v_cards jsonb;
begin
  select active_view_id, card_overrides, colorize_spec
    into v_state_view_id, v_state_overrides, v_state_colorize
    from public.user_view_state
   where user_id = auth.uid() and project_id = p_project_id;

  if v_state_view_id is not null then
    select * into v_view from public.project_saved_views where id = v_state_view_id;
  end if;

  if v_view.id is null then
    select * into v_view
      from public.project_saved_views
     where project_id = p_project_id and is_default = true
     limit 1;
  end if;

  v_cards := coalesce(v_view.cards, '[]'::jsonb);

  return jsonb_build_object(
    'view_id',        v_view.id,
    'view_name',      v_view.name,
    'role_gate',      v_view.role_gate,
    'cards',          v_cards,
    'card_overrides', coalesce(v_state_overrides, '{}'::jsonb),
    'colorize_spec',  coalesce(v_state_colorize, v_view.colorize_spec)
  );
end $$;

revoke all on function public.get_active_view(uuid) from public, anon;
grant execute on function public.get_active_view(uuid) to authenticated;
