import Link from "next/link";
import { assertSurfaceAllowed } from "@/lib/mobile/role-gate";
import { Icon } from "@/components/mobile/icons/icons";

export default async function MobileImportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await assertSurfaceAllowed(projectId, "import");

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--m-bg)",
        overflowY: "auto",
        padding: "32px 14px",
        display: "grid",
        placeItems: "center",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 320 }}>
        <span
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "var(--m-accent-dim)",
            color: "var(--m-accent)",
            marginBottom: 12,
          }}
        >
          <Icon name="import" />
        </span>
        <h1 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
          Import survey data
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "var(--m-ink-2)",
            lineHeight: 1.5,
            marginBottom: 18,
          }}
        >
          CSV imports go through a multi-step wizard that needs a wider
          screen for the column-matching grid. Open this project on
          desktop to upload survey data.
        </p>
        <Link
          href={`/p/${projectId}/import`}
          style={{
            display: "inline-block",
            padding: "12px 20px",
            background: "var(--m-accent)",
            color: "var(--m-accent-on)",
            borderRadius: 12,
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 800,
          }}
        >
          Continue on desktop →
        </Link>
      </div>
    </div>
  );
}
