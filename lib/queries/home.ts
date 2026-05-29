/**
 * Home page query — one shape per project card with role, stats, and a
 * draft heuristic. Used by `/home` (manage surveys).
 *
 * The draft heuristic is locked in the front-of-house spec:
 * `point_count = 0 AND completed_count = 0 AND created < 7 days ago`.
 */

import { createServerSupabase } from "@/lib/supabase/server";

export type HomeCard = {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  center_lat: number;
  center_lon: number;
  default_zoom: number;
  visibility: "private" | "public_read";
  archived: boolean;
  created_at: string;
  role: string;
  completed_count: number;
  point_count: number;
  last_activity_at: string | null;
  last_actor_name: string | null;
  status: "active" | "setup_incomplete" | "archived";
  /** Server-rendered static thumb (M8). When null, /home falls back to live Leaflet. */
  thumb_path: string | null;
};

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  center_lat: number;
  center_lon: number;
  default_zoom: number;
  visibility: string;
  archived: boolean;
  created_at: string;
  thumb_path: string | null;
  project_members: Array<{ role: string }>;
};

type PointRow = {
  project_id: string;
  updated_at: string;
  collector_id: string | null;
};

type ResponseRow = {
  project_id: string;
  raw_data: { status?: string } | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  email: string;
};

export async function listHomeCards(): Promise<{
  owned: HomeCard[];
  shared: HomeCard[];
  drafts: HomeCard[];
}> {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { owned: [], shared: [], drafts: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;

  // 1. Projects + role (RLS already filters to memberships)
  const { data: projRaw } = await sbAny
    .from("projects")
    .select(
      "id, name, description, owner_id, center_lat, center_lon, default_zoom, visibility, archived, created_at, thumb_path, project_members!inner(role)",
    )
    .eq("archived", false)
    .order("updated_at", { ascending: false });

  const rows: ProjectRow[] = (projRaw ?? []) as ProjectRow[];
  if (rows.length === 0) return { owned: [], shared: [], drafts: [] };

  const ids = rows.map((r) => r.id);

  // 2. Parallel bulk loads: responses + points (for stats), profiles (for last-actor name)
  const [respRes, pointRes, profileRes] = await Promise.all([
    sbAny
      .from("survey_responses")
      .select("project_id, raw_data")
      .in("project_id", ids),
    sbAny
      .from("points")
      .select("project_id, updated_at, collector_id")
      .in("project_id", ids)
      .order("updated_at", { ascending: false }),
    sbAny.from("profiles").select("id, display_name, email"),
  ]);

  const responses: ResponseRow[] = (respRes.data ?? []) as ResponseRow[];
  const points: PointRow[] = (pointRes.data ?? []) as PointRow[];
  const profiles = new Map<string, ProfileRow>(
    ((profileRes.data ?? []) as ProfileRow[]).map((p) => [p.id, p]),
  );

  // 3. Aggregate per project
  const cards: HomeCard[] = rows.map((r) => {
    const myPoints = points.filter((p) => p.project_id === r.id);
    const myResponses = responses.filter((x) => x.project_id === r.id);
    const completedCount = myResponses.filter(
      (x) => x.raw_data?.status === "Completed",
    ).length;
    const pointCount = myPoints.length;
    const latestPoint = myPoints[0]; // points was ordered desc by updated_at
    const lastActorId = latestPoint?.collector_id ?? null;
    const lastActorName =
      lastActorId && profiles.has(lastActorId)
        ? profiles.get(lastActorId)?.display_name ??
          profiles.get(lastActorId)?.email ??
          null
        : null;
    const ageDays =
      (Date.now() - new Date(r.created_at).getTime()) / 86_400_000;
    const status: HomeCard["status"] = r.archived
      ? "archived"
      : pointCount === 0 && completedCount === 0 && ageDays < 7
        ? "setup_incomplete"
        : "active";
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      owner_id: r.owner_id,
      center_lat: r.center_lat,
      center_lon: r.center_lon,
      default_zoom: r.default_zoom,
      visibility: r.visibility as "private" | "public_read",
      archived: r.archived,
      created_at: r.created_at,
      role: r.project_members[0]?.role ?? "viewer",
      completed_count: completedCount,
      point_count: pointCount,
      last_activity_at: latestPoint?.updated_at ?? null,
      last_actor_name: lastActorName,
      status,
      thumb_path: r.thumb_path,
    };
  });

  return {
    owned: cards.filter(
      (c) => c.owner_id === user.id && c.status === "active",
    ),
    shared: cards.filter(
      (c) => c.owner_id !== user.id && c.status === "active",
    ),
    drafts: cards.filter((c) => c.status === "setup_incomplete"),
  };
}
