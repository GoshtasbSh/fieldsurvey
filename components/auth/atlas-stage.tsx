"use client";

import { useState } from "react";
import { AtlasBackdrop } from "./atlas-backdrop";

export function AtlasStage({ children }: { children: React.ReactNode }) {
  const [leg, setLeg] = useState("CEDAR KEY · 29.1°N 83.0°W");

  return (
    <main className="fos-stage">
      <AtlasBackdrop onLegChange={setLeg} />
      <div className="fos-wash" aria-hidden />
      <div className="fos-grain" aria-hidden />

      {/* Coordinate ticker — top-left, mirrors the dashboard topbar mono feel */}
      <div className="absolute left-5 top-5 z-10 hidden items-center gap-2 font-mono text-[10.5px] tracking-[0.18em] text-[var(--bento-ink-3)] sm:flex">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{
            background: "var(--bento-accent)",
            boxShadow: "0 0 8px var(--bento-accent-glow)",
          }}
        />
        <span>{leg}</span>
      </div>

      {/* Right meta */}
      <div className="absolute right-5 top-5 z-10 hidden font-mono text-[10.5px] tracking-[0.18em] text-[var(--bento-ink-3)] sm:block">
        Carto Dark Matter · OSM
      </div>

      {/* Centered content column */}
      <div className="relative z-10 grid min-h-screen place-items-center px-4 py-10">
        <div className="w-full max-w-[440px]">{children}</div>
      </div>
    </main>
  );
}
