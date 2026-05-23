"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ArrowUp, ArrowDown, Loader2 } from "lucide-react";

type Status = {
  id: string;
  label: string;
  color: string;
  icon: string | null;
  sort_order: number;
  is_default: boolean;
};

const DEFAULT_COLORS = ["#34d399", "#f59e0b", "#9ca3af", "#ef4444", "#38bdf8", "#a78bfa"];

export function StatusesEditor({ projectId, initial }: { projectId: string; initial: Status[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Status[]>(initial);
  const [busy, setBusy] = useState(false);

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

  function update(id: string, patch: Partial<Status>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function add() {
    setRows((rs) => [
      ...rs,
      { id: `new_${Math.random().toString(36).slice(2, 9)}`, label: "New status", color: DEFAULT_COLORS[rs.length % DEFAULT_COLORS.length], icon: null, sort_order: rs.length, is_default: false },
    ]);
  }
  function move(id: string, dir: -1 | 1) {
    setRows((rs) => {
      const i = rs.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rs.length) return rs;
      const out = [...rs];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });
  }
  function remove(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  return (
    <div className="mt-4 space-y-2">
      {rows.map((s, i) => (
        <div key={s.id} className="grid grid-cols-[28px_1fr_120px_28px_28px_28px] items-center gap-2 rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] p-2">
          <span className="font-mono text-[11px] text-[oklch(58%_0.014_250)] text-center tabular-nums">{i + 1}</span>
          <input
            value={s.label}
            onChange={(e) => update(s.id, { label: e.target.value })}
            className="rounded border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)] px-2 py-1 text-[13px] outline-none focus:border-[oklch(78%_0.155_234/0.5)]"
          />
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={s.color}
              onChange={(e) => update(s.id, { color: e.target.value })}
              className="h-6 w-10 cursor-pointer rounded border border-[oklch(28%_0.02_250/0.55)] bg-transparent"
            />
            <input
              value={s.color}
              onChange={(e) => update(s.id, { color: e.target.value })}
              className="w-20 rounded border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)] px-1.5 py-0.5 font-mono text-[10px]"
            />
          </div>
          <button onClick={() => move(s.id, -1)} disabled={i === 0} className="h-7 w-7 inline-flex items-center justify-center rounded text-[oklch(76%_0.012_250)] hover:bg-[oklch(24%_0.018_250)] disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" strokeWidth={1.7} /></button>
          <button onClick={() => move(s.id, 1)} disabled={i === rows.length - 1} className="h-7 w-7 inline-flex items-center justify-center rounded text-[oklch(76%_0.012_250)] hover:bg-[oklch(24%_0.018_250)] disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" strokeWidth={1.7} /></button>
          <button onClick={() => remove(s.id)} className="h-7 w-7 inline-flex items-center justify-center rounded text-[oklch(68%_0.21_25)] hover:bg-[oklch(68%_0.21_25/0.15)]"><Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} /></button>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <button onClick={add} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[oklch(28%_0.02_250/0.55)] px-3 py-2 font-display text-[11px] font-bold text-[oklch(76%_0.012_250)] hover:border-[oklch(78%_0.155_234/0.5)] hover:text-[oklch(78%_0.155_234)]">
          <Plus className="h-3.5 w-3.5" strokeWidth={1.7} /> Add status
        </button>
        <button onClick={save} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[oklch(78%_0.155_234)] px-4 py-2 font-display text-[12px] font-bold text-[oklch(14%_0.012_250)] shadow-[0_4px_14px_oklch(78%_0.155_234/0.4)] disabled:opacity-50">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </button>
      </div>
    </div>
  );
}
