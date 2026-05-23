"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

type Prefs = {
  email_invites: boolean;
  email_role: boolean;
  email_digest: boolean;
  email_caps: boolean;
};

const ROWS: Array<{ key: keyof Prefs; title: string; desc: string }> = [
  { key: "email_invites", title: "Project invites", desc: "Someone invited you to a project, or your invite was accepted." },
  { key: "email_role",    title: "Role changes",    desc: "Your role on a project changed (e.g. promoted to admin)." },
  { key: "email_caps",    title: "Cap warnings",    desc: "A project you own approaches its quota (90% of points, photos, or invites)." },
  { key: "email_digest",  title: "Daily digest",    desc: "Once a day, a summary of activity across projects you're in. Opt-in." },
];

export function NotificationsForm({ initial }: { initial: Prefs }) {
  const [prefs, setPrefs] = useState<Prefs>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true); setSaved(false);
    try {
      const r = await fetch("/api/account/notifications", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!r.ok) throw new Error(await r.text());
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-2xl border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)]">
      {ROWS.map((r, i) => (
        <label key={r.key} className={`flex items-start gap-4 p-4 cursor-pointer ${i > 0 ? "border-t border-[oklch(28%_0.02_250/0.55)]" : ""}`}>
          <input type="checkbox" checked={prefs[r.key]} onChange={(e) => setPrefs((p) => ({ ...p, [r.key]: e.target.checked }))} className="mt-1 h-4 w-4 accent-[oklch(78%_0.155_234)]" />
          <div className="flex-1">
            <div className="font-display text-[13px] font-bold">{r.title}</div>
            <div className="mt-0.5 text-[11.5px] text-[oklch(58%_0.014_250)]">{r.desc}</div>
          </div>
        </label>
      ))}
      <div className="flex items-center justify-end gap-3 border-t border-[oklch(28%_0.02_250/0.55)] p-4">
        {saved && <span className="text-[11.5px] text-[oklch(76%_0.16_158)]">Saved.</span>}
        <button onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[oklch(78%_0.155_234)] px-4 py-2 font-display text-[12px] font-bold text-[oklch(14%_0.012_250)] shadow-[0_4px_14px_oklch(78%_0.155_234/0.4)] disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Save preferences
        </button>
      </div>
    </div>
  );
}
