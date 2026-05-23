"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, Download, Map as MapIcon } from "lucide-react";

type Row = {
  id: string;
  lat: number;
  lon: number;
  address: string | null;
  notes: string | null;
  accuracy_m: number | null;
  collected_at: string;
  matched_response_id: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  project_statuses: any;
};

type SortKey = "collected_at" | "address" | "status" | "matched";

export function PointsTable({ projectId, rows }: { projectId: string; rows: Row[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("collected_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (r.address ?? "").toLowerCase().includes(q) || (r.notes ?? "").toLowerCase().includes(q);
    });
    const out = [...filtered];
    out.sort((a, b) => {
      let av: string | number = 0, bv: string | number = 0;
      if (sortKey === "collected_at") { av = a.collected_at; bv = b.collected_at; }
      else if (sortKey === "address") { av = a.address ?? ""; bv = b.address ?? ""; }
      else if (sortKey === "status") { av = a.project_statuses?.label ?? ""; bv = b.project_statuses?.label ?? ""; }
      else if (sortKey === "matched") { av = a.matched_response_id ? 1 : 0; bv = b.matched_response_id ? 1 : 0; }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [rows, query, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  }

  function exportCsv() {
    const cols = ["id", "address", "lat", "lon", "accuracy_m", "status", "matched", "collected_at", "notes"];
    const lines = [cols.join(",")];
    for (const r of sorted) {
      const cells = [
        r.id,
        csv(r.address),
        r.lat, r.lon,
        r.accuracy_m ?? "",
        csv(r.project_statuses?.label),
        r.matched_response_id ? "M1" : "F1",
        r.collected_at,
        csv(r.notes),
      ];
      lines.push(cells.join(","));
    }
    download(lines.join("\n"), `points-${projectId}.csv`, "text/csv");
  }

  function exportGeoJSON() {
    const fc = {
      type: "FeatureCollection",
      features: sorted.map((r) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lon, r.lat] },
        properties: {
          id: r.id,
          address: r.address,
          status: r.project_statuses?.label,
          matched: !!r.matched_response_id,
          collected_at: r.collected_at,
          accuracy_m: r.accuracy_m,
          notes: r.notes,
        },
      })),
    };
    download(JSON.stringify(fc, null, 2), `points-${projectId}.geojson`, "application/geo+json");
  }

  return (
    <div className="mt-5 rounded-2xl border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)]">
      <div className="flex items-center gap-3 border-b border-[oklch(28%_0.02_250/0.55)] p-3">
        <input
          placeholder="Search address or notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 max-w-md rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] px-3 py-2 text-[12px] outline-none focus:border-[oklch(78%_0.155_234/0.5)]"
        />
        <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] px-3 py-2 font-display text-[11px] font-bold text-[oklch(76%_0.012_250)] hover:bg-[oklch(24%_0.018_250)]">
          <Download className="h-3.5 w-3.5" strokeWidth={1.7} /> CSV
        </button>
        <button onClick={exportGeoJSON} className="inline-flex items-center gap-1.5 rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] px-3 py-2 font-display text-[11px] font-bold text-[oklch(76%_0.012_250)] hover:bg-[oklch(24%_0.018_250)]">
          <MapIcon className="h-3.5 w-3.5" strokeWidth={1.7} /> GeoJSON
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-[oklch(20%_0.016_250)] text-[oklch(58%_0.014_250)]">
            <tr>
              <Th label="Status"        onClick={() => toggleSort("status")} active={sortKey === "status"} dir={sortDir} />
              <Th label="Address"       onClick={() => toggleSort("address")} active={sortKey === "address"} dir={sortDir} />
              <th className="px-3 py-2 text-left">Lat/Lon</th>
              <Th label="Match"         onClick={() => toggleSort("matched")} active={sortKey === "matched"} dir={sortDir} />
              <Th label="Collected"     onClick={() => toggleSort("collected_at")} active={sortKey === "collected_at"} dir={sortDir} />
              <th className="px-3 py-2 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-t border-[oklch(28%_0.02_250/0.55)] hover:bg-[oklch(20%_0.016_250)]">
                <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: r.project_statuses?.color }} />{r.project_statuses?.label}</span></td>
                <td className="px-3 py-2">{r.address ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-[11px] tabular-nums">{r.lat.toFixed(5)}, {r.lon.toFixed(5)}</td>
                <td className="px-3 py-2">
                  {r.matched_response_id ? (
                    <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ring-1 ring-white text-[oklch(96%_0.008_250)]">M1</span>
                  ) : (
                    <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ring-2 ring-[#fde047] text-[oklch(82%_0.17_86)]">F1</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-[oklch(58%_0.014_250)]">{new Date(r.collected_at).toLocaleString()}</td>
                <td className="px-3 py-2 max-w-[300px] truncate text-[oklch(76%_0.012_250)]">{r.notes ?? ""}</td>
              </tr>
            ))}
            {!sorted.length && (
              <tr><td colSpan={6} className="px-3 py-12 text-center text-[oklch(58%_0.014_250)]">No points {query ? "match your search" : "yet"}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ label, onClick, active, dir }: { label: string; onClick: () => void; active: boolean; dir: "asc" | "desc" }) {
  return (
    <th className="px-3 py-2 text-left">
      <button onClick={onClick} className={`inline-flex items-center gap-1 ${active ? "text-[oklch(78%_0.155_234)]" : ""}`}>
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? "" : "opacity-50"}`} strokeWidth={1.7} />
        {active && <span className="text-[10px]">{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function csv(v: string | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(text: string, name: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
