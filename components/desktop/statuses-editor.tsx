"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ArrowUp, ArrowDown, Loader2, GripVertical } from "lucide-react";

type Status = {
  id: string;
  label: string;
  color: string;
  icon: string | null;
  sort_order: number;
  is_default: boolean;
};

const DEFAULT_COLORS = ["#34d399", "#f59e0b", "#9ca3af", "#ef4444", "#38bdf8", "#a78bfa"];

const SYMBOLS: Array<{ id: string; label: string }> = [
  { id: "circle",   label: "●" },
  { id: "square",   label: "■" },
  { id: "diamond",  label: "◆" },
  { id: "triangle", label: "▲" },
  { id: "star",     label: "★" },
];

function SymbolPreview({ icon, color, size = 14 }: { icon: string | null; color: string; size?: number }) {
  const sym = icon ?? "circle";
  const s = size;
  if (sym === "square")   return <span style={{ display: "inline-block", width: s, height: s, background: color, borderRadius: 2 }} />;
  if (sym === "diamond")  return <span style={{ display: "inline-block", width: s, height: s, background: color, transform: "rotate(45deg)", borderRadius: 1 }} />;
  if (sym === "triangle") return <span style={{ display: "inline-block", width: 0, height: 0, borderLeft: `${s * 0.55}px solid transparent`, borderRight: `${s * 0.55}px solid transparent`, borderBottom: `${s}px solid ${color}` }} />;
  if (sym === "star")     return (
    <svg width={s} height={s} viewBox="0 0 20 20" style={{ display: "inline-block" }}>
      <polygon points="10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7" fill={color} />
    </svg>
  );
  return <span style={{ display: "inline-block", width: s, height: s, background: color, borderRadius: "50%" }} />;
}

