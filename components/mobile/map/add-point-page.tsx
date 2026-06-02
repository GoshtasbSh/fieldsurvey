"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AddPointForm } from "@/components/add-point/add-point-form";
import { Icon } from "@/components/mobile/icons/icons";
import type { StatusRow } from "@/components/desktop/left-rail";

type Props = {
  projectId: string;
  statuses: StatusRow[];
};

/**
 * Full-screen mobile add-point page. Reached via FAB on /m/map. On save it
 * navigates back to /m/map; on cancel the same. Captures current GPS once
 * on mount so the form pre-fills the user's location.
 */
export function MobileAddPointPage({ projectId, statuses }: Props) {
  const router = useRouter();
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => {
        /* user denied — form falls back to manual entry */
      },
      { enableHighAccuracy: true, timeout: 8_000 },
    );
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--m-bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          borderBottom: "1px solid var(--m-line)",
        }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Cancel"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "transparent",
            border: "none",
            color: "var(--m-ink-2)",
            fontSize: 14,
            cursor: "pointer",
            padding: 4,
          }}
        >
          <Icon name="x" />
          Cancel
        </button>
        <h1 style={{ fontSize: 15, fontWeight: 800 }}>Add point</h1>
        <span style={{ width: 60 }} />
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 14px 28px" }}>
        <AddPointForm
          projectId={projectId}
          statuses={statuses}
          initialLat={coords?.lat}
          initialLon={coords?.lon}
          onSaved={() => {
            router.replace(`/p/${projectId}/m/map`);
            router.refresh();
          }}
          onCancel={() => router.back()}
        />
      </div>
    </div>
  );
}
