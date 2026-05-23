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

export function DesktopAddModal({ open, projectId, statuses, initialCoords, onClose, onSaved }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6">
      <div className="absolute inset-0 bg-[oklch(0%_0_0/0.55)] backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)] shadow-[0_30px_60px_-20px_oklch(0%_0_0/0.6)]">
        <div className="flex items-center justify-between border-b border-[oklch(28%_0.02_250/0.55)] px-5 py-3.5">
          <h2 className="font-display text-[15px] font-extrabold">Add point</h2>
          <button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[oklch(76%_0.012_250)] hover:bg-[oklch(20%_0.016_250)]">
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
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
  );
}
