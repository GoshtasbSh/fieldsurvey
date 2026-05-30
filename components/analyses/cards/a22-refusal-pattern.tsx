"use client";
import { useEffect, useMemo, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { NMinPlaceholder } from "../n-min-placeholder";
import type { RefusalPatternRow } from "@/lib/queries/refusal-pattern";

/**
 * A22 — refusal / not-home / other small multiples.
 *
 * Three columns (R, NC, O). Each column lists the top parcels for that
 * bucket as count tiles, so admins can see at a glance whether refusals
 * cluster geographically (and where) vs not-homes cluster elsewhere.
 *
 * n_min is 100 refusal-class points total (R + NC + O across all parcels).
 */
const N_MIN = 100;
const ROWS_PER_BUCKET = 6;
type Bucket = "R" | "NC" | "O";
const BUCKETS: Bucket[] = ["R", "NC", "O"];
const BUCKET_LABEL: Record<Bucket, string> = {
  R: "Refusal",
  NC: "Not-home",
  O: "Other",
};

export function RefusalSmallMultiples({ projectId }: { projectId?: string }) {
  const [rows, setRows] = useState<RefusalPatternRow[] | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/analyses/a22-refusal-pattern`,
          { signal: ac.signal },
        );
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setRows((json?.data ?? null) as RefusalPatternRow[] | null);
      } catch {
        // dispatcher not wired yet
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [projectId]);

  const totalN = useMemo(
    () => (rows ?? []).reduce((s, r) => s + (r.n ?? 0), 0),
    [rows],
  );

  const grouped = useMemo(() => {
    const out: Record<Bucket, RefusalPatternRow[]> = { R: [], NC: [], O: [] };
    for (const r of rows ?? []) {
      if (r.bucket in out) out[r.bucket].push(r);
    }
    for (const b of BUCKETS) out[b].sort((a, z) => z.n - a.n);
    return out;
  }, [rows]);

  if (rows === null) return null;
  if (totalN < N_MIN) {
    return <NMinPlaceholder cardName="Refusal & not-home pattern" n={totalN} nMin={N_MIN} />;
  }

  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="Refusal · not-home · other"
        n={totalN}
        denominatorLabel="non-interview pts"
      />
      <div className="grid grid-cols-3 gap-3">
        {BUCKETS.map((b) => (
          <BucketColumn key={b} bucket={b} rows={grouped[b].slice(0, ROWS_PER_BUCKET)} />
        ))}
      </div>
    </div>
  );
}

function BucketColumn({ bucket, rows }: { bucket: Bucket; rows: RefusalPatternRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div>
      <div className="mb-1 font-mono text-[9.5px] uppercase text-[var(--shell-text-muted)]">
        {BUCKET_LABEL[bucket]}
      </div>
      {rows.length === 0 ? (
        <div className="text-[10.5px] text-[var(--shell-text-muted)]">none</div>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.parcel_id} className="flex items-center gap-1.5 text-[10.5px]">
              <div
                className="truncate font-mono text-[9px] text-[var(--shell-text-muted)]"
                style={{ width: 56 }}
                title={r.parcel_id}
              >
                {r.parcel_id.slice(0, 8)}
              </div>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--shell-3)]">
                <div
                  className="h-full rounded-full bg-[var(--shell-text-muted)]"
                  style={{ width: `${(r.n / max) * 100}%` }}
                />
              </div>
              <div className="w-6 text-right font-mono tabular-nums">{r.n}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
