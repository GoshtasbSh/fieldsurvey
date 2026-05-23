import { getProjectForUser } from "@/lib/queries/project";
import { ImportWizard } from "@/components/desktop/import-wizard";
import { notFound } from "next/navigation";

export default async function ImportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const res = await getProjectForUser(projectId);
  if (!res || (res.role !== "owner" && res.role !== "admin")) notFound();
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <a href={`/p/${projectId}/map`} className="text-[12px] text-[oklch(58%_0.014_250)] hover:text-[oklch(78%_0.155_234)]">← Back to map</a>
      <h1 className="mt-3 font-display text-2xl font-extrabold">Import survey responses</h1>
      <p className="mt-1 text-sm text-[oklch(58%_0.014_250)]">
        Drop a Qualtrics or Google Forms CSV. We&apos;ll ask you which column holds the respondent&apos;s home address, then re-geocode every row server-side via the U.S. Census geocoder — never trusting the response&apos;s own lat/lon.
      </p>
      <ImportWizard projectId={projectId} />
    </main>
  );
}
