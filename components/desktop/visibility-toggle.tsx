"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Lock, Copy, Check, Loader2 } from "lucide-react";

type Vis = "private" | "public_read";

export function VisibilityToggle({ projectId, initial, projectName }: { projectId: string; initial: Vis; projectName: string }) {
  const router = useRouter();
  const [vis, setVis] = useState<Vis>(initial);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);

  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/public/${projectId}` : "";

  async function flip(to: Vis) {
    setBusy(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/visibility`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: to }),
      });
      if (!r.ok) throw new Error(await r.text());
      setVis(to);
      setConfirming(false);
      setTyped("");
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Card on={vis === "private"} icon={<Lock className="h-4 w-4" strokeWidth={1.7} />} title="Private" desc="Only project members can see anything." onClick={() => vis !== "private" && flip("private")} />
        <Card on={vis === "public_read"} icon={<Globe className="h-4 w-4" strokeWidth={1.7} />} title="Public read-only" desc="Anyone with the link can view the map." onClick={() => vis !== "public_read" && setConfirming(true)} />
      </div>

      {vis === "public_read" && (
        <div className="rounded-lg border border-[oklch(76%_0.16_158/0.3)] bg-[oklch(76%_0.16_158/0.08)] p-3">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-[oklch(76%_0.16_158)]">Public link</div>
          <div className="mt-2 flex items-center gap-2">
            <input readOnly value={publicUrl} className="flex-1 rounded border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] px-2 py-1.5 font-mono text-[11px] text-[oklch(96%_0.008_250)]" />
            <button onClick={async () => { await navigator.clipboard.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="inline-flex h-9 w-9 items-center justify-center rounded border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] text-[oklch(76%_0.012_250)] hover:bg-[oklch(24%_0.018_250)]">
              {copied ? <Check className="h-4 w-4 text-[oklch(76%_0.16_158)]" strokeWidth={2} /> : <Copy className="h-4 w-4" strokeWidth={1.7} />}
            </button>
          </div>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center p-6" onClick={() => setConfirming(false)}>
          <div className="absolute inset-0 bg-[oklch(0%_0_0/0.55)] backdrop-blur-sm" />
          <div className="relative w-full max-w-md rounded-2xl border border-[oklch(86%_0.18_88/0.3)] bg-[oklch(17%_0.014_250)] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-[16px] font-extrabold">Make public?</h3>
            <p className="mt-2 text-[12.5px] text-[oklch(76%_0.012_250)]">
              Anyone with the link will be able to see the project map, status counts, and pin locations. Chat, member identities, and survey responses stay private. Type <b className="font-mono">{projectName}</b> to confirm.
            </p>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-3 w-full rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] px-3 py-2 text-[13px] font-mono outline-none focus:border-[oklch(82%_0.17_86/0.5)]" placeholder={projectName} />
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => { setConfirming(false); setTyped(""); }} className="rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] px-4 py-2 font-display text-[12px] font-bold text-[oklch(76%_0.012_250)] hover:bg-[oklch(24%_0.018_250)]">Cancel</button>
              <button onClick={() => flip("public_read")} disabled={busy || typed !== projectName} className="inline-flex items-center gap-2 rounded-lg bg-[oklch(82%_0.17_86)] px-4 py-2 font-display text-[12px] font-bold text-[oklch(14%_0.012_250)] disabled:opacity-50">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Make public
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ on, icon, title, desc, onClick }: { on: boolean; icon: React.ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${on ? "border-[oklch(78%_0.155_234/0.5)] bg-[oklch(78%_0.155_234/0.12)]" : "border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] hover:border-[oklch(36%_0.025_250/0.7)]"}`}>
      <div className={`inline-flex items-center gap-2 ${on ? "text-[oklch(78%_0.155_234)]" : "text-[oklch(76%_0.012_250)]"}`}>
        {icon}
        <span className="font-display text-[13px] font-extrabold">{title}</span>
      </div>
      <span className="text-[10.5px] text-[oklch(58%_0.014_250)]">{desc}</span>
    </button>
  );
}
