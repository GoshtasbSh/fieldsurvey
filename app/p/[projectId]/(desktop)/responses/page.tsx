import { getProjectForUser } from "@/lib/queries/project";
import { createServerSupabase } from "@/lib/supabase/server";
import { ResponsesTable } from "@/components/desktop/responses-table";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function ResponsesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const res = await getProjectForUser(projectId);
  if (!res) notFound();

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: responses } = await (sb.from("survey_responses") as any)
    .select("id, point_id, source, raw_data, address_used, geocoded_lat, geocoded_lon, match_distance_m, matched_at, imported_at, external_id")
    .eq("project_id", projectId)
    .order("imported_at", { ascending: false })
    .limit(2000);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <Link href={`/p/${projectId}/map`} className="text-[12px] text-[oklch(58%_0.014_250)] hover:text-[oklch(78%_0.155_234)]">← Back to map</Link>
      <h1 className="mt-3 font-display text-2xl font-extrabold">Responses · {responses?.length ?? 0}</h1>
      <p className="mt-1 text-sm text-[oklch(58%_0.014_250)]">Survey responses imported via CSV. Click any row to see the full JSON answer set.</p>
      <ResponsesTable rows={responses ?? []} />
    </main>
  );
}
