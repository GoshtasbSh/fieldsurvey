"use client";

import { AddPointForm } from "@/components/add-point/add-point-form";
import type { StatusRow } from "@/components/desktop/left-rail";
import { X } from "lucide-react";
import { useEffect } from "react";

type Props = {
  open: boolean;
  projectId: string;
  statuses: StatusRow[];
  initialCoords?: { lat: number; lon: number };
  onClose: () => void;
  onSaved: (result: { online: boolean; pointId?: string; clientId: string }) => void;
};

/**
 * Mobile bottom sheet for adding a point.
 * Slides up from bottom, locks scroll, dismisses on backdrop tap or ✕.
 */
export function MobileAddSheet({ open, projectId, statuses, initialCoords, onClose, onSaved }: Props) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[oklch(0%_0_0/0.6)] backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-2xl border-t border-[var(--shell-border)] bg-[var(--shell-1)] shadow-[0_-12px_40px_-8px_oklch(0%_0_0/0.6)]" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex justify-center py-2">
          <span className="h-1 w-10 rounded-full bg-[var(--shell-border-soft)]" />
        </div>
        <div className="flex items-center justify-between px-4 pb-2">
          <h2 className="font-display text-[16px] font-extrabold">Register field visit</h2>
          <button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--shell-text-2)] hover:bg-[var(--shell-2)]">
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <AddPointForm
            projectId={projectId}
            statuses={statuses}
            initialLat={initialCoords?.lat}
            initialLon={initialCoords?.lon}
            onSaved={onSaved}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
}
