import Link from "next/link";
import { Icon, type IconKey } from "@/components/mobile/icons/icons";

type Tile = {
  href: string;
  label: string;
  description: string;
  icon: IconKey;
};

type Props = {
  projectId: string;
};

/**
 * Admin "More" sheet — bento grid of 2×3 tiles linking to admin surfaces.
 * Server component: pure links, no client state.
 */
export function MobileMoreGrid({ projectId }: Props) {
  const tiles: Tile[] = [
    {
      href: `/p/${projectId}/m/members`,
      label: "Members",
      description: "Roles, invites, presence",
      icon: "members",
    },
    {
      href: `/p/${projectId}/m/settings`,
      label: "Settings",
      description: "Project name, basemap, statuses",
      icon: "settings",
    },
    {
      href: `/p/${projectId}/m/import`,
      label: "Import",
      description: "Bring in survey CSVs",
      icon: "import",
    },
    {
      href: `/p/${projectId}/m/analysis`,
      label: "Analysis",
      description: "KPIs and trends",
      icon: "analysis",
    },
    {
      href: `/p/${projectId}/m/reports`,
      label: "Reports",
      description: "Guest reports + recipients",
      icon: "reports",
    },
    {
      href: `/p/${projectId}/map`,
      label: "Open desktop",
      description: "Switch to the full dashboard",
      icon: "install",
    },
  ];

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
      <h1 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Admin tools</h1>
      <p
        style={{
          fontSize: 12.5,
          color: "var(--m-ink-2)",
          marginBottom: 18,
          lineHeight: 1.4,
        }}
      >
        Everything that isn&apos;t on the main tab bar. Tap any tile.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}
      >
        {tiles.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "14px 14px 16px",
              background: "var(--m-card)",
              border: "1px solid var(--m-line)",
              borderRadius: 14,
              textDecoration: "none",
              color: "var(--m-ink)",
              minHeight: 110,
            }}
          >
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "var(--m-accent-dim)",
                color: "var(--m-accent)",
                display: "grid",
                placeItems: "center",
                marginBottom: 10,
              }}
            >
              <Icon name={t.icon} />
            </span>
            <span style={{ fontSize: 14, fontWeight: 800 }}>{t.label}</span>
            <span
              style={{
                fontSize: 11,
                color: "var(--m-ink-2)",
                marginTop: 2,
                lineHeight: 1.4,
              }}
            >
              {t.description}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
