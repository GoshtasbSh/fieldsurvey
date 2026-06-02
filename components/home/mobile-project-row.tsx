import Link from "next/link";
import { HomeThumb } from "./home-thumb";
import type { HomeCard } from "@/lib/queries/home";

function relTime(iso: string | null): string {
  if (!iso) return "no activity";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function thumbPublicUrl(path: string | null): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/project-thumbs/${path}`;
}

/**
 * Mobile project row — vertical-list version of the desktop ProjectCard.
 * Same data, different proportions: a full-width 16:9 thumb on top, a
 * single-line name + stats strip below. Designed for thumb-reach on a
 * phone (44px tap target, 16px gutter).
 */
export function MobileProjectRow({ card }: { card: HomeCard }) {
  return (
    <Link
      href={`/p/${card.id}`}
      aria-label={`Open project ${card.name}, ${card.point_count} points, last activity ${relTime(card.last_activity_at)}`}
      style={{
        display: "block",
        background: "var(--bento-surface)",
        border: "1px solid var(--bento-rule)",
        borderRadius: "var(--bento-radius-lg)",
        overflow: "hidden",
        textDecoration: "none",
        color: "var(--bento-ink-1)",
        boxShadow: "var(--bento-shadow-sm)",
      }}
    >
      <div style={{ aspectRatio: "16 / 9", overflow: "hidden" }}>
        <HomeThumb
          lat={card.center_lat}
          lon={card.center_lon}
          zoom={Math.min(12, Math.max(9, (card.default_zoom ?? 12) - 2))}
          thumbUrl={thumbPublicUrl(card.thumb_path)}
          locationLabel={card.location_label}
          status={card.status}
        />
      </div>
      <div style={{ padding: "12px 14px 14px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <StatusDot status={card.status} />
          <h3
            style={{
              fontFamily: "var(--font-display, var(--font-sans), sans-serif)",
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: "var(--bento-ink-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              flex: 1,
              minWidth: 0,
            }}
          >
            {card.name}
          </h3>
          {card.role === "admin" ? <RoleTag>Admin</RoleTag> : null}
        </div>
        {card.description ? (
          <p
            style={{
              margin: 0,
              fontSize: 12.5,
              color: "var(--bento-ink-2)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              marginBottom: 10,
            }}
          >
            {card.description}
          </p>
        ) : null}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 18,
            fontSize: 11,
            color: "var(--bento-ink-3)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          <Stat n={card.completed_count} l="done" />
          <Stat n={card.point_count} l="points" />
          <Stat n={relTime(card.last_activity_at)} l="activity" />
        </div>
      </div>
    </Link>
  );
}

function Stat({ n, l }: { n: number | string; l: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span
        style={{
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: 15,
          fontWeight: 700,
          color: "var(--bento-ink-1)",
          letterSpacing: 0,
          textTransform: "none",
        }}
      >
        {n}
      </span>
      <span style={{ fontSize: 10 }}>{l}</span>
    </div>
  );
}

function StatusDot({ status }: { status: HomeCard["status"] }) {
  const color =
    status === "active"
      ? "var(--bento-accent)"
      : status === "setup_incomplete"
        ? "var(--bento-warning, #f59e0b)"
        : "var(--bento-ink-3)";
  return (
    <span
      aria-label={status}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

function RoleTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 9.5,
        fontWeight: 800,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--bento-accent)",
        background: "var(--bento-accent-dim, rgba(56,189,248,.12))",
        padding: "3px 7px",
        borderRadius: 100,
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}
