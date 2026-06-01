import { getProjectForUser } from "@/lib/queries/project";
import { ImportWizard } from "@/components/desktop/import-wizard";
import { createServerSupabase } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

export default async function ImportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const res = await getProjectForUser(projectId);
  if (!res || (res.role !== "owner" && res.role !== "admin")) notFound();

  // Pre-fill: project's last-used address suffix + address column
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: settings } = await sbAny
    .from("project_settings")
    .select("geocode_address_suffix,response_address_column,external_id_column,response_status_column")
    .eq("project_id", projectId)
    .maybeSingle();

  // How many rows are already stored for this project, per flow. Drives the
  // "Replace existing N rows" copy in the wizard and the count badge on
  // the kind-chooser screen.
  const [{ count: existingResponseRows }, { count: existingFieldCanvassPoints }] = await Promise.all([
    sbAny
      .from("survey_responses")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    sbAny
      .from("points")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("source", "csv_import"),
  ]);

  return (
    // The desktop route group wraps every page in `h-screen overflow-hidden`
    // for the map shell. Content pages like /import must opt back into normal
    // page scroll, otherwise the bottom of the wizard (preview table, commit
    // button) sits below the viewport with no way to reach it.
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <a href={`/p/${projectId}/map`} className="text-[12px] text-[oklch(58%_0.014_250)] hover:text-[oklch(78%_0.155_234)]">← Back to map</a>
        <h1 className="mt-3 font-display text-2xl font-extrabold">Import CSV</h1>
        <p className="mt-1 text-sm text-[oklch(58%_0.014_250)]">
          Pick the kind of CSV — canvassing log or survey responses — and we&apos;ll re-geocode every row via the U.S. Census, snap to the nearest parcel within 50&nbsp;m, then match responses to field points.
        </p>
        <ImportWizard
          projectId={projectId}
          defaultAddressSuffix={settings?.geocode_address_suffix ?? ""}
          defaultAddressColumn={settings?.response_address_column ?? ""}
          defaultExternalIdColumn={settings?.external_id_column ?? ""}
          defaultStatusColumn={settings?.response_status_column ?? ""}
          existingResponseRows={existingResponseRows ?? 0}
          existingFieldCanvassPoints={existingFieldCanvassPoints ?? 0}
        />
      </div>
    </main>
  );
}
