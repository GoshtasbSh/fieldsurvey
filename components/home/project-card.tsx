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

function StatusGlyph({ status }: { status: HomeCard["status"] }) {
  if (status === "active")
    return (
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{
          background: "var(--bento-accent)",
          boxShadow: "0 0 6px var(--bento-accent-glow)",
        }}
        aria-label="Active"
      />
    );
  if (status === "setup_incomplete")
    return (
      <span
        className="inline-block h-2 w-2 rounded-full border"
        style={{ borderColor: "var(--bento-warning)" }}
        aria-label="Setup incomplete"
      />
    );
  return (
    <span
      className="inline-block h-2 w-2 rounded-full border"
      style={{ borderColor: "var(--bento-ink-3)" }}
      aria-label="Archived"
    />
  );
}

export function ProjectCard({ card }: { card: HomeCard }) {
  return (
    <Link
      href={`/p/${card.id}`}
      className="group block overflow-hidden rounded-[var(--bento-radius-lg)] border border-[var(--bento-rule)] bg-[var(--bento-surface)] shadow-[var(--bento-shadow-sm)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[var(--bento-shadow-lg)]"
      aria-label={`Open project ${card.name}, ${card.status}, ${card.completed_count} completed, ${card.point_count} points, last activity ${relTime(card.last_activity_at)}`}
    >
      <div className="aspect-[16/9] overflow-hidden">
        <div className="h-full w-full transition-transform duration-300 group-hover:scale-105">
          <HomeThumb
            lat={card.center_lat}
            lon={card.center_lon}
            zoom={card.default_zoom ?? 13}
            thumbUrl={thumbPublicUrl(card.thumb_path)}
          />
        </div>
      </div>
      <div className="p-4">
        <div className="mb-1 flex items-center gap-2">
          <StatusGlyph status={card.status} />
          <h3 className="font-display text-[15.5px] font-bold leading-tight text-[var(--bento-ink-1)]">
            {card.name}
          </h3>
        </div>
        <p className="mb-3 line-clamp-1 text-[12.5px] text-[var(--bento-ink-2)]">
          {card.description ?? "No description"}
        </p>
        <div className="flex items-end justify-between">
          <div className="flex gap-4">
            <Stat n={card.completed_count} l="completed" />
            <Stat n={card.point_count} l="points" />
            <Stat n={relTime(card.last_activity_at)} l="activity" />
          </div>
          {card.last_actor_name ? (
            <span className="text-[11px] text-[var(--bento-ink-3)]">
              {card.last_actor_name}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function Stat({ n, l }: { n: number | string; l: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[16px] font-semibold leading-none text-[var(--bento-ink-1)]">
        {n}
      </span>
      <span className="bento-label">{l}</span>
    </div>
  );
}

/**
 * Compose the public Supabase Storage URL for a thumbnail path. The
 * `project-thumbs` bucket is public-read so no signed URL is needed.
 * Returns null when no thumb has been generated yet (HomeThumb falls back
 * to live Leaflet in that case).
 */
function thumbPublicUrl(path: string | null): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/project-thumbs/${path}`;
}
