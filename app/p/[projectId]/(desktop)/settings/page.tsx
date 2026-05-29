import { getProjectForUser } from "@/lib/queries/project";
import { createServerSupabase } from "@/lib/supabase/server";
import { StatusesEditor } from "@/components/desktop/statuses-editor";
import { VisibilityToggle } from "@/components/desktop/visibility-toggle";
import { RecipientsAdmin } from "@/components/desktop/recipients-admin";
import { GuestCodesAdmin } from "@/components/desktop/guest-codes-admin";
import { UniverseUploader } from "@/components/desktop/universe-uploader";
import { BoundaryAdmin } from "@/components/desktop/boundary-admin";
import { ParcelAdmin } from "@/components/desktop/parcel-admin";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const res = await getProjectForUser(projectId);
  if (!res || (res.role !== "owner" && res.role !== "admin")) notFound();

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: statuses } = await sbAny
    .from("project_statuses")
    .select("id, label, color, icon, sort_order, is_default")
    .eq("project_id", projectId)
    .order("sort_order");
  const { data: settings } = await sbAny
    .from("project_settings")
    .select("canvass_mode")
    .eq("project_id", projectId)
    .maybeSingle();
  const canvassMode = Boolean((settings as { canvass_mode: boolean } | null)?.canvass_mode);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <Link
        href={`/p/${projectId}/map`}
        className="text-[12px] text-[var(--bento-ink-3)] transition hover:text-[var(--bento-accent)]"
      >
        ← Back to map
      </Link>
      <h1 className="font-display text-2xl font-extrabold text-[var(--bento-ink-1)]">
        Project settings
      </h1>

      <section className="bento-panel p-5">
        <h2 className="font-display text-[15px] font-bold text-[var(--bento-ink-1)]">
          Statuses
        </h2>
        <p className="mt-1 text-[12px] text-[var(--bento-ink-3)]">
          Statuses are project-specific. The color you choose here is what the map pins use.
        </p>
        <StatusesEditor projectId={projectId} initial={statuses ?? []} />
      </section>

      <section className="bento-panel p-5">
        <h2 className="font-display text-[15px] font-bold text-[var(--bento-ink-1)]">
          Visibility
        </h2>
        <p className="mt-1 text-[12px] text-[var(--bento-ink-3)]">
          Make this project read-only public so anyone with the URL can view the map, status counts, and pins. Chat and PII never leave the team.
        </p>
        <VisibilityToggle
          projectId={projectId}
          initial={res.project.visibility as "private" | "public_read"}
          projectName={res.project.name}
        />
      </section>

      <section className="bento-panel p-5">
        <RecipientsAdmin projectId={projectId} />
      </section>

      <section className="bento-panel p-5">
        <GuestCodesAdmin projectId={projectId} />
      </section>

      <section className="bento-panel p-5">
        <UniverseUploader projectId={projectId} initialCanvassMode={canvassMode} />
      </section>

      <section className="bento-panel p-5">
        <BoundaryAdmin projectId={projectId} />
      </section>

      <section className="bento-panel p-5">
        <ParcelAdmin projectId={projectId} />
      </section>
    </main>
  );
}