export function StatusesEditor({ projectId, initial }: { projectId: string; initial: Status[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Status[]>(initial);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/statuses`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statuses: rows.map((s, i) => ({ ...s, sort_order: i })) }),
      });
      if (!r.ok) throw new Error(await r.text());
      router.refresh();
    } finally { setBusy(false); }
  }

  function update(id: string, patch: Partial<Status>) { setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r))); }
  function add() {
    setRows((rs) => [...rs, { id: `new_${Math.random().toString(36).slice(2, 9)}`, label: "New status", color: DEFAULT_COLORS[rs.length % DEFAULT_COLORS.length], icon: null, sort_order: rs.length, is_default: false }]);
  }
  function move(id: string, dir: -1 | 1) {
    setRows((rs) => { const i = rs.findIndex((x) => x.id === id); const j = i + dir; if (i < 0 || j < 0 || j >= rs.length) return rs; const out = [...rs]; [out[i], out[j]] = [out[j], out[i]]; return out; });
  }
  function remove(id: string) { setRows((rs) => rs.filter((r) => r.id !== id)); }

  // ── Drag handlers (native HTML5) ────────────────────────────────────
  function onDragStart(e: React.DragEvent, id: string) {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    // Required for Firefox to start the drag
    e.dataTransfer.setData("text/plain", id);
  }
  function onDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== overId) setOverId(id);
  }
  function onDragLeave(id: string) { if (overId === id) setOverId(null); }
  function onDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    const sourceId = dragId;
    setDragId(null); setOverId(null);
    if (!sourceId || sourceId === targetId) return;
    setRows((rs) => {
      const src = rs.findIndex((x) => x.id === sourceId);
      const tgt = rs.findIndex((x) => x.id === targetId);
      if (src < 0 || tgt < 0) return rs;
      const out = [...rs];
      const [moved] = out.splice(src, 1);
      out.splice(tgt, 0, moved);
      return out;
    });
  }

  return (
    <div className="mt-4 space-y-2">
      {rows.map((s, i) => {
        const isDragging = dragId === s.id;
        const isOver = overId === s.id && dragId !== s.id;
        return (
          <div
            key={s.id}
            draggable
            onDragStart={(e) => onDragStart(e, s.id)}
            onDragOver={(e) => onDragOver(e, s.id)}
            onDragLeave={() => onDragLeave(s.id)}
            onDrop={(e) => onDrop(e, s.id)}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            className={`grid grid-cols-[20px_28px_1fr_110px_auto_28px_28px_28px] items-center gap-2 rounded-lg border bg-[oklch(20%_0.016_250)] p-2 transition ${
              isDragging
                ? "opacity-50 border-[oklch(78%_0.155_234/0.5)] shadow-[0_12px_24px_-8px_oklch(0%_0_0/0.5)]"
                : isOver
                  ? "border-dashed border-[oklch(78%_0.155_234/0.5)] bg-[oklch(78%_0.155_234/0.08)]"
                  : "border-[oklch(28%_0.02_250/0.55)]"
            }`}
          >
            <span className="cursor-grab text-[oklch(42%_0.014_250)] hover:text-[oklch(78%_0.155_234)] active:cursor-grabbing" aria-label="Drag to reorder">
              <GripVertical className="h-4 w-4" strokeWidth={1.7} />
            </span>
            <span className="font-mono text-[11px] text-[oklch(58%_0.014_250)] text-center tabular-nums">{i + 1}</span>
            <input value={s.label} onChange={(e) => update(s.id, { label: e.target.value })} className="rounded border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)] px-2 py-1 text-[13px] outline-none focus:border-[oklch(78%_0.155_234/0.5)]" />
            <div className="flex items-center gap-2">
              <input type="color" value={s.color} onChange={(e) => update(s.id, { color: e.target.value })} className="h-6 w-10 cursor-pointer rounded border border-[oklch(28%_0.02_250/0.55)] bg-transparent" />
              <input value={s.color} onChange={(e) => update(s.id, { color: e.target.value })} className="w-16 rounded border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)] px-1.5 py-0.5 font-mono text-[10px]" />
            </div>
            {/* Symbol picker */}
            <div className="flex items-center gap-0.5">
              {SYMBOLS.map((sym) => {
                const active = (s.icon ?? "circle") === sym.id;
                return (
                  <button
                    key={sym.id}
                    onClick={() => update(s.id, { icon: sym.id })}
                    title={sym.id}
                    className={`inline-flex h-6 w-6 items-center justify-center rounded text-[13px] transition ${
                      active
                        ? "bg-[oklch(78%_0.155_234/0.2)] ring-1 ring-[oklch(78%_0.155_234/0.5)]"
                        : "text-[oklch(58%_0.014_250)] hover:bg-[oklch(28%_0.02_250/0.5)]"
                    }`}
                  >
                    <SymbolPreview icon={sym.id} color={active ? s.color : "oklch(58% 0.014 250)"} size={12} />
                  </button>
                );
              })}
            </div>
            <button onClick={() => move(s.id, -1)} disabled={i === 0} className="h-7 w-7 inline-flex items-center justify-center rounded text-[oklch(76%_0.012_250)] hover:bg-[oklch(24%_0.018_250)] disabled:opacity-30" aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" strokeWidth={1.7} /></button>
            <button onClick={() => move(s.id, 1)} disabled={i === rows.length - 1} className="h-7 w-7 inline-flex items-center justify-center rounded text-[oklch(76%_0.012_250)] hover:bg-[oklch(24%_0.018_250)] disabled:opacity-30" aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" strokeWidth={1.7} /></button>
            <button onClick={() => remove(s.id)} className="h-7 w-7 inline-flex items-center justify-center rounded text-[oklch(68%_0.21_25)] hover:bg-[oklch(68%_0.21_25/0.15)]" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} /></button>
          </div>
        );
      })}
      <div className="flex gap-2 pt-2">
        <button onClick={add} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[oklch(28%_0.02_250/0.55)] px-3 py-2 font-display text-[11px] font-bold text-[oklch(76%_0.012_250)] hover:border-[oklch(78%_0.155_234/0.5)] hover:text-[oklch(78%_0.155_234)]">
          <Plus className="h-3.5 w-3.5" strokeWidth={1.7} /> Add status
        </button>
        <button onClick={save} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[oklch(78%_0.155_234)] px-4 py-2 font-display text-[12px] font-bold text-[oklch(14%_0.012_250)] shadow-[0_4px_14px_oklch(78%_0.155_234/0.4)] disabled:opacity-50">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </button>
      </div>
      <p className="text-[10.5px] text-[oklch(58%_0.014_250)] mt-1">Drag the handle to reorder, or use the arrow buttons for keyboard access.</p>
    </div>
  );
}
