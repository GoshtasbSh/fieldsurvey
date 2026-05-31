"use client";
import { useEffect, useState } from "react";

type Props = { cachedAt?: string | null; projectId?: string };

function tone(ageMin: number): "good" | "warn" | "bad" {
  if (ageMin < 15) return "good";
  if (ageMin < 60) return "warn";
  return "bad";
}

export function FreshnessChip({ cachedAt }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  if (!cachedAt) {
    return (
      <div className="bento-panel p-3">
        <div className="bento-label mb-1">Freshness</div>
        <div className="font-mono text-[10px] text-[var(--shell-text-muted)]">no cache yet</div>
      </div>
    );
  }
  const ageMs = now - new Date(cachedAt).getTime();
  const ageMin = Math.round(ageMs / 60000);
  const t = tone(ageMin);
  const c = t === "good" ? "oklch(76% 0.16 158)" : t === "warn" ? "oklch(78% 0.165 70)" : "oklch(68% 0.21 25)";
  return (
    <div className="bento-panel p-3">
      <div className="bento-label mb-1 flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: c }} />Freshness</div>
      <div className="font-mono text-[10px] text-[var(--shell-text-muted)]">as of {new Date(cachedAt).toLocaleTimeString()} ({ageMin}m ago)</div>
    </div>
  );
}
