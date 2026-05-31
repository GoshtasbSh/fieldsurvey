"use client";
import { useEffect, useMemo, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { AwaitingDataPanel } from "@/components/analyses/awaiting-data-panel";
import type { F1QueueRow } from "@/lib/queries/f1-queue";

/**
 * A52 — F1 queue (Completed-but-unmatched points awaiting a response).
 *
 * Count tile at top + sortable list of the oldest points underneath, so
 * triage can work the queue FIFO. No n_min suppression — even 1 F1 is
 * actionable for the case-management workflow.
 *
 * The "sort" affordance is a toggle between oldest/newest; clicking a
 * row will cross-reference the map shell (wiring TBD in Batch 5).
 */
const LIST_LIMIT = 12;
type SortDir = "oldest" | "newest";

export function F1QueueListMap({ projectId }: { projectId?: string }) {
  const [rows, setRows] = useState<F1QueueRow[] | null>(null);
  const [sort, setSort] = useState<SortDir>("oldest");

  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/analyses/A52_f1_queue`,
          { signal: ac.signal },
        );
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setRows((json?.data ?? null) as F1QueueRow[] | null);
      } catch {
        // dispatcher not wired yet
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [projectId]);

  const sorted = useMemo(() => {
    if (!rows) return null;
    const copy = [...rows];
    copy.sort((a, z) => {
      const ta = +new Date(a.collected_at);
      const tz = +new Date(z.collected_at);
      return sort === "oldest" ? ta - tz : tz - ta;
    });
    return copy;
  }, [rows, sort]);

  if (rows === null) {
    return (
      <AwaitingDataPanel
        cardName="Follow-ups due (F1 queue)"
        cardId="A52_f1_queue"
        reason="no-data"
      />
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bento-panel p-4">
        <TrustChrome cardName="F1 queue" n={0} />
        <div className="rounded-lg bg-[var(--shell-2)] p-3 text-center text-[11px] text-[var(--shell-text-muted)]">
          No unmatched Completed points — queue is empty.
        </div>
      </div>
    );
  }

  return (
    <div className="bento-panel p-4">
      <TrustChrome cardName="F1 queue" n={rows.length} denominatorLabel="awaiting match" />
      <div className="mb-2 flex items-center gap-3">
        <div className="flex-1 rounded-lg bg-[var(--shell-2)] p-3 text-center">
          <div className="font-display text-[22px] font-extrabold tabular-nums">
            {rows.length}
          </div>
          <div className="font-mono text-[9.5px] uppercase text-[var(--shell-text-muted)]">
            F1 points awaiting match
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <SortBtn active={sort === "oldest"} onClick={() => setSort("oldest")}>
            oldest
          </SortBtn>
          <SortBtn active={sort === "newest"} onClick={() => setSort("newest")}>
            newest
          </SortBtn>
        </div>
      </div>
      <ol className="space-y-1 font-mono text-[10px]">
        {(sorted ?? []).slice(0, LIST_LIMIT).map((r, i) => (
          <li
            key={r.id}
            className="flex items-center gap-2 rounded bg-[var(--shell-2)] px-2 py-1"
          >
            <span className="w-4 text-right text-[var(--shell-text-muted)]">{i + 1}.</span>
            <span className="flex-1 truncate">
              {Number(r.lat).toFixed(4)}, {Number(r.lon).toFixed(4)}
            </span>
            <span className="tabular-nums text-[var(--shell-text-muted)]">
              {new Date(r.collected_at).toLocaleDateString()}
            </span>
          </li>
        ))}
        {(sorted?.length ?? 0) > LIST_LIMIT && (
          <li className="px-2 py-1 text-center text-[9.5px] text-[var(--shell-text-muted)]">
            +{(sorted?.length ?? 0) - LIST_LIMIT} more
          </li>
        )}
      </ol>
    </div>
  );
}

function SortBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-0.5 font-mono text-[9px] uppercase ${
        active
          ? "bg-[var(--shell-text-muted)] text-[var(--shell-1)]"
          : "bg-[var(--shell-3)] text-[var(--shell-text-muted)]"
      }`}
    >
      {children}
    </button>
  );
}
