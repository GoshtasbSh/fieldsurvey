import { assertSurfaceAllowed } from "@/lib/mobile/role-gate";
import { createServerSupabase } from "@/lib/supabase/server";

type Report = {
  id: string;
  guest_name: string | null;
  title: string;
  body: string;
  status: string;
  created_at: string;
  lat: number | null;
  lon: number | null;
  photo_path: string | null;
};

export default async function MobileReportsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await assertSurfaceAllowed(projectId, "reports");

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await ((sb as any).from("guest_reports"))
    .select("id, guest_name, title, body, status, created_at, lat, lon, photo_path")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(200) as { data: Report[] | null };

  const reports = data ?? [];
  const newCount = reports.filter((r) => r.status === "new").length;

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
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 800 }}>Guest reports</h1>
        {newCount > 0 ? (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              padding: "3px 8px",
              borderRadius: 100,
              background: "var(--m-danger)",
              color: "#fff",
            }}
          >
            {newCount} new
          </span>
        ) : null}
      </div>
      <p
        style={{
          fontSize: 12.5,
          color: "var(--m-ink-2)",
          marginBottom: 16,
          lineHeight: 1.4,
        }}
      >
        Reports sent by surveyors using guest mode. Mark as reviewed once
        you&apos;ve actioned them.
      </p>

      {reports.length === 0 ? (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            color: "var(--m-ink-3)",
            fontSize: 13,
          }}
        >
          No guest reports yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {reports.map((r) => (
            <div
              key={r.id}
              style={{
                background: "var(--m-card)",
                border: "1px solid var(--m-line)",
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: "var(--m-ink)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.title}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--m-ink-3)", marginTop: 1 }}>
                    {(r.guest_name ?? "Guest")}
                    {" · "}
                    <time dateTime={r.created_at} suppressHydrationWarning>
                      {relTime(r.created_at)}
                    </time>
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: "var(--m-ink-2)",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: "vertical" as const,
                }}
              >
                {r.body}
              </p>
              {r.lat !== null && r.lon !== null ? (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: "var(--m-ink-3)",
                    fontFamily: "ui-monospace, Menlo, monospace",
                  }}
                >
                  📍 {r.lat.toFixed(5)}, {r.lon.toFixed(5)}
                </div>
              ) : null}
              {r.photo_path ? (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: "var(--m-accent)",
                    fontWeight: 700,
                  }}
                >
                  📎 Photo attached (open on desktop to view)
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "new"
      ? "var(--m-warn)"
      : status === "reviewed"
        ? "var(--m-info)"
        : "var(--m-success)";
  return (
    <span
      style={{
        fontSize: 9.5,
        fontWeight: 800,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color,
        background: "transparent",
        border: `1px solid ${color}`,
        padding: "2px 8px",
        borderRadius: 100,
        flexShrink: 0,
      }}
    >
      {status}
    </span>
  );
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
