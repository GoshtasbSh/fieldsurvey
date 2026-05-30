"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { NMinPlaceholder } from "../n-min-placeholder";
import type { AaporResult } from "@/lib/queries/aapor";

/**
 * Shared hook for the three AAPOR panels.
 *
 * The unified `/api/projects/[projectId]/analyses/aapor` endpoint doesn't
 * exist yet (Batch 5 wires the dispatcher) — until then, the fetch fails
 * silently (network error → null state → component returns null), which is
 * exactly the "no data yet" path the cards already handle.
 *
 * Wraps fetch in AbortController so an unmount mid-flight doesn't trigger
 * a setState-on-unmounted React warning.
 */
function useAapor(projectId: string | undefined): AaporResult | null {
  const [r, setR] = useState<AaporResult | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/analyses/aapor`,
          { signal: ac.signal },
        );
        if (!res.ok) return;
        const json = (await res.json()) as AaporResult;
        if (!cancelled) setR(json);
      } catch {
        // swallow — network failure or dispatcher not wired yet
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [projectId]);
  return r;
}

function fmt(p: number | null): string {
  return p == null ? "—" : `${(p * 100).toFixed(1)}%`;
}

function sumCounts(c: AaporResult["counts"]): number {
  return c.I + c.P + c.R + c.NC + c.O + c.UH + c.UO;
}

export function AaporRatesPanel({ projectId }: { projectId?: string }) {
  const r = useAapor(projectId);
  if (r === null) return null;
  const n = sumCounts(r.counts);
  if (n < 50) return <NMinPlaceholder cardName="AAPOR rates" n={n} nMin={50} />;
  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="Response rates (AAPOR)"
        methodHref="https://aapor.org/response-rates/"
        n={n}
      />
      <div className="grid grid-cols-3 gap-2">
        <KpiTile label="RR1" v={fmt(r.rates.rr1)} />
        <KpiTile label="RR3" v={fmt(r.rates.rr3)} />
        <KpiTile label="RR5" v={fmt(r.rates.rr5)} />
      </div>
      <CountsRow counts={r.counts} />
      <UnmappedWarning n={r.rates.unmappedCount} />
    </div>
  );
}

export function AaporCoopRefPanel({ projectId }: { projectId?: string }) {
  const r = useAapor(projectId);
  if (r === null) return null;
  const n = sumCounts(r.counts);
  if (n < 50) return <NMinPlaceholder cardName="COOP1 + REF1" n={n} nMin={50} />;
  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="Cooperation + refusal"
        methodHref="https://aapor.org/response-rates/"
        n={n}
      />
      <div className="grid grid-cols-2 gap-2">
        <KpiTile label="COOP1" v={fmt(r.rates.coop1)} />
        <KpiTile label="REF1"  v={fmt(r.rates.ref1)}  />
      </div>
    </div>
  );
}

export function AaporContactTile({ projectId }: { projectId?: string }) {
  const r = useAapor(projectId);
  if (r === null) return null;
  const n = sumCounts(r.counts);
  if (n < 50) return <NMinPlaceholder cardName="CON1 contact rate" n={n} nMin={50} />;
  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="Contact rate (CON1)"
        methodHref="https://aapor.org/response-rates/"
        n={n}
      />
      <KpiTile label="CON1" v={fmt(r.rates.con1)} />
    </div>
  );
}

function KpiTile({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-lg bg-[var(--shell-2)] p-2 text-center">
      <div className="font-mono text-[9.5px] uppercase text-[var(--shell-text-muted)]">{label}</div>
      <div className="font-display text-[18px] font-extrabold tabular-nums">{v}</div>
    </div>
  );
}

/**
 * Inline warning chip rendered when one or more points have no AAPOR mapping.
 * Those points are EXCLUDED from every rate denominator, so the rates above
 * are correct under that assumption — but the admin should finish the mapping.
 */
function UnmappedWarning({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <div
      role="status"
      className="mt-2 inline-flex items-center gap-1.5 rounded bg-amber-500/15 px-2 py-1 font-mono text-[10px] text-amber-700 dark:text-amber-300"
    >
      <span aria-hidden>!</span>
      <span>
        {n} point{n === 1 ? "" : "s"} have no AAPOR mapping (not included)
      </span>
    </div>
  );
}

function CountsRow({ counts }: { counts: AaporResult["counts"] }) {
  const entries: Array<[string, number]> = [
    ["I", counts.I], ["P", counts.P], ["R", counts.R],
    ["NC", counts.NC], ["O", counts.O], ["UH", counts.UH], ["UO", counts.UO],
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[9.5px] text-[var(--shell-text-muted)]">
      {entries.map(([k, v]) => (
        <span key={k} className="rounded bg-[var(--shell-2)] px-1.5 py-0.5">{k}={v}</span>
      ))}
    </div>
  );
}
