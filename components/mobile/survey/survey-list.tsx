"use client";

import { useMemo, useState } from "react";
import type { ProjectRole } from "@/lib/mobile/role-gate";

export type MobileSurveyRow = {
  id: string;
  point_id: string | null;
  address_used: string | null;
  geocoded_lat: number | null;
  geocoded_lon: number | null;
  match_distance_m: number | null;
  matched_at: string | null;
  imported_at: string;
  external_id: string | null;
  /** Pulled out of raw_data for display; arbitrary subset. */
  preview: { status?: string; respondent?: string; date?: string };
};

type Props = {
  role: ProjectRole;
  responses: MobileSurveyRow[];
};

/**
 * Mobile Survey tab — list of imported survey responses.
 *
 * Admin sees an "edit" affordance on each row (the edit page itself ships
 * in a follow-up; in S5 the affordance routes to the same detail view).
 * Member sees the same list, read-only — no edit chrome.
 */
export function MobileSurveyList({ role, responses }: Props) {
  const [query, setQuery] = useState("");
  const [matchedOnly, setMatchedOnly] = useState(false);

  const filtered = useMemo(() => {
    let xs = responses;
    if (matchedOnly) xs = xs.filter((r) => r.point_id !== null);
    const q = query.trim().toLowerCase();
    if (q) {
      xs = xs.filter(
        (r) =>
          (r.address_used ?? "").toLowerCase().includes(q) ||
          (r.preview.respondent ?? "").toLowerCase().includes(q) ||
          (r.external_id ?? "").toLowerCase().includes(q),
      );
    }
    return xs;
  }, [responses, query, matchedOnly]);

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
          padding: "10px 12px 8px",
          borderBottom: "1px solid var(--m-line)",
          background: "var(--m-bg)",
          position: "sticky",
          top: 0,
          zIndex: 2,
        }}
      >
        <input
          type="search"
          placeholder="Search respondent, address, ID…"
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
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <Toggle
            label={`All · ${responses.length}`}
            on={!matchedOnly}
            onClick={() => setMatchedOnly(false)}
          />
          <Toggle
            label={`Matched · ${responses.filter((r) => r.point_id).length}`}
            on={matchedOnly}
            onClick={() => setMatchedOnly(true)}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0 24px" }}>
        {filtered.length === 0 ? (
          <EmptyState query={query} />
        ) : (
          filtered.map((r) => <Row key={r.id} r={r} role={role} />)
        )}
      </div>
    </div>
  );
}

function Row({ r, role }: { r: MobileSurveyRow; role: ProjectRole }) {
  const matched = r.point_id !== null;
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "12px 14px",
        borderBottom: "1px solid var(--m-line)",
      }}
    >
      <span
        aria-label={matched ? "Matched to a point" : "Unmatched"}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: matched ? "var(--m-success)" : "var(--m-warn)",
          marginTop: 6,
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
          {r.preview.respondent ?? r.address_used ?? r.external_id ?? "Untitled response"}
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
          {r.preview.status ? (
            <span style={{ color: "var(--m-accent)", fontWeight: 700 }}>
              {r.preview.status}
            </span>
          ) : null}
          <span>{relTime(r.matched_at ?? r.imported_at)}</span>
          {r.match_distance_m !== null && r.match_distance_m !== undefined ? (
            <span style={{ color: "var(--m-ink-3)" }}>
              {Math.round(r.match_distance_m)}m
            </span>
          ) : null}
        </div>
      </div>
      {role === "admin" ? (
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--m-accent)",
            alignSelf: "center",
            opacity: 0.7,
          }}
        >
          Edit ›
        </span>
      ) : null}
    </div>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: 100,
        background: on ? "var(--m-accent)" : "var(--m-card)",
        color: on ? "var(--m-accent-on)" : "var(--m-ink)",
        border: on ? "1px solid var(--m-accent)" : "1px solid var(--m-line)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div
      style={{
        padding: 32,
        textAlign: "center",
        color: "var(--m-ink-3)",
        fontSize: 13,
      }}
    >
      {query
        ? "No responses match your search."
        : "No survey responses yet. Imports happen via the desktop dashboard."}
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
