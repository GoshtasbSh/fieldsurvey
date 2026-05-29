"use client";

import { useEffect, useState } from "react";
import { Loader2, MapPin, ChevronRight, Search, CircleCheckBig } from "lucide-react";

type UniverseRow = {
  id: string;
  address: string;
  lat: number | null;
  lon: number | null;
  status: "not_visited" | "visited" | "skipped";
  external_id: string | null;
};

type Summary = { total: number; visited: number; remaining: number };

type Props = {
  projectId: string;
  /**
   * Called when the user taps a row. Field-shell should center the map on
   * (lat, lon) and open the Add sheet with those coords prefilled. address
   * is passed for breadcrumb display; the form will reverse-geocode on its
   * own once coords are set.
   */
  onPick: (row: { id: string; address: string; lat: number; lon: number }) => void;
};

const PAGE = 50;

/**
 * Universe to-visit list for the mobile field shell (M5).
 *
 * Renders a remaining-addresses queue with search + per-row tap-to-place.
 * Read-only — visits are recorded by the point insert path, which calls
 * markUniverseVisited server-side when canvass_mode is on.
 */
export function ToVisitList({ projectId, onPick }: Props) {
  const [rows, setRows] = useState<UniverseRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [pendRes, visRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/universe?status=not_visited&limit=${PAGE}`),
        fetch(`/api/projects/${projectId}/universe?status=visited&limit=1`),
      ]);
      if (pendRes.ok) {
        const body = await pendRes.json();
        setRows(body.rows ?? []);
        const pending = (body.total as number) ?? 0;
        const visited = visRes.ok ? ((await visRes.json()).total as number) ?? 0 : 0;
        setSummary({ total: pending + visited, visited, remaining: pending });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [projectId]);

  const filtered = (rows ?? []).filter((r) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      r.address.toLowerCase().includes(q) ||
      (r.external_id ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-full flex-col">
      {/* Summary header */}
      <div className="border-b border-[var(--bento-rule)] bg-[var(--bento-surface)] px-3 py-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-[14px] font-bold text-[var(--bento-ink-1)]">
            To-visit
          </h2>
          {summary && (
            <div className="text-[11px] text-[var(--bento-ink-3)]">
              <span className="font-mono font-semibold text-[var(--bento-ink-1)]">
                {summary.remaining.toLocaleString()}
              </span>{" "}
              remaining ·{" "}
              <span className="font-mono">{summary.visited.toLocaleString()}</span>{" "}
              visited
            </div>
          )}
        </div>
        {summary && summary.total > 0 && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bento-surface-3)]">
            <div
              className="h-full transition-all"
              style={{
                width: `${(summary.visited / summary.total) * 100}%`,
                background: "var(--bento-accent)",
              }}
            />
          </div>
        )}
        <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-[var(--bento-rule)] bg-[var(--bento-surface-2)] px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-[var(--bento-ink-3)]" strokeWidth={2} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search address or ID"
            className="w-full bg-transparent text-[12.5px] text-[var(--bento-ink-1)] outline-none placeholder:text-[var(--bento-ink-4)]"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {rows === null && (
          <div className="flex items-center gap-2 px-4 py-6 text-[12px] text-[var(--bento-ink-3)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            Loading universe…
          </div>
        )}
        {rows !== null && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <CircleCheckBig
              className="h-8 w-8 text-[var(--bento-success)]"
              strokeWidth={1.5}
            />
            <div className="font-display text-[14px] font-bold text-[var(--bento-ink-1)]">
              All addresses visited
            </div>
            <div className="text-[11.5px] text-[var(--bento-ink-3)]">
              The canvass universe is complete for this project.
            </div>
          </div>
        )}
        {filtered.map((r) => {
          const hasCoords = r.lat !== null && r.lon !== null;
          return (
            <button
              key={r.id}
              onClick={() => {
                if (!hasCoords) return;
                onPick({ id: r.id, address: r.address, lat: r.lat!, lon: r.lon! });
              }}
              disabled={!hasCoords}
              className="flex w-full items-center gap-3 border-b border-[var(--bento-rule)] px-3 py-3 text-left transition active:bg-[var(--bento-surface-2)] disabled:opacity-50"
            >
              <span
                className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px]"
                style={{
                  background: "var(--bento-accent-soft)",
                  color: "var(--bento-accent)",
                }}
              >
                <MapPin className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-[var(--bento-ink-1)]">
                  {r.address}
                </div>
                <div className="truncate text-[10.5px] text-[var(--bento-ink-3)]">
                  {r.external_id ? `ID ${r.external_id} · ` : ""}
                  {hasCoords ? `${r.lat!.toFixed(5)}, ${r.lon!.toFixed(5)}` : "no coordinates"}
                </div>
              </div>
              <ChevronRight
                className="h-4 w-4 flex-shrink-0 text-[var(--bento-ink-3)]"
                strokeWidth={1.8}
              />
            </button>
          );
        })}
        {loading && rows !== null && (
          <div className="flex items-center justify-center gap-2 px-4 py-3 text-[11px] text-[var(--bento-ink-3)]">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            Refreshing…
          </div>
        )}
      </div>
    </div>
  );
}
