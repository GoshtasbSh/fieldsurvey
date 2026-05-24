"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, Download, Map as MapIcon, Check, Trash2, Users, Tag, X, Loader2 } from "lucide-react";

type Row = {
  id: string;
  lat: number;
  lon: number;
  address: string | null;
  notes: string | null;
  accuracy_m: number | null;
  collected_at: string;
  matched_response_id: string | null;
  collector_id: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  project_statuses: any;
};

type SortKey = "collected_at" | "address" | "status" | "matched";
type StatusOption = { id: string; label: string; color: string };
type MemberOption = { user_id: string; display_name: string };

type Props = {
  projectId: string;
  rows: Row[];
  /** When non-null/empty, enables bulk actions UI. */
  canBulkEdit?: boolean;
  statuses?: StatusOption[];
  members?: MemberOption[];
};

export function PointsTable({ projectId, rows, canBulkEdit = false, statuses = [], members = [] }: Props) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>("collected_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOp, setBulkOp] = useState<null | "change_status" | "reassign" | "delete">(null);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const sorted = useMemo(() => {
    const filtered = rows.filter((r) => !query.trim() || (r.address ?? "").toLowerCase().includes(query.toLowerCase()) || (r.notes ?? "").toLowerCase().includes(query.toLowerCase()));
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

  function toggleSort(k: SortKey) { if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(k); setSortDir("desc"); } }
  function toggleAllVisible() {
    if (sorted.every((r) => selected.has(r.id))) { setSelected(new Set()); return; }
    const next = new Set(selected);
    for (const r of sorted) next.add(r.id);
    setSelected(next);
  }
  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  function exportCsv() {
    const cols = ["id", "address", "lat", "lon", "accuracy_m", "status", "matched", "collected_at", "notes"];
    const lines = [cols.join(",")];
    for (const r of sorted) lines.push([r.id, csv(r.address), r.lat, r.lon, r.accuracy_m ?? "", csv(r.project_statuses?.label), r.matched_response_id ? "M1" : "F1", r.collected_at, csv(r.notes)].join(","));
    download(lines.join("\n"), `points-${projectId}.csv`, "text/csv");
  }
  function exportGeoJSON() {
    const fc = { type: "FeatureCollection", features: sorted.map((r) => ({ type: "Feature", geometry: { type: "Point", coordinates: [r.lon, r.lat] }, properties: { id: r.id, address: r.address, status: r.project_statuses?.label, matched: !!r.matched_response_id, collected_at: r.collected_at, accuracy_m: r.accuracy_m, notes: r.notes } })) };
    download(JSON.stringify(fc, null, 2), `points-${projectId}.geojson`, "application/geo+json");
  }

  async function runBulk(payload: { action: "change_status" | "reassign" | "delete"; status_id?: string; collector_id?: string | null }) {
    setBusy(true);
    try {
      const r = await fetch("/api/points/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: projectId, point_ids: [...selected], ...payload }),
      });
      if (!r.ok) throw new Error(await r.text());
      setSelected(new Set());
      setBulkOp(null);
      setConfirmText("");
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-5 rounded-2xl border border-[var(--shell-border)] bg-[var(--shell-1)]">
      <div className="flex items-center gap-3 border-b border-[var(--shell-border)] p-3">
        <input placeholder="Search address or notes…" value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 max-w-md rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-3 py-2 text-[12px] outline-none focus:border-[oklch(78%_0.155_234/0.5)]" />
        <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-3 py-2 font-display text-[11px] font-bold text-[var(--shell-text-2)] hover:bg-[var(--shell-3)]">
          <Download className="h-3.5 w-3.5" strokeWidth={1.7} /> CSV
        </button>
        <button onClick={exportGeoJSON} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-3 py-2 font-display text-[11px] font-bold text-[var(--shell-text-2)] hover:bg-[var(--shell-3)]">
          <MapIcon className="h-3.5 w-3.5" strokeWidth={1.7} /> GeoJSON
        </button>
      </div>

      {canBulkEdit && selected.size > 0 && (
        <div className="m-3 flex items-center gap-3 rounded-xl border border-[oklch(78%_0.155_234/0.4)] bg-[linear-gradient(135deg,oklch(20%_0.06_234/0.4),oklch(17%_0.018_250))] p-2.5 shadow-[0_8px_24px_-10px_oklch(78%_0.155_234/0.3)]">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[oklch(78%_0.155_234/0.18)] text-[oklch(78%_0.155_234)]"><Check className="h-4 w-4" strokeWidth={2} /></span>
          <span className="font-display text-[12px] font-extrabold"><b className="text-[oklch(78%_0.155_234)]">{selected.size}</b> selected</span>
          <span className="text-[var(--shell-text-muted)]">·</span>
          <span className="text-[11px] text-[var(--shell-text-muted)]">across all visible rows</span>
          <div className="ml-auto flex gap-1.5">
            <button onClick={() => setBulkOp("change_status")} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-3 py-1.5 font-display text-[11px] font-bold text-[var(--shell-text-2)] hover:bg-[var(--shell-3)]"><Tag className="h-3 w-3" strokeWidth={1.7} /> Change status</button>
            <button onClick={() => setBulkOp("reassign")} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-3 py-1.5 font-display text-[11px] font-bold text-[var(--shell-text-2)] hover:bg-[var(--shell-3)]"><Users className="h-3 w-3" strokeWidth={1.7} /> Reassign</button>
            <button onClick={() => setBulkOp("delete")} className="inline-flex items-center gap-1.5 rounded-lg border border-[oklch(68%_0.21_25/0.4)] bg-[var(--shell-2)] px-3 py-1.5 font-display text-[11px] font-bold text-[oklch(68%_0.21_25)] hover:bg-[oklch(68%_0.21_25/0.1)]"><Trash2 className="h-3 w-3" strokeWidth={1.7} /> Delete</button>
            <button onClick={() => setSelected(new Set())} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--shell-text-muted)] hover:bg-[var(--shell-2)]"><X className="h-3.5 w-3.5" strokeWidth={1.7} /></button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-[var(--shell-2)] text-[var(--shell-text-muted)]">
            <tr>
              {canBulkEdit && (
                <th className="px-3 py-2 text-left" style={{ width: 32 }}>
                  <button onClick={toggleAllVisible} className={`inline-flex h-4 w-4 items-center justify-center rounded border-[1.5px] ${sorted.length > 0 && sorted.every((r) => selected.has(r.id)) ? "border-[oklch(78%_0.155_234)] bg-[oklch(78%_0.155_234)] text-[var(--shell-base)]" : "border-[var(--shell-text-muted)]"}`} aria-label="Select all">
                    {sorted.length > 0 && sorted.every((r) => selected.has(r.id)) && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  </button>
                </th>
              )}
              <Th label="Status"     onClick={() => toggleSort("status")} active={sortKey === "status"} dir={sortDir} />
              <Th label="Address"    onClick={() => toggleSort("address")} active={sortKey === "address"} dir={sortDir} />
              <th className="px-3 py-2 text-left">Lat/Lon</th>
              <Th label="Match"      onClick={() => toggleSort("matched")} active={sortKey === "matched"} dir={sortDir} />
              <Th label="Collected"  onClick={() => toggleSort("collected_at")} active={sortKey === "collected_at"} dir={sortDir} />
              <th className="px-3 py-2 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const on = selected.has(r.id);
              return (
                <tr key={r.id} className={`border-t border-[var(--shell-border)] ${on ? "bg-[oklch(78%_0.155_234/0.06)]" : "hover:bg-[var(--shell-2)]"}`}>
                  {canBulkEdit && (
                    <td className="px-3 py-2">
                      <button onClick={() => toggleOne(r.id)} className={`inline-flex h-4 w-4 items-center justify-center rounded border-[1.5px] ${on ? "border-[oklch(78%_0.155_234)] bg-[oklch(78%_0.155_234)] text-[var(--shell-base)]" : "border-[var(--shell-text-muted)] hover:border-[oklch(78%_0.155_234)]"}`} aria-label={on ? "Deselect" : "Select"}>
                        {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                      </button>
                    </td>
                  )}
                  <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: r.project_statuses?.color }} />{r.project_statuses?.label}</span></td>
                  <td className="px-3 py-2">{r.address ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[11px] tabular-nums">{r.lat.toFixed(5)}, {r.lon.toFixed(5)}</td>
                  <td className="px-3 py-2">
                    {r.matched_response_id
                      ? <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ring-1 ring-white text-[var(--shell-text)]">M1</span>
                      : <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ring-2 ring-[#fde047] text-[oklch(82%_0.17_86)]">F1</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-[var(--shell-text-muted)]">{new Date(r.collected_at).toLocaleString()}</td>
                  <td className="px-3 py-2 max-w-[300px] truncate text-[var(--shell-text-2)]">{r.notes ?? ""}</td>
                </tr>
              );
            })}
            {!sorted.length && <tr><td colSpan={canBulkEdit ? 7 : 6} className="px-3 py-12 text-center text-[var(--shell-text-muted)]">No points {query ? "match your search" : "yet"}.</td></tr>}
          </tbody>
        </table>
      </div>

      {bulkOp && (
        <div className="fixed inset-0 z-50 grid place-items-center p-6" onClick={() => !busy && setBulkOp(null)}>
          <div className="absolute inset-0 bg-[oklch(0%_0_0/0.55)] backdrop-blur-sm" />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--shell-border)] bg-[var(--shell-1)] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-[15px] font-extrabold">
              {bulkOp === "change_status" && `Change status of ${selected.size} point${selected.size === 1 ? "" : "s"}`}
              {bulkOp === "reassign" && `Reassign ${selected.size} point${selected.size === 1 ? "" : "s"}`}
              {bulkOp === "delete" && `Delete ${selected.size} point${selected.size === 1 ? "" : "s"}?`}
            </h3>

            {bulkOp === "change_status" && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {statuses.map((s) => (
                  <button key={s.id} disabled={busy} onClick={() => runBulk({ action: "change_status", status_id: s.id })} className="flex items-center gap-2 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] p-2.5 text-left text-[12px] font-semibold hover:border-[oklch(78%_0.155_234/0.5)]">
                    <span className="h-3 w-3 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            {bulkOp === "reassign" && (
              <div className="mt-4 space-y-2">
                <button disabled={busy} onClick={() => runBulk({ action: "reassign", collector_id: null })} className="flex w-full items-center gap-2 rounded-lg border border-dashed border-[var(--shell-border)] bg-[var(--shell-2)] p-2.5 text-left text-[12px] font-semibold text-[var(--shell-text-muted)]">— Unassigned —</button>
                {members.map((m) => (
                  <button key={m.user_id} disabled={busy} onClick={() => runBulk({ action: "reassign", collector_id: m.user_id })} className="flex w-full items-center gap-2 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] p-2.5 text-left text-[12px] font-semibold hover:border-[oklch(78%_0.155_234/0.5)]">
                    {m.display_name}
                  </button>
                ))}
                {members.length === 0 && <p className="text-[11px] text-[var(--shell-text-muted)]">No members yet — invite teammates from the Members page first.</p>}
              </div>
            )}

            {bulkOp === "delete" && (
              <div className="mt-3">
                <p className="text-[12px] text-[var(--shell-text-2)]">This permanently deletes the selected points and their photos. Type <b className="font-mono">DELETE</b> to confirm.</p>
                <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" className="mt-3 w-full rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-3 py-2 font-mono text-[13px] outline-none focus:border-[oklch(68%_0.21_25/0.5)]" />
                <div className="mt-4 flex justify-end gap-2">
                  <button disabled={busy} onClick={() => { setBulkOp(null); setConfirmText(""); }} className="rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-3 py-2 font-display text-[12px] font-bold text-[var(--shell-text-2)]">Cancel</button>
                  <button disabled={busy || confirmText !== "DELETE"} onClick={() => runBulk({ action: "delete" })} className="inline-flex items-center gap-2 rounded-lg bg-[oklch(68%_0.21_25)] px-3 py-2 font-display text-[12px] font-bold text-white disabled:opacity-50">
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    Delete {selected.size}
                  </button>
                </div>
              </div>
            )}

            {bulkOp !== "delete" && (
              <div className="mt-4 flex justify-end">
                <button onClick={() => setBulkOp(null)} className="rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-3 py-2 font-display text-[12px] font-bold text-[var(--shell-text-2)]">Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}
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

function csv(v: string | null | undefined): string { if (v == null) return ""; const s = String(v); return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function download(text: string, name: string, mime: string) { const blob = new Blob([text], { type: mime }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
