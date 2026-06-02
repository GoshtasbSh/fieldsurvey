"use client";

import { useMemo, useState } from "react";

type StatusRef = { label?: string; color?: string };

export type MobilePointRow = {
  id: string;
  status_id: string;
  lat: number;
  lon: number;
  address: string | null;
  notes: string | null;
  collected_at: string;
  collector_name?: string | null;
  project_statuses?: StatusRef | null;
};

type Props = {
  points: MobilePointRow[];
};

/**
 * Mobile Points tab — searchable, status-filterable scrollable list.
 *
 * Not virtualized in S5 (lists up to a few thousand rows render fine on a
 * mid-range phone). If we hit perf issues with very large projects, swap
 * in @tanstack/react-virtual without changing the row API.
 */
export function MobilePointsList({ points }: Props) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const statuses = useMemo(() => {
    const m = new Map<string, { label: string; color: string }>();
    for (const p of points) {
      const label = p.project_statuses?.label ?? "Unlabeled";
      const color = p.project_statuses?.color ?? "#94a3b8";
      if (!m.has(label)) m.set(label, { label, color });
    }
    return Array.from(m.values());
  }, [points]);

  const filtered = useMemo(() => {
    let xs = points;
    if (statusFilter) xs = xs.filter((p) => (p.project_statuses?.label ?? "Unlabeled") === statusFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      xs = xs.filter(
        (p) =>
          (p.address ?? "").toLowerCase().includes(q) ||
          (p.notes ?? "").toLowerCase().includes(q) ||
          (p.collector_name ?? "").toLowerCase().includes(q),
      );
    }
    return xs;
  }, [points, query, statusFilter]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--m-bg)",
      }}
    >
      <div
        style={{
          padding: "10px 12px 6px",
          borderBottom: "1px solid var(--m-line)",
          background: "var(--m-bg)",
          position: "sticky",
          top: 0,
          zIndex: 2,
        }}
      >
        <input
          type="search"
          placeholder="Search address, notes, surveyor…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "var(--m-card)",
            border: "1px solid var(--m-line)",
            borderRadius: 10,
            color: "var(--m-ink)",
            fontSize: 14,
            outline: "none",
          }}
        />
        <div
          style={{
            display: "flex",
            gap: 6,
            overflowX: "auto",
            marginTop: 10,
            paddingBottom: 4,
          }}
          className="m-no-scrollbar"
        >
          <FilterChip
            label="All"
            count={points.length}
            active={statusFilter === null}
            onClick={() => setStatusFilter(null)}
          />
          {statuses.map((s) => (
            <FilterChip
              key={s.label}
              label={s.label}
              color={s.color}
              count={points.filter((p) => (p.project_statuses?.label ?? "Unlabeled") === s.label).length}
              active={statusFilter === s.label}
              onClick={() => setStatusFilter(s.label)}
            />
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0 24px" }}>
        {filtered.length === 0 ? (
          <EmptyState query={query} hasFilter={!!statusFilter} />
        ) : (
          filtered.map((p) => <Row key={p.id} p={p} />)
        )}
      </div>
    </div>
  );
}

function Row({ p }: { p: MobilePointRow }) {
  const label = p.project_statuses?.label ?? "Unlabeled";
  const color = p.project_statuses?.color ?? "#94a3b8";
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "12px 14px",
        borderBottom: "1px solid var(--m-line)",
        minHeight: "var(--m-touch-min)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: color,
          marginTop: 5,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: "var(--m-ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {p.address ?? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`}
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "baseline",
            fontSize: 11,
            color: "var(--m-ink-2)",
            marginTop: 2,
          }}
        >
          <span style={{ color: "var(--m-accent)", fontWeight: 700 }}>{label}</span>
          <span>·</span>
          <span>{relTime(p.collected_at)}</span>
          {p.collector_name ? (
            <>
              <span>·</span>
              <span style={{ color: "var(--m-ink-3)" }}>{p.collector_name}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  count,
  color,
  active,
  onClick,
}: {
  label: string;
  count: number;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 11px",
        borderRadius: 100,
        background: active ? "var(--m-accent)" : "var(--m-card)",
        color: active ? "var(--m-accent-on)" : "var(--m-ink)",
        border: active ? "1px solid var(--m-accent)" : "1px solid var(--m-line)",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {color && !active ? (
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
      ) : null}
      {label}
      <span style={{ opacity: 0.7, fontFamily: "ui-monospace, Menlo, monospace" }}>{count}</span>
    </button>
  );
}

function EmptyState({ query, hasFilter }: { query: string; hasFilter: boolean }) {
  return (
    <div
      style={{
        padding: 32,
        textAlign: "center",
        color: "var(--m-ink-3)",
        fontSize: 13,
      }}
    >
      {query || hasFilter
        ? "No points match the current filter."
        : "No points yet. Tap the + button on the map to add one."}
    </div>
  );
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}
