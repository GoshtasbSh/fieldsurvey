"use client";

import { useEffect, useState } from "react";
import { Loader2, Layers, Trash2, Upload } from "lucide-react";

type Summary = { total: number; last_upload_at: string | null };

/**
 * Admin upload + clear for parcels (M6).
 * Accepts a GeoJSON FeatureCollection (Polygon/MultiPolygon features).
 * Centroids are computed server-side via insert_parcels_batch.
 */
export function ParcelAdmin({ projectId }: { projectId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/projects/${projectId}/parcels`);
      if (!res.ok) return;
      const body = await res.json();
      setSummary({ total: body.total ?? 0, last_upload_at: body.last_upload_at ?? null });
    } catch {
      /* leave null */
    }
  }
  useEffect(() => {
    load();
  }, [projectId]);

  async function upload(file: File) {
    setUploading(true);
    setMessage(null);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/parcels/upload`, {
        method: "POST",
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
      } else {
        const parts: string[] = [];
        if (body.inserted) parts.push(`${body.inserted} parcels imported`);
        if (body.skipped) parts.push(`${body.skipped} skipped`);
        setMessage(parts.join(" · ") || "Nothing imported.");
        load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function clearAll() {
    if (
      !confirm(
        `Clear ALL ${summary?.total ?? "parcel"} rows? Future universe imports won't snap to centroids. This cannot be undone.`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/projects/${projectId}/parcels`, {
        method: "DELETE",
        headers: { "x-confirm": "yes" },
      });
      if (res.ok) {
        setMessage("Parcels cleared.");
        load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-display text-[14px] font-bold text-[var(--bento-ink-1)]">
          Parcels (snap-to-centroid)
        </h3>
        <p className="mt-0.5 text-[12px] text-[var(--bento-ink-3)]">
          Upload a GeoJSON FeatureCollection of parcel polygons. Centroids are computed automatically.
          Universe imports then snap each address to the matching parcel&apos;s centroid when available.
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bento-panel-inset px-3 py-2">
            <div className="text-[10.5px] uppercase tracking-wider text-[var(--bento-ink-3)]">
              Parcels
            </div>
            <div className="font-display text-[18px] font-bold text-[var(--bento-ink-1)]">
              {summary.total.toLocaleString()}
            </div>
          </div>
          <div className="bento-panel-inset px-3 py-2">
            <div className="text-[10.5px] uppercase tracking-wider text-[var(--bento-ink-3)]">
              Last upload
            </div>
            <div className="text-[12px] font-mono text-[var(--bento-ink-2)]">
              {summary.last_upload_at
                ? new Date(summary.last_upload_at).toLocaleDateString()
                : "—"}
            </div>
          </div>
        </div>
      )}

      <label className="bento-focus flex cursor-pointer items-center gap-2 rounded-[10px] border border-dashed border-[var(--bento-rule)] px-3 py-2 text-[12px] text-[var(--bento-ink-3)] hover:border-[var(--bento-accent)] hover:text-[var(--bento-accent)]">
        {uploading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <Upload className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        {uploading ? "Uploading…" : "Choose GeoJSON file"}
        <Layers className="ml-auto h-3.5 w-3.5 text-[var(--bento-ink-4)]" strokeWidth={1.6} />
        <input
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </label>

      {message && (
        <div
          className="rounded-[10px] px-3 py-2 text-[11.5px]"
          style={{ background: "var(--bento-accent-soft)", color: "var(--bento-accent)" }}
        >
          {message}
        </div>
      )}
      {error && (
        <div className="text-[11.5px]" style={{ color: "var(--bento-danger)" }}>
          {error}
        </div>
      )}

      {summary && summary.total > 0 && (
        <button
          onClick={clearAll}
          className="bento-focus inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[11.5px] font-medium text-[var(--bento-ink-3)] transition hover:bg-[var(--bento-danger-soft)] hover:text-[var(--bento-danger)]"
        >
          <Trash2 className="h-3 w-3" strokeWidth={2} />
          Clear parcels
        </button>
      )}
    </div>
  );
}
