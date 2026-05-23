"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, X } from "lucide-react";

type Row = {
  id: string;
  point_id: string | null;
  source: string;
  raw_data: Record<string, unknown>;
  address_used: string | null;
  geocoded_lat: number | null;
  geocoded_lon: number | null;
  match_distance_m: number | null;
  matched_at: string | null;
  imported_at: string;
  external_id: string | null;
};

type MatchFilter = "all" | "matched" | "unmatched";

export function ResponsesTable({ rows }: { rows: Row[] }) {
  const [match, setMatch] = useState<MatchFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return rows.filter((r) => {
      if (match === "matched" && !r.point_id) return false;
      if (match === "unmatched" && r.point_id) return false;
      if (!q) return true;
      return (r.address_used ?? "").toLowerCase().includes(q) || (r.external_id ?? "").toLowerCase().includes(q);
    });
  }, [rows, match, query]);

  const counts = useMemo(() => {
    const matched = rows.filter((r) => r.point_id).length;
    return { matched, unmatched: rows.length - matched, total: rows.length };
  }, [rows]);

  return (
    <div className="mt-5 rounded-2xl border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)]">
      <div className="flex items-center gap-3 border-b border-[oklch(28%_0.02_250/0.55)] p-3">
        <div className="inline-flex rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] p-0.5">
          {(["all", "matched", "unmatched"] as const).map((k) => (
            <button key={k} onClick={() => setMatch(k)} className={`rounded-md px-3 py-1.5 font-display text-[11px] font-bold transition ${match === k ? "bg-[oklch(22%_0.02_250)] text-[oklch(96%_0.008_250)]" : "text-[oklch(58%_0.014_250)] hover:text-[oklch(76%_0.012_250)]"}`}>
              {k === "all" ? `All ${counts.total}` : k === "matched" ? `Matched ${counts.matched}` : `Unmatched ${counts.unmatched}`}
            </button>
          ))}
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search address or external_id…" className="flex-1 max-w-md rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] px-3 py-2 text-[12px] outline-none focus:border-[oklch(78%_0.155_234/0.5)]" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-[oklch(20%_0.016_250)] text-[oklch(58%_0.014_250)]">
            <tr>
              <th className="px-3 py-2 text-left"><span className="inline-flex items-center gap-1"><ArrowUpDown className="h-3 w-3 opacity-50" strokeWidth={1.7} />Match</span></th>
              <th className="px-3 py-2 text-left">Address (geocoded)</th>
              <th className="px-3 py-2 text-left">External ID</th>
              <th className="px-3 py-2 text-left">Imported</th>
              <th className="px-3 py-2 text-left">Source</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} onClick={() => setSelected(r)} className="cursor-pointer border-t border-[oklch(28%_0.02_250/0.55)] hover:bg-[oklch(20%_0.016_250)]">
                <td className="px-3 py-2">
                  {r.point_id ? (
                    <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ring-1 ring-white text-[oklch(96%_0.008_250)]">M1 · ±{r.match_distance_m?.toFixed(1) ?? "—"}m</span>
                  ) : (
                    <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ring-2 ring-[#a855f7] text-[oklch(72%_0.18_305)]">R1</span>
                  )}
                </td>
                <td className="px-3 py-2 text-[oklch(96%_0.008_250)]">{r.address_used ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-[oklch(76%_0.012_250)]">{r.external_id ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-[oklch(58%_0.014_250)] tabular-nums">{new Date(r.imported_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-[oklch(76%_0.012_250)]">{r.source}</td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={5} className="px-3 py-12 text-center text-[oklch(58%_0.014_250)]">No responses {query ? "match" : "yet"}.</td></tr>}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-end" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-[oklch(0%_0_0/0.55)] backdrop-blur-sm" />
          <div className="relative h-full w-full max-w-md overflow-hidden border-l border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)] shadow-[0_30px_60px_-20px_oklch(0%_0_0/0.6)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[oklch(28%_0.02_250/0.55)] px-4 py-3">
              <div>
                <h3 className="font-display text-[14px] font-extrabold">Response</h3>
                <p className="font-mono text-[10.5px] text-[oklch(58%_0.014_250)]">{selected.external_id ?? selected.id}</p>
              </div>
              <button onClick={() => setSelected(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[oklch(76%_0.012_250)] hover:bg-[oklch(20%_0.016_250)]"><X className="h-4 w-4" strokeWidth={1.7} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] p-3 text-[12px]">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[oklch(58%_0.014_250)]">Match</div>
                <div className="mt-1 font-mono">{selected.point_id ? `M1 (point ${selected.point_id.slice(0, 8)}…)` : "R1 — no field point"}</div>
                {selected.geocoded_lat != null && <div className="mt-1 font-mono text-[10.5px] text-[oklch(58%_0.014_250)]">Geocoded: {selected.geocoded_lat.toFixed(5)}, {selected.geocoded_lon?.toFixed(5)}</div>}
              </div>
              <div>
                <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-[oklch(58%_0.014_250)]">Answers</div>
                <pre className="overflow-x-auto rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(14%_0.012_250)] p-3 font-mono text-[11px] leading-relaxed text-[oklch(76%_0.012_250)]">{JSON.stringify(selected.raw_data, null, 2)}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
