import { assertSurfaceAllowed } from "../layout";

/**
 * S2 placeholder for the mobile Map tab. The real map (MapLibre + pins +
 * stat strip + filter sheet + FAB hookup) lands in S4. This page exists so
 * the (mobile) shell can be exercised end-to-end and the bottom-tab
 * highlight is verifiable.
 */
export default async function MapPagePlaceholder({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await assertSurfaceAllowed(projectId, "map");

  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(circle at 30% 40%, rgba(56,189,248,0.12) 0, transparent 50%), " +
          "radial-gradient(circle at 70% 70%, rgba(16,185,129,0.10) 0, transparent 50%), " +
          "var(--m-bg)",
        color: "var(--m-ink-2)",
        fontSize: 13,
        textAlign: "center",
        padding: 24,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--m-accent)",
            marginBottom: 6,
          }}
        >
          Map · Placeholder
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--m-ink)" }}>
          MapLibre lands in section 4
        </div>
        <div style={{ marginTop: 8, maxWidth: 280, lineHeight: 1.5 }}>
          The mobile shell, tab bar, role gate, and theme are wired up — the
          interactive map (pins, FAB, basemap sheet, filter chips) is the
          next implementation step.
        </div>
      </div>
    </div>
  );
}
