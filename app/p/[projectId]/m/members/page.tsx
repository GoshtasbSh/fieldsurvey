import { assertSurfaceAllowed } from "@/lib/mobile/role-gate";
import { createServerSupabase } from "@/lib/supabase/server";

type Member = {
  user_id: string;
  role: string;
  display_name: string | null;
  email: string | null;
  joined_at: string;
};

export default async function MobileMembersPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await assertSurfaceAllowed(projectId, "members");

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("project_members") as any)
    .select("user_id, role, joined_at, profiles!inner(display_name, email)")
    .eq("project_id", projectId)
    .order("joined_at", { ascending: true });

  const rows: Member[] = (data ?? []).map(
    (m: {
      user_id: string;
      role: string;
      joined_at: string;
      profiles: { display_name: string | null; email: string | null } | null;
    }) => ({
      user_id: m.user_id,
      role: m.role,
      joined_at: m.joined_at,
      display_name: m.profiles?.display_name ?? null,
      email: m.profiles?.email ?? null,
    }),
  );

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
      <h1 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>
        Members · {rows.length}
      </h1>
      <p
        style={{
          fontSize: 12.5,
          color: "var(--m-ink-2)",
          marginBottom: 18,
          lineHeight: 1.4,
        }}
      >
        Invite + role management land in a follow-up. Use the desktop Team
        panel for now if you need to add or remove people.
      </p>

      <div
        style={{
          background: "var(--m-card)",
          border: "1px solid var(--m-line)",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {rows.map((m) => (
          <div
            key={m.user_id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderBottom: "1px solid var(--m-line)",
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background:
                  m.role === "admin"
                    ? "linear-gradient(135deg,#38bdf8,#0ea5e9)"
                    : "linear-gradient(135deg,#10b981,#059669)",
                color: "#0d1117",
                display: "grid",
                placeItems: "center",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              {(m.display_name ?? m.email ?? "?").charAt(0).toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: "var(--m-ink)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {m.display_name ?? m.email ?? "Unnamed"}
              </div>
              <div style={{ fontSize: 11, color: "var(--m-ink-3)" }}>
                {m.email}
              </div>
            </div>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 800,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color:
                  m.role === "admin" ? "var(--m-accent)" : "var(--m-success)",
                background:
                  m.role === "admin"
                    ? "var(--m-accent-dim)"
                    : "rgba(16,185,129,0.12)",
                padding: "4px 8px",
                borderRadius: 100,
              }}
            >
              {m.role}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
