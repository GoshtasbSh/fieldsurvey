import { getProjectForUser } from "@/lib/queries/project";
import { listProjectPoints } from "@/lib/queries/points";
import { PointsTable } from "@/components/desktop/points-table";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function PointsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const res = await getProjectForUser(projectId);
  if (!res) notFound();
  const rows = await listProjectPoints(projectId);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <Link href={`/p/${projectId}/map`} className="text-[12px] text-[oklch(58%_0.014_250)] hover:text-[oklch(78%_0.155_234)]">← Back to map</Link>
      <h1 className="mt-3 font-display text-2xl font-extrabold">Points · {rows.length}</h1>
      <PointsTable projectId={projectId} rows={rows} />
    </main>
  );
}
