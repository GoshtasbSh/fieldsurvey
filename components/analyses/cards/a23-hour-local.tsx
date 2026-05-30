"use client";

import { TrustChrome } from "../trust-chrome";

type Bucket = { hour: number; total: number };

/**
 * A23 — Hour-of-day histogram in project-local timezone (NOT UTC).
 *
 * Robust to missing/empty data: renders nothing if `buckets` is undefined or
 * empty. Wave-1 batch 2 wires the data path via the catalog dispatcher in a
 * later batch; for now the registry passes only `projectId` and the bars come
 * up empty until the dispatcher lands.
 *
 * The `grid-cols-24` class is implemented via inline grid-template-columns
 * since Tailwind only ships up to `grid-cols-12` by default.
 */
export function HourHistogram({
  buckets,
  tz,
}: {
  buckets?: Bucket[];
  tz?: string;
  // `projectId` is accepted to match the registry contract; later batches will
  // use it to fetch buckets via `/api/projects/:id/analyses/A23_hour_local`.
  projectId?: string;
}) {
  if (!buckets || buckets.length === 0) return null;
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const total = buckets.reduce((a, b) => a + b.total, 0);
  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="Hour of day collected"
        denominatorLabel={tz ?? "local tz"}
        n={total}
      />
      <div
        className="grid-cols-24 grid h-16 items-end gap-px"
        style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}
      >
        {buckets.map((b) => (
          <div
            key={b.hour}
            className="bg-[var(--shell-text-muted)]"
            style={{
              height: `${(b.total / max) * 100}%`,
              opacity: b.total === 0 ? 0.2 : 1,
            }}
            title={`${b.hour}: ${b.total}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-[var(--shell-text-muted)]">
        <span>12am</span>
        <span>6am</span>
        <span>noon</span>
        <span>6pm</span>
        <span>11pm</span>
      </div>
    </div>
  );
}
