import { getProjectForUser } from "@/lib/queries/project";
import { createServerSupabase } from "@/lib/supabase/server";
import { StatusesEditor } from "@/components/desktop/statuses-editor";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function SettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const res = await getProjectForUser(projectId);
  if (!res || (res.role !== "owner" && res.role !== "admin")) notFound();

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: statuses } = await (sb.from("project_statuses") as any)
    .select("id, label, color, icon, sort_order, is_default")
    .eq("project_id", projectId)
    .order("sort_order");

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href={`/p/${projectId}/map`} className="text-[12px] text-[oklch(58%_0.014_250)] hover:text-[oklch(78%_0.155_234)]">← Back to map</Link>
      <h1 className="mt-3 font-display text-2xl font-extrabold">Project settings</h1>
      <section className="mt-6 rounded-2xl border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)] p-5">
        <h2 className="font-display text-[15px] font-bold">Statuses</h2>
        <p className="mt-1 text-[12px] text-[oklch(58%_0.014_250)]">
          Statuses are project-specific. The color you choose here is what the map pins use.
        </p>
        <StatusesEditor projectId={projectId} initial={statuses ?? []} />
      </section>
    </main>
  );
}
