// Server-side queries for project Saved Views (M7 — analyses catalog).
//
// See:
//   supabase/migrations/015_analyses_catalog.sql
//   docs/superpowers/specs/2026-05-29-analyses-catalog-design.md
//
// Saved Views are admin-curated card sets per project; viewers pick one
// from the left rail. The "Default" view is auto-seeded on project create.

import { createServerSupabase } from "@/lib/supabase/server";
import type { ColorizeSpec } from "@/lib/analyses/types";

export type SavedView = {
  id: string;
  project_id: string;
  name: string;
  role_gate: "admin" | "member" | "guest" | "surveyor";
  cards: string[];
  is_default: boolean;
  is_system: boolean;
  colorize_spec: ColorizeSpec | null;
  description: string | null;
  updated_at: string;
};

export type ActiveView = {
  view_id: string | null;
  view_name: string | null;
  role_gate: string | null;
  cards: string[];
  card_overrides: Record<string, boolean>;
  colorize_spec: ColorizeSpec | null;
};

/** List all saved views for a project, filtered to the viewer's role. */
export async function listSavedViews(projectId: string, viewerRole: SavedView["role_gate"]): Promise<SavedView[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("project_saved_views") as any)
    .select("*")
    .eq("project_id", projectId)
    .order("is_default", { ascending: false })
    .order("name") as { data: SavedView[] | null };

  const roleRank = (r: SavedView["role_gate"]) =>
    r === "guest" ? 0 : r === "surveyor" ? 1 : r === "member" ? 2 : 3;
  return (data ?? []).filter((v) => roleRank(viewerRole) >= roleRank(v.role_gate));
}

/** Resolve the active view + overrides via the get_active_view RPC. */
export async function getActiveView(projectId: string): Promise<ActiveView> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).rpc("get_active_view", { p_project_id: projectId });
  if (!data) {
    return { view_id: null, view_name: null, role_gate: null, cards: [], card_overrides: {}, colorize_spec: null };
  }
  return data as ActiveView;
}

/** Apply viewer overrides to a card list. Returns the final set of card_ids to render. */
export function applyOverrides(cards: string[], overrides: Record<string, boolean>): string[] {
  const set = new Set(cards);
  for (const [k, v] of Object.entries(overrides)) {
    if (v) set.add(k); else set.delete(k);
  }
  return [...set];
}

/** Persist a single override toggle for the current viewer. */
export async function setCardOverride(projectId: string, cardId: string, enabled: boolean): Promise<void> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: current } = await sbAny
    .from("user_view_state")
    .select("card_overrides")
    .eq("project_id", projectId)
    .maybeSingle() as { data: { card_overrides: Record<string, boolean> | null } | null };

  const next: Record<string, boolean> = { ...(current?.card_overrides ?? {}), [cardId]: enabled };
  await sbAny.from("user_view_state").upsert({
    project_id: projectId,
    card_overrides: next,
    updated_at: new Date().toISOString(),
  });
}

/** Persist the current colorize spec for the viewer. */
export async function setColorizeSpec(projectId: string, spec: ColorizeSpec | null): Promise<void> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb as any).from("user_view_state").upsert({
    project_id: projectId,
    colorize_spec: spec,
    updated_at: new Date().toISOString(),
  });
}

/** Switch the active view for the current viewer. */
export async function switchActiveView(projectId: string, viewId: string | null): Promise<void> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb as any).from("user_view_state").upsert({
    project_id: projectId,
    active_view_id: viewId,
    updated_at: new Date().toISOString(),
  });
}

/** Admin: create or update a saved view. */
export async function upsertSavedView(view: Partial<SavedView> & { project_id: string; name: string }): Promise<SavedView> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any)
    .from("project_saved_views")
    .upsert({
      project_id: view.project_id,
      name: view.name,
      role_gate: view.role_gate ?? "member",
      cards: view.cards ?? [],
      is_default: view.is_default ?? false,
      colorize_spec: view.colorize_spec ?? null,
      description: view.description ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "project_id,name" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as SavedView;
}

/** Admin: vote for a stub card. */
export async function voteForStubCard(cardId: string, projectId: string): Promise<void> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb as any).rpc("vote_for_stub_card", { p_card_id: cardId, p_project_id: projectId });
}
