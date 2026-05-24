"use client";

import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import type { CapStatus } from "@/lib/queries/caps";

/** Shown at the top of the desktop map when any cap is ≥ warn_at_pct. */
export function CapBanner({ caps }: { caps: CapStatus | null }) {
  const [dismissed, setDismissed] = useState(false);
  if (!caps || dismissed) return null;

  const pointsPct = caps.max_points_per_project > 0 ? (caps.points_count / caps.max_points_per_project) * 100 : 0;
  const invitesPct = caps.max_pending_invites > 0 ? (caps.pending_invites / caps.max_pending_invites) * 100 : 0;
  const warn = caps.warn_at_pct;
  const triggers: string[] = [];
  if (pointsPct >= warn) triggers.push(`${caps.points_count} / ${caps.max_points_per_project} points (${Math.round(pointsPct)}%)`);
  if (invitesPct >= warn) triggers.push(`${caps.pending_invites} / ${caps.max_pending_invites} pending invites (${Math.round(invitesPct)}%)`);
  if (triggers.length === 0) return null;

  return (
    <div className="flex items-center gap-3 border-b border-[oklch(86%_0.18_88/0.3)] bg-[oklch(86%_0.18_88/0.08)] px-4 py-2 text-[12px] text-[oklch(82%_0.17_86)]">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" strokeWidth={1.7} />
      <span className="flex-1">
        <b>Approaching project cap:</b> {triggers.join(" · ")}
      </span>
      <button onClick={() => setDismissed(true)} className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--shell-text-muted)] hover:bg-[oklch(86%_0.18_88/0.15)]" aria-label="Dismiss"><X className="h-3.5 w-3.5" strokeWidth={1.7} /></button>
    </div>
  );
}
