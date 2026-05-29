"use client";

import { useEffect, useState } from "react";
import { Loader2, Map as MapIcon, Trash2, Upload } from "lucide-react";

type Boundary = {
  id: string;
  name: string | null;
  geojson: GeoJSON.Geometry;
  created_at: string;
};

/**
 * Admin upload + revoke for project boundary polygons (M6).
 * Accepts a GeoJSON file (Polygon, MultiPolygon, Feature, or FeatureCollection).
 * Server normalizes to MultiPolygon via the insert_project_boundary RPC.
 */
export function BoundaryAdmin({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Boundary[] | null>(null);
  const [name, setName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/projects/${projectId}/boundaries`);
      if (!res.ok) return;
      const body = await res.json();
      setRows(body.boundaries ?? []);
    } catch {
      /* leave null on failure */
    }
  }
  useEffect(() => {
    load();
  }, [projectId]);

  async function onUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const text = await file.text();
      let geojson: unknown;
      try {
        geojson = JSON.parse(text);
      } catch {
        setError("File is not valid JSON");
        return;
      }
      const res = await fetch(`/api/projects/${projectId}/boundaries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || null, geojson }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
      } else {
        setName("");
        load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function remove(b: Boundary) {
    if (!confirm(`Remove boundary "${b.name ?? "(unnamed)"}"?`)) return;
    setRows((prev) => (prev ?? []).filter((x) => x.id !== b.id));
    try {
      await fetch(`/api/projects/${projectId}/boundaries/${b.id}`, { method: "DELETE" });
    } catch {
      load();
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-display text-[14px] font-bold text-[var(--bento-ink-1)]">
          Project boundary
        </h3>
        <p className="mt-0.5 text-[12px] text-[var(--bento-ink-3)]">
          Upload a GeoJSON polygon to define the canvass area. Use{" "}
          <a
            href="https://geojson.io"
            target="_blank"
            rel="noopener"
            className="underline decoration-[var(--bento-rule)] underline-offset-4 hover:text-[var(--bento-accent)]"
          >
            geojson.io
          </a>{" "}
          to draw one in your browser, then export.
        </p>
      </div>

      <div className="space-y-2">
        {rows === null && (
          <div className="bento-panel-inset flex items-center gap-2 px-3 py-2 text-[11.5px] text-[var(--bento-ink-3)]">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            Loading…
          </div>
        )}
        {rows !== null && rows.length === 0 && (
          <div className="bento-panel-inset px-3 py-3 text-[12px] text-[var(--bento-ink-3)]">
            No boundary yet. Upload one below.
          </div>
        )}
        {(rows ?? []).map((b) => {
          const vertexCount = countVertices(b.geojson);
          return (
            <div key={b.id} className="bento-panel flex items-center gap-3 p-3">
              <span
                className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px]"
                style={{ background: "var(--bento-accent-soft)", color: "var(--bento-accent)" }}
              >
                <MapIcon className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
              <div className="flex-1">
                <div className="text-[12.5px] font-semibold text-[var(--bento-ink-1)]">
                  {b.name || "(unnamed)"}
                </div>
                <div className="text-[10.5px] text-[var(--bento-ink-3)]">
                  {vertexCount.toLocaleString()} vertices · uploaded{" "}
                  {new Date(b.created_at).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => remove(b)}
                className="bento-focus inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--bento-ink-3)] hover:bg-[var(--bento-danger-soft)] hover:text-[var(--bento-danger)]"
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="bento-panel space-y-2 p-3">
        <input
          type="text"
          placeholder="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="w-full rounded-[10px] border border-[var(--bento-rule)] bg-[var(--bento-surface)] px-3 py-2 text-[12px] text-[var(--bento-ink-1)] outline-none focus:border-[var(--bento-accent)]"
        />
        <label className="bento-focus flex cursor-pointer items-center gap-2 rounded-[10px] border border-dashed border-[var(--bento-rule)] px-3 py-2 text-[12px] text-[var(--bento-ink-3)] hover:border-[var(--bento-accent)] hover:text-[var(--bento-accent)]">
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <Upload className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          {uploading ? "Uploading…" : "Choose GeoJSON file"}
          <input
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
        </label>
        {error && (
          <div className="text-[11px]" style={{ color: "var(--bento-danger)" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function countVertices(g: GeoJSON.Geometry): number {
  if (g.type === "Polygon") {
    return g.coordinates.reduce((n, ring) => n + ring.length, 0);
  }
  if (g.type === "MultiPolygon") {
    return g.coordinates.reduce(
      (n, poly) => n + poly.reduce((m, ring) => m + ring.length, 0),
      0,
    );
  }
  return 0;
}
