"use client";

import { useEffect, useState } from "react";
import { Loader2, ChevronRight, MapPin, FileText, Box } from "lucide-react";

/**
 * Phase 5 — point-click inspector. Mirrors Keystone's tabbed popup
 * (static/js/dashboard.js:1591) but renders into the right rail's
 * Inspect tab so long surveys (Qualtrics CSVs can have 150+ columns)
 * have room to breathe.
 */

type Detail = {
  point: null | {
    id: string;
    address: string | null;
    notes: string | null;
    lat: number | null;
    lon: number | null;
    accuracy_m: number | null;
    collected_at: string | null;
    source: string;
    geocode_source: string | null;
    parcel_id: string | null;
    matched_response_id: string | null;
    project_statuses: { label: string; color: string; icon: string | null };
    profiles: { display_name: string | null; email: string | null } | null;
  };
  responses: Array<{
    id: string;
    source: string;
    raw_data: Record<string, unknown>;
    address_used: string | null;
    geocode_source: string | null;
    parcel_id: string | null;
    imported_at: string;
    external_id: string | null;
    match_distance_m: number | null;
    matched_at: string | null;
  }>;
  parcel: null | {
    id: string;
    parcel_apn: string | null;
    address: string | null;
    county: string | null;
    source: string | null;
  };
};

export function FeatureInspector({
  projectId,
  selectedId,
}: {
  projectId: string;
  selectedId: string | null;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId) { setDetail(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    // The selectedId could be a point.id OR a survey_response.id (R1 marker).
    // We try point_id first; if that returns no point AND no responses,
    // we re-query as response_id. Cheap because the server returns 200 with
    // {point: null, responses: []} in either case.
    (async () => {
      try {
        const r1 = await fetch(
          `/api/projects/${projectId}/feature-detail?point_id=${encodeURIComponent(selectedId)}`,
          { cache: "no-store" },
        );
        const j1 = (await r1.json()) as Detail;
        if (!cancelled && (j1.point || j1.responses.length > 0)) {
          setDetail(j1);
          return;
        }
        const r2 = await fetch(
          `/api/projects/${projectId}/feature-detail?response_id=${encodeURIComponent(selectedId)}`,
          { cache: "no-store" },
        );
        const j2 = (await r2.json()) as Detail;
        if (!cancelled) setDetail(j2);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, selectedId]);

  if (!selectedId) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
        <MapPin className="h-7 w-7 text-[var(--bento-ink-3)]" strokeWidth={1.6} />
        <div className="text-[12px] text-[var(--bento-ink-3)]">Click a point on the map to inspect it</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-[oklch(78%_0.155_234)]" />
        <span className="text-[11.5px] text-[var(--bento-ink-3)]">Loading detail…</span>
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-[11.5px] text-[oklch(68%_0.21_25)]">{error}</div>;
  }
  if (!detail) return null;

  const matchStatus = detail.point
    ? (detail.point.matched_response_id ? "M1" : (detail.point.project_statuses.label.toLowerCase() === "completed" ? "F1" : null))
    : (detail.responses.length > 0 ? "R1" : null);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3 space-y-3">
      <Header detail={detail} matchStatus={matchStatus} />

      {detail.point && (
        <Section title="Overview" icon={<MapPin className="h-3.5 w-3.5" />}>
          <Row label="Address">{detail.point.address ?? "—"}</Row>
          <Row label="Status">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: detail.point.project_statuses.color }} />
              {detail.point.project_statuses.label}
            </span>
          </Row>
          {detail.point.notes && <Row label="Notes">{detail.point.notes}</Row>}
          {detail.point.collected_at && (
            <Row label="When">{new Date(detail.point.collected_at).toLocaleString()}</Row>
          )}
          {detail.point.profiles?.display_name && (
            <Row label="Who">{detail.point.profiles.display_name}</Row>
          )}
          {detail.point.lat !== null && detail.point.lon !== null && (
            <Row label="Coords">
              <span className="font-mono">{detail.point.lat.toFixed(5)}, {detail.point.lon.toFixed(5)}</span>
            </Row>
          )}
          {detail.point.source !== "mobile" && (
            <Row label="Source">{detail.point.source}</Row>
          )}
          {detail.point.geocode_source && (
            <Row label="Geocoder">{detail.point.geocode_source}</Row>
          )}
        </Section>
      )}

      {detail.responses.length > 0 && (
        <Section
          title={`Survey response${detail.responses.length === 1 ? "" : "s"} (${detail.responses.length})`}
          icon={<FileText className="h-3.5 w-3.5" />}
          defaultOpen
        >
          <div className="space-y-3">
            {detail.responses.map((r, i) => (
              <ResponseBlock key={r.id} response={r} index={i + 1} totalCount={detail.responses.length} />
            ))}
          </div>
        </Section>
      )}

      {detail.parcel && (
        <Section title="Parcel" icon={<Box className="h-3.5 w-3.5" />}>
          {detail.parcel.parcel_apn && <Row label="APN">{detail.parcel.parcel_apn}</Row>}
          {detail.parcel.address && <Row label="Parcel address">{detail.parcel.address}</Row>}
          {detail.parcel.county && <Row label="County">{detail.parcel.county}</Row>}
          {detail.parcel.source && <Row label="Source">{detail.parcel.source}</Row>}
        </Section>
      )}

      {!detail.point && detail.responses.length === 0 && (
        <div className="p-4 text-[11.5px] text-[var(--bento-ink-3)]">
          No detail available for the selected feature.
        </div>
      )}
    </div>
  );
}

