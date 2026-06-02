import Link from "next/link";
import { assertSurfaceAllowed } from "@/lib/mobile/role-gate";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function MobileSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await assertSurfaceAllowed(projectId, "settings");

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: project } = await (sb.from("projects") as any)
    .select("name, description, center_lat, center_lon, default_zoom")
    .eq("id", projectId)
    .single();

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--m-bg)",
        overflowY: "auto",
        padding: "20px 14px 32px",
      }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Settings</h1>
      <p
        style={{
          fontSize: 12.5,
          color: "var(--m-ink-2)",
          marginBottom: 18,
          lineHeight: 1.4,
        }}
      >
        Editing project settings is admin-only and happens on the desktop
        view. This page is a read-only snapshot of what&apos;s configured.
      </p>

      <div
        style={{
          background: "var(--m-card)",
          border: "1px solid var(--m-line)",
          borderRadius: 14,
          padding: 16,
          marginBottom: 18,
        }}
      >
        <Row label="Project name" value={project?.name ?? "—"} />
        <Row label="Description" value={project?.description ?? "No description"} />
        <Row
          label="Center"
          value={
            project
              ? `${(project.center_lat as number).toFixed(5)}, ${(project.center_lon as number).toFixed(5)}`
              : "—"
          }
        />
        <Row label="Default zoom" value={String(project?.default_zoom ?? "—")} last />
      </div>

      <Link
        href={`/p/${projectId}/settings`}
        style={{
          display: "block",
          textAlign: "center",
          padding: "12px 16px",
          background: "var(--m-accent)",
          color: "var(--m-accent-on)",
          borderRadius: 12,
          textDecoration: "none",
          fontSize: 14,
          fontWeight: 800,
        }}
      >
        Edit on desktop →
      </Link>
    </div>
  );
}

function Row({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "10px 0",
        borderBottom: last ? "none" : "1px solid var(--m-line)",
      }}
    >
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 800,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--m-ink-3)",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 14, color: "var(--m-ink)" }}>{value}</span>
    </div>
  );
}
