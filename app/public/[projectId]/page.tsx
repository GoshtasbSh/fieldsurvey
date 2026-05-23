import { createServerSupabase } from "@/lib/supabase/server";
import { getStatusBreakdown, getMatchStatusCounts, getMatchStatusFeatures } from "@/lib/queries/points";
import { PublicMap } from "@/components/public/public-map";
import { notFound } from "next/navigation";
import Link from "next/link";

/**
 * Read-only public project view. Accessible to anonymous visitors when
 * the project's visibility = 'public_read'. Shows the map + match-status
 * counts only — no Chat, no Members, no point inspector with PII.
 */
export default async function PublicProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: project } = await (sb.from("projects") as any)
    .select("id, name, description, center_lat, center_lon, default_zoom, visibility")
    .eq("id", projectId)
    .maybeSingle() as { data: { id: string; name: string; description: string | null; center_lat: number; center_lon: number; default_zoom: number; visibility: string } | null };
  if (!project || project.visibility !== "public_read") notFound();

  const [statuses, matchCounts, features] = await Promise.all([
    getStatusBreakdown(projectId),
    getMatchStatusCounts(projectId),
    getMatchStatusFeatures(projectId),
  ]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[oklch(14%_0.012_250)] text-[oklch(96%_0.008_250)]">
      <header className="flex h-12 items-center justify-between border-b border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)] px-4">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 rounded-[5px] bg-[oklch(78%_0.155_234)] shadow-[0_0_12px_oklch(78%_0.155_234/0.35)]" />
          <h1 className="font-display text-[14px] font-extrabold">{project.name}</h1>
          <span className="rounded-full bg-[oklch(76%_0.16_158/0.14)] px-2 py-0.5 font-mono text-[10px] font-bold text-[oklch(76%_0.16_158)]">PUBLIC</span>
        </div>
        <Link href="/" className="text-[11px] text-[oklch(58%_0.014_250)] hover:text-[oklch(78%_0.155_234)]">FieldSurvey →</Link>
      </header>
      <PublicMap
        projectName={project.name}
        center={{ lat: project.center_lat, lon: project.center_lon, zoom: project.default_zoom ?? 14 }}
        statuses={statuses.map((s) => ({ id: s.id, label: s.label, color: s.color, count: s.count, pct: s.pct }))}
        matchCounts={{ m1_count: matchCounts.m1_count ?? 0, f1_count: matchCounts.f1_count ?? 0, r1_count: matchCounts.r1_count ?? 0, total_with_status: matchCounts.total_with_status ?? 0 }}
        features={features}
      />
    </div>
  );
}
