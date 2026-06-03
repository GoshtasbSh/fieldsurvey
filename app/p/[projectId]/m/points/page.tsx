import { assertSurfaceAllowed } from "@/lib/mobile/role-gate";
import { createServerSupabase } from "@/lib/supabase/server";
import { MobilePointsList, type MobilePointRow } from "@/components/mobile/points/points-list";

const MOBILE_POINTS_LIMIT = 500;

/**
 * Mobile Points tab — list view of every point in the project with status,
 * address, surveyor, and age. Open to admin + member; guest 404s via the
 * surface gate.
 *
 * Collector names are resolved in a single batch query to avoid the N+1
 * we'd otherwise get if the row component looked them up itself.
 */
export default async function MobilePointsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await assertSurfaceAllowed(projectId, "points");

  type RawRow = {
    id: string;
    status_id: string;
    lat: number;
    lon: number;
    address: string | null;
    notes: string | null;
    collector_id: string | null;
    collected_at: string;
    project_statuses?: { label: string; color: string } | null;
  };

  // Mobile-specific limited query: full project loads are too large to
  // ship over the wire to a phone (Vercel response 4 MB + first-paint).
  // The desktop /points page reads via a different lib path so it isn't
  // affected. Pagination is a follow-up; 500 covers ~95% of projects in
  // practice based on prod telemetry at S5 ship time.
  const sb0 = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawData } = await (sb0.from("points") as any)
    .select(
      "id, status_id, lat, lon, address, notes, collector_id, collected_at, project_statuses!inner(label, color)",
    )
    .eq("project_id", projectId)
    .order("collected_at", { ascending: false })
    .limit(MOBILE_POINTS_LIMIT);
  const raw = (rawData ?? []) as RawRow[];

  // Resolve collector display names in one query
  const collectorIds = Array.from(
    new Set(raw.map((p) => p.collector_id).filter((v): v is string => !!v)),
  );
  const nameMap = new Map<string, string>();
  if (collectorIds.length > 0) {
    const sb = await createServerSupabase();
    // Don't select email — falling back to it would leak collector emails
    // to member-role viewers. Use display_name only and default to a
    // generic label when it's missing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profiles } = await (sb.from("profiles") as any)
      .select("id, display_name")
      .in("id", collectorIds);
    for (const row of (profiles ?? []) as Array<{ id: string; display_name: string | null }>) {
      nameMap.set(row.id, row.display_name ?? "Surveyor");
    }
  }

  const points: MobilePointRow[] = raw.map((p) => ({
    id: p.id,
    status_id: p.status_id,
    lat: p.lat,
    lon: p.lon,
    address: p.address,
    notes: p.notes,
    collected_at: p.collected_at,
    collector_name: p.collector_id ? nameMap.get(p.collector_id) ?? null : null,
    project_statuses: p.project_statuses
      ? { label: p.project_statuses.label, color: p.project_statuses.color }
      : null,
  }));

  return <MobilePointsList points={points} />;
}
