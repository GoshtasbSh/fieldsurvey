"use client";

import { Fragment } from "react";
import { TrustChrome } from "../trust-chrome";
import { AwaitingDataPanel } from "@/components/analyses/awaiting-data-panel";
import type { DowHourCell } from "@/lib/queries/analytics";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A24 — Day-of-week × hour heatmap in project-local timezone.
 *
 * Robust to undefined data: renders nothing if `cells` is missing or empty.
 * Wave-1 batch 2 wires the data path via the catalog dispatcher in a later
 * batch; for now the registry passes only `projectId` and the heatmap is
 * empty until the dispatcher lands.
 */
export function DowHourHeatmap({
  cells,
  tz,
}: {
  cells?: DowHourCell[];
  tz?: string;
  // Accepted to match the registry contract.
  projectId?: string;
}) {
  if (!cells || cells.length === 0) {
    return (
      <AwaitingDataPanel
        cardName="Day-of-week heatmap"
        cardId="A24_dow"
        reason="no-data"
      />
    );
  }
  const max = Math.max(1, ...cells.map((c) => c.count));
  const total = cells.reduce((a, b) => a + b.count, 0);

  // Build a O(1) lookup map so we don't do 7*24 linear scans on every render.
  const lookup = new Map<string, number>();
  for (const c of cells) lookup.set(`${c.dow}-${c.hour}`, c.count);

  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="Day-of-week × hour"
        denominatorLabel={tz ?? "local tz"}
        n={total}
      />
      <div
        className="grid gap-px text-[8.5px]"
        style={{ gridTemplateColumns: "auto repeat(24, minmax(0, 1fr))" }}
      >
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div
            key={`col-${h}`}
            className="text-center font-mono text-[var(--shell-text-muted)]"
          >
            {h % 6 === 0 ? h : ""}
          </div>
        ))}
        {DAY.map((d, di) => (
          <Fragment key={d}>
            <div className="pr-1 font-mono text-[var(--shell-text-muted)]">{d}</div>
            {Array.from({ length: 24 }, (_, h) => {
              const c = lookup.get(`${di}-${h}`) ?? 0;
              const a = c === 0 ? 0.05 : 0.15 + (c / max) * 0.85;
              return (
                <div
                  key={`${d}-${h}`}
                  title={`${d} ${h}: ${c}`}
                  className="aspect-square"
                  style={{ background: `rgba(56,189,248,${a})` }}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
