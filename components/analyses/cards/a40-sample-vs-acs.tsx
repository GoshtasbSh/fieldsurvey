"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import type { DemographicsSchemaRow } from "@/lib/queries/representativeness";

/**
 * A40 — sample composition vs ACS (member).
 *
 * Wave-1 deliberately ships the *empty state* of this card. No project in
 * production has declared `project_demographics_schema` rows yet, and the
 * ACS join pipeline isn't built either. The card:
 *
 *   • renders a custom "Add demographic columns…" panel when no stratifiers
 *     are declared (the always-true path today);
 *   • renders a side-by-side stacked-bar mockup placeholder when stratifiers
 *     exist so admins doing QA can see the slot before real ACS data lands.
 *
 * Full implementation deferred — see the wave-1 plan for follow-up tasks.
 */
export function SampleVsAcsBars({ projectId }: { projectId?: string }) {
  const [schema, setSchema] = useState<DemographicsSchemaRow[] | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/analyses/A40_sample_vs_acs`,
          { signal: ac.signal },
        );
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setSchema((json?.data ?? null) as DemographicsSchemaRow[] | null);
      } catch {
        // dispatcher not wired yet
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [projectId]);

  if (schema === null) return null;

  if (schema.length === 0) {
    return (
      <div className="bento-panel p-4">
        <div className="bento-label mb-2">Sample vs ACS</div>
        <div className="rounded-lg bg-[var(--shell-2)] p-3 text-[11.5px] leading-snug text-[var(--shell-text-muted)]">
          No demographic stratifiers declared for this project. Add demographic
          columns and an ACS join in project settings to enable this card.
        </div>
      </div>
    );
  }

  // Stratifiers declared — render a stacked-bar mockup until ACS data lands.
  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="Sample vs ACS"
        n={schema.length}
        denominatorLabel={`${schema.length} stratifier${schema.length === 1 ? "" : "s"}`}
        modeled
      />
      <ul className="space-y-2">
        {schema.map((s) => (
          <li key={s.raw_data_key}>
            <div className="mb-1 flex items-baseline justify-between">
              <div className="text-[10.5px] font-medium">{s.raw_data_key}</div>
              <div className="font-mono text-[9px] uppercase text-[var(--shell-text-muted)]">
                {s.stratifier_type}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <BarMock label="sample" />
              <BarMock label="ACS" muted />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 text-[10px] italic text-[var(--shell-text-muted)]">
        ACS data not yet joined for this project — bars shown as placeholder.
      </div>
    </div>
  );
}

function BarMock({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <div>
      <div className="mb-0.5 font-mono text-[8.5px] uppercase text-[var(--shell-text-muted)]">{label}</div>
      <div className="flex h-2 overflow-hidden rounded-sm">
        <div className={muted ? "flex-[2] bg-[var(--shell-3)]" : "flex-[2] bg-[var(--shell-text-muted)]"} />
        <div className={muted ? "flex-[3] bg-[var(--shell-2)]" : "flex-[3] bg-[var(--shell-3)]"} />
        <div className={muted ? "flex-[1] bg-[var(--shell-3)]" : "flex-[1] bg-[var(--shell-text-muted)]"} />
      </div>
    </div>
  );
}