function Header({ detail, matchStatus }: { detail: Detail; matchStatus: string | null }) {
  const headerAddress =
    detail.point?.address
      ?? (detail.responses[0]?.address_used as string | null | undefined)
      ?? "Unknown address";
  return (
    <div className="rounded-lg border border-[var(--bento-rule)] bg-[var(--bento-surface)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="font-display text-[14px] font-bold leading-tight text-[var(--bento-ink-1)]">
          {headerAddress}
        </div>
        {matchStatus && (
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[10px] font-bold"
            style={{
              background: matchStatus === "M1" ? "oklch(96% 0.008 250 / 0.14)"
                : matchStatus === "F1" ? "oklch(86% 0.18 88 / 0.16)"
                : "oklch(72% 0.18 305 / 0.16)",
              color: "var(--bento-ink-1)",
            }}
          >
            {matchStatus}
          </span>
        )}
      </div>
    </div>
  );
}

function Section({
  title, icon, defaultOpen, children,
}: { title: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="rounded-lg border border-[var(--bento-rule)] bg-[var(--bento-surface)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--bento-ink-2)]">
          {icon}
          {title}
        </span>
        <ChevronRight className={`h-3.5 w-3.5 text-[var(--bento-ink-3)] transition ${open ? "rotate-90" : ""}`} strokeWidth={2} />
      </button>
      {open && <div className="border-t border-[var(--bento-rule)] p-3 text-[11.5px]">{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[90px_1fr] gap-2 py-0.5">
      <div className="text-[var(--bento-ink-3)]">{label}</div>
      <div className="text-[var(--bento-ink-1)]">{children}</div>
    </div>
  );
}

function ResponseBlock({ response, index, totalCount }: {
  response: Detail["responses"][number];
  index: number;
  totalCount: number;
}) {
  const fields = Object.entries(response.raw_data ?? {});
  const meaningful = fields.filter(([k, v]) => k && String(v ?? "").trim().length > 0);
  return (
    <div className="rounded-md border border-[var(--bento-rule)] bg-[var(--bento-bg)] p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-[10.5px] text-[var(--bento-ink-3)]">
          {totalCount > 1 ? `Response ${index} of ${totalCount}` : "Response"}
        </div>
        <div className="font-mono text-[10.5px] text-[var(--bento-ink-3)]">
          {new Date(response.imported_at).toLocaleDateString()}
          {response.matched_at && response.match_distance_m !== null && (
            <> · {Math.round(response.match_distance_m)} m</>
          )}
        </div>
      </div>
      <div className="max-h-[380px] overflow-y-auto pr-1">
        {meaningful.length === 0 ? (
          <div className="text-[11px] italic text-[var(--bento-ink-3)]">No populated fields in this response.</div>
        ) : (
          meaningful.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[40%_1fr] gap-2 border-b border-[var(--bento-rule)] py-1 last:border-b-0">
              <div className="break-words text-[11px] text-[var(--bento-ink-3)]">{k}</div>
              <div className="break-words text-[11px] text-[var(--bento-ink-1)]">{String(v)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
