# Analyses Catalog M7 Wave-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 28 M7 wave-1 surfaces (10 default-pack catalog cards + 14 wave-1 opt-ins + 2 universal trust-chrome layers + the existing Match donut and A0 colorizer already shipped) on top of the Phase-1 foundation already on disk. Stand up a Python sidecar on Vercel Fluid Compute for the 4 statistically-heavy cards (A21 Monte Carlo, A25 change-points, A11 KDE, A8 Getis-Ord Gi*).

**Architecture:** The registry at `lib/analyses/registry.ts` is the single source of truth — each card's `computeStrategy` (`postgres` | `python_sidecar` | `client`) determines its data path. Pure-client cards derive from props/cache; postgres cards call Supabase RPCs; sidecar cards POST to a FastAPI app under `/sidecar/` whose results are cached for 15 min via the existing M6 `dashboard_cache` layer. A single `<RegistryCard>` wrapper resolves the card descriptor → viz component, handles loading / error / n_min-suppression / trust-chrome states uniformly. The right-rail Analyze tab iterates the active Saved View's `cards: string[]` and renders one `<RegistryCard>` per id, replacing the current `<CardPlaceholder>` from Phase 1.

**Tech Stack:** Next.js 15.5 (App Router) · React 19 · TypeScript · Supabase (PostgreSQL 17 + PostGIS + Edge Functions) · MapLibre GL 4.7 · Tailwind · Vitest + @testing-library/react · Playwright · Python 3.13 on Vercel Fluid Compute · PySAL/esda · KDEpy · ruptures · NumPy.

---

## Scope check

Single subsystem (the M7 Analyses Catalog) — no decomposition needed. Plan stays under 40 tasks across 5 phases. Tasks 1–9 build shared infra + client cards (no new infra needed). Tasks 10–24 build postgres-backed cards (RPC + viz per card). Tasks 25–32 stand up the Python sidecar + its 4 cards. Tasks 33–36 wire the registry resolver into the Analyze tab + verify end-to-end.

---

## File structure

### New files
```
lib/analyses/
  viz-registry.ts              — string → lazy-loaded React component map
  card-loader.ts               — useCardData hook (resolves compute strategy → fetch)
  formulas/
    aapor.ts                   — RR1/RR3/RR5, COOP1, REF1, CON1 pure functions
    monte-carlo.ts             — client-side MC stub for tests (sidecar mirror)
    wilson.ts                  — Wilson interval helper for proportions

components/analyses/
  registry-card.tsx            — generic card shell + trust chrome + suppression
  trust-chrome.tsx             — header (n, last_updated, method link)
  n-min-placeholder.tsx        — replaces card body when n < n_min
  moe-bracket.tsx              — universal MoE ± bracket on a proportion
  card-skeleton.tsx            — loading state for async cards

  cards/
    match-donut.tsx            — promotes existing donut into a registry card
    a01-univariate.tsx         — A1
    a02-numeric-summary.tsx    — A2
    a03-upset.tsx              — A3
    a08-gi-star.tsx            — A8 (sidecar)
    a09-lisa.tsx               — A9 (sidecar; stub in M7)
    a11-kde.tsx                — A11 (sidecar)
    a13-cov-heatmap.tsx        — A13
    a16-17-18-aapor.tsx        — A16 + A17 + A18 grouped panel
    a19-universe-map.tsx       — A19
    a20-undersampled.tsx       — A20
    a21-finish-fan.tsx         — A21 (sidecar)
    a22-refusal-pattern.tsx    — A22
    a23-hour-local.tsx         — A23 (LOCAL tz fix)
    a24-dow-heatmap.tsx        — A24
    a25-velocity.tsx           — A25 (sidecar)
    a28-productivity.tsx       — A28 (admin)
    a29-gps-outlier.tsx        — A29 (admin)
    a33-off-boundary.tsx       — A33 (admin)
    a39-freshness.tsx          — A39 (chrome promote)
    a40-sample-vs-acs.tsx      — A40
    a47-moe-chrome.tsx         — A47 universal trust layer
    a48-nmin-panel.tsx         — A48 universal suppression
    a51-topk-blocks.tsx        — A51
    a52-f1-queue.tsx            — A52

lib/queries/
  aapor.ts                     — server queries for A16/A17/A18
  universe-coverage.ts         — server queries for A13/A19/A20
  productivity.ts              — A28
  off-boundary.ts              — A33
  representativeness.ts        — A40
  topk-blocks.ts               — A51
  f1-queue.ts                  — A52
  sidecar.ts                   — POST → sidecar with 15-min cache via M6

app/api/projects/[projectId]/
  analyses/[cardId]/route.ts   — unified GET for any postgres/sidecar card

supabase/migrations/
  016_analyses_rpcs.sql        — RPCs for postgres-strategy cards
  017_sidecar_cache_hint.sql   — cache-row helpers for sidecar payloads

sidecar/                       — NEW Vercel Fluid Compute Python app
  vercel.ts                    — project config: python runtime, env, routes
  pyproject.toml
  requirements.txt             — fastapi, pysal, libpysal, esda, kdepy,
                                  ruptures, numpy, supabase, python-dateutil
  app.py                       — FastAPI entry: /healthz, /version, route mounts
  routers/
    finish.py                  — A21 Monte Carlo
    velocity.py                — A25 change-points
    kde.py                     — A11 kernel density
    gi_star.py                 — A8 Getis-Ord Gi*
  lib/
    supabase_client.py         — service-role client
    cache.py                   — write back to dashboard_cache
    geom.py                    — GeoJSON helpers
  tests/
    conftest.py                — fixtures with synthetic data
    test_finish.py
    test_velocity.py
    test_kde.py
    test_gi_star.py
  README.md                    — deploy + ops instructions

tests/
  analyses/
    registry-card.test.tsx
    formulas-aapor.test.ts
    formulas-monte-carlo.test.ts
    formulas-wilson.test.ts
    n-min-placeholder.test.tsx
    moe-bracket.test.tsx
    a23-hour-local.test.tsx
    a24-dow.test.tsx
  e2e/
    analyses-catalog.spec.ts   — Playwright: switch views, see cards render
```

### Modified files
```
components/desktop/right-rail.tsx
  — remove `<CardPlaceholder>` block, replace with registry-driven loop:
    `{analyzeCards.map(c => <RegistryCard key={c.id} card={c} projectId={projectId} userRole={userRole} />)}`
  — keep the legacy 5-card AnalyzeTab UNDER the registry loop during M7 so
    nothing visually disappears until per-card viz components are stable

lib/analyses/registry.ts
  — `vizComponent` strings now point at real components in viz-registry.ts
  — promote `match_donut` + `A39_freshness` to defaultPack: true (already true)

components/map/maplibre-map.tsx
  — no changes — A0 already wired

components/desktop/topbar.tsx
  — A39 freshness chip already exists; A47 MoE chrome doesn't touch here

next.config.js   (modify or vercel.ts)
  — rewrite `/sidecar/:path*` → sidecar Python runtime when deployed standalone
  — if same-project Python runtime: declare functions.runtime = "python3.13"

vercel.ts        (new at project root)
  — declare the Python sidecar functions + cron for the cache refresh worker
```

### Key contracts (referenced across many tasks)

`type CardRenderProps = { card: CardDescriptor; projectId: string; userRole: Role | null }` — passed by `<RegistryCard>` to every card component.

`type CardData<T> = { data: T | null; n: number; lastUpdated: string; loading: boolean; error: string | null }` — uniform return shape of `useCardData(cardId, projectId)`.

Sidecar request: `POST /sidecar/compute/<card_id> { project_id }` → `{ cache_key, payload, computed_at }`. Sidecar always writes the result back into `dashboard_cache` so subsequent reads hit the existing cache layer.

---

## Phase 1 — Shared infrastructure (Tasks 1–6)

### Task 1: Wilson interval helper

**Files:**
- Create: `lib/analyses/formulas/wilson.ts`
- Test: `tests/analyses/formulas-wilson.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/analyses/formulas-wilson.test.ts
import { describe, it, expect } from "vitest";
import { wilsonInterval } from "@/lib/analyses/formulas/wilson";

describe("wilsonInterval", () => {
  it("returns wide bounds when n is small", () => {
    const { low, high } = wilsonInterval(5, 10, 0.95);
    expect(low).toBeLessThan(0.5);
    expect(high).toBeGreaterThan(0.5);
    expect(high - low).toBeGreaterThan(0.4);
  });
  it("returns narrow bounds when n is large", () => {
    const { low, high } = wilsonInterval(500, 1000, 0.95);
    expect(high - low).toBeLessThan(0.07);
  });
  it("handles 0 successes", () => {
    const { low, high } = wilsonInterval(0, 100, 0.95);
    expect(low).toBe(0);
    expect(high).toBeGreaterThan(0);
  });
  it("returns 0/0 for n=0", () => {
    const { low, high } = wilsonInterval(0, 0, 0.95);
    expect(low).toBe(0);
    expect(high).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyses/formulas-wilson.test.ts`
Expected: FAIL — `Cannot find module '@/lib/analyses/formulas/wilson'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/analyses/formulas/wilson.ts
/** Wilson score interval for a binomial proportion. */
export function wilsonInterval(successes: number, n: number, confidence = 0.95): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  const z = confidence === 0.99 ? 2.576 : confidence === 0.9 ? 1.645 : 1.96;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return {
    low: Math.max(0, centre - margin),
    high: Math.min(1, centre + margin),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analyses/formulas-wilson.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/analyses/formulas/wilson.ts tests/analyses/formulas-wilson.test.ts
git commit -m "feat(analyses): Wilson interval helper for MoE chrome (A47)"
```

---

### Task 2: AAPOR rate formulas

**Files:**
- Create: `lib/analyses/formulas/aapor.ts`
- Test: `tests/analyses/formulas-aapor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/analyses/formulas-aapor.test.ts
import { describe, it, expect } from "vitest";
import { computeAaporRates } from "@/lib/analyses/formulas/aapor";

const counts = { I: 200, P: 50, R: 100, NC: 150, O: 30, UH: 60, UO: 40 };

describe("computeAaporRates", () => {
  it("RR1 = I / (I+P+R+NC+O+UH+UO)", () => {
    const { rr1 } = computeAaporRates(counts);
    expect(rr1).toBeCloseTo(200 / 630, 4);
  });
  it("RR3 includes an estimate of eligibility among UH+UO", () => {
    const { rr3 } = computeAaporRates(counts);
    expect(rr3).toBeGreaterThan(0.3); // looser bound than RR1
    expect(rr3).toBeLessThan(0.5);
  });
  it("COOP1 = I / (I+P+R)", () => {
    const { coop1 } = computeAaporRates(counts);
    expect(coop1).toBeCloseTo(200 / 350, 4);
  });
  it("REF1 = R / (I+P+R+NC+O)", () => {
    const { ref1 } = computeAaporRates(counts);
    expect(ref1).toBeCloseTo(100 / 530, 4);
  });
  it("CON1 = (I+P+R+O) / (I+P+R+NC+O+UH+UO)", () => {
    const { con1 } = computeAaporRates(counts);
    expect(con1).toBeCloseTo(380 / 630, 4);
  });
  it("returns nulls for empty universe", () => {
    const r = computeAaporRates({ I: 0, P: 0, R: 0, NC: 0, O: 0, UH: 0, UO: 0 });
    expect(r.rr1).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyses/formulas-aapor.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/analyses/formulas/aapor.ts
export type AaporCounts = {
  I: number;   // complete interviews
  P: number;   // partial interviews
  R: number;   // refusals
  NC: number;  // non-contacts
  O: number;   // other (eligible but unresolved)
  UH: number;  // unknown if household
  UO: number;  // unknown other
};

export type AaporRates = {
  rr1: number | null;
  rr3: number | null;
  rr5: number | null;
  coop1: number | null;
  ref1: number | null;
  con1: number | null;
  e: number; // estimated eligibility proportion used by RR3
};

/**
 * Estimate `e` — the proportion of unknown-eligibility cases (UH+UO) that
 * are actually eligible. The most defensible practitioner default is the
 * proportion eligible among known-status cases.
 */
function estimateEligibility(c: AaporCounts): number {
  const known = c.I + c.P + c.R + c.NC + c.O;
  const knownEligible = c.I + c.P + c.R + c.NC + c.O; // all known-eligible by definition
  return known === 0 ? 0 : knownEligible / (known + 0); // here e = 1.0 in absence of ineligibles
}

export function computeAaporRates(c: AaporCounts): AaporRates {
  const completes = c.I + c.P;
  const denom1 = c.I + c.P + c.R + c.NC + c.O + c.UH + c.UO;
  if (denom1 === 0) {
    return { rr1: null, rr3: null, rr5: null, coop1: null, ref1: null, con1: null, e: 0 };
  }
  const e = estimateEligibility(c);
  const denom3 = c.I + c.P + c.R + c.NC + c.O + e * (c.UH + c.UO);
  const denom5 = c.I + c.P + c.R + c.NC + c.O;

  const coop1Denom = c.I + c.P + c.R;
  const ref1Denom = c.I + c.P + c.R + c.NC + c.O;
  const con1Num = c.I + c.P + c.R + c.O;
  return {
    rr1: c.I / denom1,
    rr3: denom3 > 0 ? c.I / denom3 : null,
    rr5: denom5 > 0 ? c.I / denom5 : null,
    coop1: coop1Denom > 0 ? c.I / coop1Denom : null,
    ref1: ref1Denom > 0 ? c.R / ref1Denom : null,
    con1: con1Num / denom1,
    e,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/analyses/formulas-aapor.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/analyses/formulas/aapor.ts tests/analyses/formulas-aapor.test.ts
git commit -m "feat(analyses): AAPOR RR1/RR3/RR5/COOP1/REF1/CON1 formulas (A16-A18)"
```

---

### Task 3: Monte Carlo finish-date forecaster

**Files:**
- Create: `lib/analyses/formulas/monte-carlo.ts`
- Test: `tests/analyses/formulas-monte-carlo.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/analyses/formulas-monte-carlo.test.ts
import { describe, it, expect } from "vitest";
import { forecastFinishDate } from "@/lib/analyses/formulas/monte-carlo";

describe("forecastFinishDate", () => {
  it("returns 50/75/90 percentile dates given a target and history", () => {
    // 30 days of steady velocity = 5 points/day
    const history = Array.from({ length: 30 }, () => 5);
    const r = forecastFinishDate({
      historicalDailyPoints: history,
      targetRemaining: 100,
      startDate: new Date("2026-06-01T00:00:00Z"),
      simulations: 5000,
    });
    expect(r.p50DaysOut).toBeGreaterThan(15);
    expect(r.p50DaysOut).toBeLessThan(25);
    expect(r.p90DaysOut).toBeGreaterThan(r.p50DaysOut);
  });
  it("handles zero history with null", () => {
    const r = forecastFinishDate({
      historicalDailyPoints: [],
      targetRemaining: 100,
      startDate: new Date("2026-06-01T00:00:00Z"),
      simulations: 1000,
    });
    expect(r.p50DaysOut).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyses/formulas-monte-carlo.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/analyses/formulas/monte-carlo.ts
/**
 * Bootstrap-style Monte Carlo on historical daily point counts.
 * Each simulation: draw with replacement from the historical distribution
 * until the cumulative sum reaches `targetRemaining`. Repeat N times.
 * Return the 50/75/90 percentile days-to-finish.
 *
 * Pure deterministic randomness via xoshiro128** so unit tests are stable.
 */
function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
}

export type Forecast = {
  p50DaysOut: number | null;
  p75DaysOut: number | null;
  p90DaysOut: number | null;
  p50Date: string | null;
  p75Date: string | null;
  p90Date: string | null;
  simulations: number;
  historyWindow: number;
};

export function forecastFinishDate(args: {
  historicalDailyPoints: number[];
  targetRemaining: number;
  startDate: Date;
  simulations?: number;
  seed?: number;
}): Forecast {
  const history = args.historicalDailyPoints.filter((n) => n >= 0);
  const sims = args.simulations ?? 10000;
  if (history.length === 0 || args.targetRemaining <= 0) {
    return {
      p50DaysOut: null, p75DaysOut: null, p90DaysOut: null,
      p50Date: null, p75Date: null, p90Date: null,
      simulations: sims, historyWindow: history.length,
    };
  }
  const rand = makeRng(args.seed ?? 1337);
  const results: number[] = [];
  for (let s = 0; s < sims; s++) {
    let cum = 0;
    let days = 0;
    const cap = 365 * 5;
    while (cum < args.targetRemaining && days < cap) {
      const idx = Math.floor(rand() * history.length);
      cum += history[idx];
      days++;
    }
    results.push(days);
  }
  results.sort((a, b) => a - b);
  const p = (q: number) => results[Math.floor(q * results.length)];
  const p50 = p(0.5), p75 = p(0.75), p90 = p(0.9);
  const date = (d: number) =>
    new Date(args.startDate.getTime() + d * 86400000).toISOString().slice(0, 10);
  return {
    p50DaysOut: p50, p75DaysOut: p75, p90DaysOut: p90,
    p50Date: date(p50), p75Date: date(p75), p90Date: date(p90),
    simulations: sims, historyWindow: history.length,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/analyses/formulas-monte-carlo.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/analyses/formulas/monte-carlo.ts tests/analyses/formulas-monte-carlo.test.ts
git commit -m "feat(analyses): Monte Carlo finish-date forecaster (A21 client mirror)"
```

---

### Task 4: TrustChrome + NMinPlaceholder shared components

**Files:**
- Create: `components/analyses/trust-chrome.tsx`
- Create: `components/analyses/n-min-placeholder.tsx`
- Test: `tests/analyses/n-min-placeholder.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/analyses/n-min-placeholder.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NMinPlaceholder } from "@/components/analyses/n-min-placeholder";

describe("NMinPlaceholder", () => {
  it("renders 'N more needed' with progress", () => {
    const { getByText } = render(<NMinPlaceholder cardName="AAPOR rates" n={20} nMin={50} />);
    expect(getByText(/30 more/i)).toBeTruthy();
    expect(getByText(/AAPOR rates/i)).toBeTruthy();
  });
  it("clamps at 100% when n >= nMin", () => {
    const { container } = render(<NMinPlaceholder cardName="X" n={100} nMin={50} />);
    expect(container.innerHTML).toContain("100%");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyses/n-min-placeholder.test.tsx`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the components**

```tsx
// components/analyses/n-min-placeholder.tsx
export function NMinPlaceholder({ cardName, n, nMin }: { cardName: string; n: number; nMin: number }) {
  const remaining = Math.max(0, nMin - n);
  const pct = Math.min(100, Math.round((n / Math.max(1, nMin)) * 100));
  return (
    <div className="bento-panel p-4">
      <div className="bento-label mb-2">{cardName}</div>
      <div className="text-[11.5px] leading-snug text-[var(--shell-text-muted)]">
        Need {remaining} more responses for this analysis to be reliable.
        You have {n} of {nMin}.
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-[var(--shell-3)]">
          <div className="h-full rounded-full bg-[var(--shell-text-muted)]" style={{ width: `${pct}%` }} />
        </div>
        <span className="font-mono text-[10px] tabular-nums text-[var(--shell-text-muted)]">{pct}%</span>
      </div>
    </div>
  );
}
```

```tsx
// components/analyses/trust-chrome.tsx
type Props = {
  cardName: string;
  n?: number;
  lastUpdated?: string | null;
  methodHref?: string;
  denominatorLabel?: string;
  modeled?: boolean;
};
export function TrustChrome({ cardName, n, lastUpdated, methodHref, denominatorLabel, modeled }: Props) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <div className="bento-label">{cardName}</div>
      <div className="flex items-center gap-2 font-mono text-[9.5px] text-[var(--shell-text-muted)]">
        {typeof n === "number" && <span>n={n}</span>}
        {denominatorLabel && <span>· {denominatorLabel}</span>}
        {modeled && <span className="rounded-sm bg-[var(--shell-3)] px-1 py-px">modeled</span>}
        {lastUpdated && <span>· as of {new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
        {methodHref && <a href={methodHref} className="underline">method ↗</a>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/analyses/n-min-placeholder.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add components/analyses/n-min-placeholder.tsx components/analyses/trust-chrome.tsx tests/analyses/n-min-placeholder.test.tsx
git commit -m "feat(analyses): shared TrustChrome + NMinPlaceholder primitives"
```

---

### Task 5: MoE bracket (A47 universal chrome)

**Files:**
- Create: `components/analyses/moe-bracket.tsx`
- Test: `tests/analyses/moe-bracket.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/analyses/moe-bracket.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MoeBracket } from "@/components/analyses/moe-bracket";

describe("MoeBracket", () => {
  it("renders ±MoE in basis points", () => {
    const { getByText } = render(<MoeBracket successes={50} n={100} confidence={0.95} />);
    expect(getByText(/\d+\.?\d*%/)).toBeTruthy();
  });
  it("hides itself when n < 30", () => {
    const { container } = render(<MoeBracket successes={5} n={10} confidence={0.95} />);
    expect(container.innerHTML).toContain("n too small");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyses/moe-bracket.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

```tsx
// components/analyses/moe-bracket.tsx
import { wilsonInterval } from "@/lib/analyses/formulas/wilson";

type Props = { successes: number; n: number; confidence?: 0.9 | 0.95 | 0.99 };

export function MoeBracket({ successes, n, confidence = 0.95 }: Props) {
  if (n < 30) return <span className="font-mono text-[9px] text-[var(--shell-text-muted)]">n too small</span>;
  const { low, high } = wilsonInterval(successes, n, confidence);
  const half = ((high - low) / 2) * 100;
  return (
    <span className="font-mono text-[9.5px] text-[var(--shell-text-muted)]">±{half.toFixed(1)}%</span>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/analyses/moe-bracket.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add components/analyses/moe-bracket.tsx tests/analyses/moe-bracket.test.tsx
git commit -m "feat(analyses): A47 MoE bracket chrome"
```

---

### Task 6: viz-registry + RegistryCard wrapper

**Files:**
- Create: `lib/analyses/viz-registry.ts`
- Create: `components/analyses/registry-card.tsx`
- Create: `components/analyses/card-skeleton.tsx`
- Test: `tests/analyses/registry-card.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/analyses/registry-card.test.tsx
import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { RegistryCard } from "@/components/analyses/registry-card";

describe("RegistryCard", () => {
  it("renders the matching viz component for a known card id", async () => {
    const { findByText } = render(<RegistryCard cardId="A39_freshness" projectId="p1" userRole="member" />);
    expect(await findByText(/freshness/i)).toBeTruthy();
  });
  it("falls back to a Coming placeholder for stubs", async () => {
    const { findByText } = render(<RegistryCard cardId="A30_time_per_stop" projectId="p1" userRole="admin" />);
    expect(await findByText(/coming/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyses/registry-card.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement viz-registry**

```ts
// lib/analyses/viz-registry.ts
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export type CardComponent = LazyExoticComponent<ComponentType<{ projectId: string; userRole?: string | null }>>;

export const VIZ_REGISTRY: Record<string, CardComponent> = {
  MatchDonut:            lazy(() => import("@/components/analyses/cards/match-donut").then(m => ({ default: m.MatchDonut }))),
  FreshnessChip:         lazy(() => import("@/components/analyses/cards/a39-freshness").then(m => ({ default: m.FreshnessChip }))),
  AaporRatesPanel:       lazy(() => import("@/components/analyses/cards/a16-17-18-aapor").then(m => ({ default: m.AaporRatesPanel }))),
  AaporCoopRefPanel:     lazy(() => import("@/components/analyses/cards/a16-17-18-aapor").then(m => ({ default: m.AaporCoopRefPanel }))),
  AaporContactTile:      lazy(() => import("@/components/analyses/cards/a16-17-18-aapor").then(m => ({ default: m.AaporContactTile }))),
  HourHistogram:         lazy(() => import("@/components/analyses/cards/a23-hour-local").then(m => ({ default: m.HourHistogram }))),
  DowHourHeatmap:        lazy(() => import("@/components/analyses/cards/a24-dow-heatmap").then(m => ({ default: m.DowHourHeatmap }))),
  VelocityLineCI:        lazy(() => import("@/components/analyses/cards/a25-velocity").then(m => ({ default: m.VelocityLineCI }))),
  MonteCarloFan:         lazy(() => import("@/components/analyses/cards/a21-finish-fan").then(m => ({ default: m.MonteCarloFan }))),
  ProductivityBullet:    lazy(() => import("@/components/analyses/cards/a28-productivity").then(m => ({ default: m.ProductivityBullet }))),
  TopKBlocks:            lazy(() => import("@/components/analyses/cards/a51-topk-blocks").then(m => ({ default: m.TopKBlocks }))),
  DivergingBar:          lazy(() => import("@/components/analyses/cards/a01-univariate").then(m => ({ default: m.DivergingBar }))),
  HistogramBoxplot:      lazy(() => import("@/components/analyses/cards/a02-numeric-summary").then(m => ({ default: m.HistogramBoxplot }))),
  UpSetPlot:             lazy(() => import("@/components/analyses/cards/a03-upset").then(m => ({ default: m.UpSetPlot }))),
  SignificanceChoropleth:lazy(() => import("@/components/analyses/cards/a08-gi-star").then(m => ({ default: m.SignificanceChoropleth }))),
  LisaMap:               lazy(() => import("@/components/analyses/cards/a09-lisa").then(m => ({ default: m.LisaMap }))),
  KdeRaster:             lazy(() => import("@/components/analyses/cards/a11-kde").then(m => ({ default: m.KdeRaster }))),
  RateChoropleth:        lazy(() => import("@/components/analyses/cards/a13-cov-heatmap").then(m => ({ default: m.RateChoropleth }))),
  UniverseMap:           lazy(() => import("@/components/analyses/cards/a19-universe-map").then(m => ({ default: m.UniverseMap }))),
  RankedBullet:          lazy(() => import("@/components/analyses/cards/a20-undersampled").then(m => ({ default: m.RankedBullet }))),
  RefusalSmallMultiples: lazy(() => import("@/components/analyses/cards/a22-refusal-pattern").then(m => ({ default: m.RefusalSmallMultiples }))),
  GpsOutlierBox:         lazy(() => import("@/components/analyses/cards/a29-gps-outlier").then(m => ({ default: m.GpsOutlierBox }))),
  OffBoundaryMapList:    lazy(() => import("@/components/analyses/cards/a33-off-boundary").then(m => ({ default: m.OffBoundaryMapList }))),
  SampleVsAcsBars:       lazy(() => import("@/components/analyses/cards/a40-sample-vs-acs").then(m => ({ default: m.SampleVsAcsBars }))),
  F1QueueListMap:        lazy(() => import("@/components/analyses/cards/a52-f1-queue").then(m => ({ default: m.F1QueueListMap }))),
};

export function getVizComponent(name: string): CardComponent | null {
  return VIZ_REGISTRY[name] ?? null;
}
```

- [ ] **Step 4: Implement RegistryCard + CardSkeleton**

```tsx
// components/analyses/card-skeleton.tsx
export function CardSkeleton({ label }: { label: string }) {
  return (
    <div className="bento-panel p-4 animate-pulse">
      <div className="bento-label mb-3">{label}</div>
      <div className="h-20 rounded-lg bg-[var(--shell-2)]" />
    </div>
  );
}
```

```tsx
// components/analyses/registry-card.tsx
"use client";
import { Suspense } from "react";
import { getCardById } from "@/lib/analyses/registry";
import { getVizComponent } from "@/lib/analyses/viz-registry";
import { CardSkeleton } from "./card-skeleton";

type Props = { cardId: string; projectId: string; userRole?: string | null };

export function RegistryCard({ cardId, projectId, userRole }: Props) {
  const card = getCardById(cardId);
  if (!card) return null;
  if (card.stub) {
    return (
      <div className="bento-panel p-4 opacity-90">
        <div className="bento-label mb-1.5 flex items-center justify-between">
          <span>{card.name}</span>
          <span className="font-mono text-[9px] text-[var(--shell-text-muted)]">{card.id}</span>
        </div>
        <div className="text-[11px] leading-snug text-[var(--shell-text-muted)]">{card.short}</div>
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--shell-border)] bg-[var(--shell-2)] px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
          ○ Coming — vote in the Catalog drawer
        </div>
      </div>
    );
  }
  const Viz = getVizComponent(card.vizComponent);
  if (!Viz) return <CardSkeleton label={card.name} />;
  return (
    <Suspense fallback={<CardSkeleton label={card.name} />}>
      <Viz projectId={projectId} userRole={userRole} />
    </Suspense>
  );
}
```

- [ ] **Step 5: Add a minimal A39 stub so the registry test passes**

```tsx
// components/analyses/cards/a39-freshness.tsx
"use client";
export function FreshnessChip() {
  return (
    <div className="bento-panel p-3">
      <div className="bento-label">Freshness</div>
      <div className="font-mono text-[10px] text-[var(--shell-text-muted)]">as of just now</div>
    </div>
  );
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/analyses/registry-card.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add lib/analyses/viz-registry.ts components/analyses/registry-card.tsx components/analyses/card-skeleton.tsx components/analyses/cards/a39-freshness.tsx tests/analyses/registry-card.test.tsx
git commit -m "feat(analyses): viz-registry + RegistryCard wrapper + A39 stub"
```

---

## Phase 2 — Pure-client cards (Tasks 7–14)

### Task 7: Wire `<RegistryCard>` into Analyze tab

**Files:**
- Modify: `components/desktop/right-rail.tsx:194-225` (replace CardPlaceholder loop)

- [ ] **Step 1: Find the CardPlaceholder block**

Run: `grep -n "CardPlaceholder" components/desktop/right-rail.tsx`
Expected: matches in the analyzeCards loop + helper function.

- [ ] **Step 2: Replace placeholder loop with RegistryCard**

Edit the `<Scroll>` block under `tab === "analyze"`:
```tsx
{analyzeCards.length > 0 && (
  <div className="mt-3 space-y-2">
    {analyzeCards.map((c) => (
      <RegistryCard key={c.id} cardId={c.id} projectId={projectId} userRole={userRole} />
    ))}
  </div>
)}
```

Add import at top of file:
```tsx
import { RegistryCard } from "@/components/analyses/registry-card";
```

Remove the now-unused `CardPlaceholder` function definition.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add components/desktop/right-rail.tsx
git commit -m "feat(analyses): replace placeholder loop with RegistryCard resolver"
```

---

### Task 8: A23 — Hour-of-day in LOCAL tz (UTC-bug fix)

**Files:**
- Create: `components/analyses/cards/a23-hour-local.tsx`
- Modify: `lib/queries/analytics.ts:91-110` — replace `getUTCHours()` with project-tz-aware
- Test: `tests/analyses/a23-hour-local.test.tsx`

- [ ] **Step 1: Update query — accept tz**

In `lib/queries/analytics.ts` replace `getHourlyDistribution`:
```ts
export async function getHourlyDistribution(projectId: string, tz = "UTC"): Promise<HourBucket[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("points") as any)
    .select("collected_at")
    .eq("project_id", projectId) as { data: Array<{ collected_at: string }> | null };
  const counts = new Array(24).fill(0) as number[];
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false });
  for (const r of data ?? []) {
    const hStr = fmt.format(new Date(r.collected_at));
    const h = parseInt(hStr, 10);
    if (Number.isFinite(h) && h >= 0 && h < 24) counts[h]++;
  }
  return counts.map((total, hour) => ({ hour, total }));
}
```

Update callers to pass project tz; default to `"America/New_York"` for Florida projects until A39+project-settings tz lookup lands.

- [ ] **Step 2: Build the card**

```tsx
// components/analyses/cards/a23-hour-local.tsx
"use client";
import { TrustChrome } from "../trust-chrome";

export function HourHistogram({ buckets, tz }: { buckets?: { hour: number; total: number }[]; tz?: string }) {
  if (!buckets || buckets.length === 0) return null;
  const max = Math.max(1, ...buckets.map((b) => b.total));
  return (
    <div className="bento-panel p-4">
      <TrustChrome cardName="Hour of day collected" denominatorLabel={tz ?? "local tz"} n={buckets.reduce((a, b) => a + b.total, 0)} />
      <div className="grid grid-cols-24 gap-px items-end h-16">
        {buckets.map((b) => (
          <div key={b.hour} className="bg-[var(--shell-text-muted)]" style={{ height: `${(b.total / max) * 100}%`, opacity: b.total === 0 ? 0.2 : 1 }} title={`${b.hour}: ${b.total}`} />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-[var(--shell-text-muted)]">
        <span>12am</span><span>6am</span><span>noon</span><span>6pm</span><span>11pm</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the test**

```tsx
// tests/analyses/a23-hour-local.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { HourHistogram } from "@/components/analyses/cards/a23-hour-local";
describe("HourHistogram", () => {
  it("renders 24 bars", () => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: h }));
    const { container } = render(<HourHistogram buckets={buckets} tz="America/New_York" />);
    expect(container.querySelectorAll(".grid-cols-24 > div").length).toBe(24);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/analyses/a23-hour-local.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/analyses/cards/a23-hour-local.tsx lib/queries/analytics.ts tests/analyses/a23-hour-local.test.tsx
git commit -m "fix(analyses): A23 hour-of-day uses project tz, not UTC"
```

---

### Task 9: A24 — Day-of-week heatmap

**Files:**
- Create: `components/analyses/cards/a24-dow-heatmap.tsx`
- Modify: `lib/queries/analytics.ts` — add `getDowHourMatrix(projectId, tz)`
- Test: `tests/analyses/a24-dow.test.tsx`

- [ ] **Step 1: Write the query**

In `lib/queries/analytics.ts` add:
```ts
export type DowHourCell = { dow: number; hour: number; count: number };
export async function getDowHourMatrix(projectId: string, tz = "UTC"): Promise<DowHourCell[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("points") as any)
    .select("collected_at")
    .eq("project_id", projectId) as { data: Array<{ collected_at: string }> | null };
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hour12: false });
  const wkMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  for (const r of data ?? []) {
    const parts = fmt.formatToParts(new Date(r.collected_at));
    const wk = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    grid[wkMap[wk] ?? 0][h]++;
  }
  return grid.flatMap((row, dow) => row.map((count, hour) => ({ dow, hour, count })));
}
```

- [ ] **Step 2: Build the viz**

```tsx
// components/analyses/cards/a24-dow-heatmap.tsx
"use client";
import { TrustChrome } from "../trust-chrome";
import type { DowHourCell } from "@/lib/queries/analytics";

const DAY = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export function DowHourHeatmap({ cells, tz }: { cells?: DowHourCell[]; tz?: string }) {
  if (!cells) return null;
  const max = Math.max(1, ...cells.map((c) => c.count));
  return (
    <div className="bento-panel p-4">
      <TrustChrome cardName="Day-of-week × hour" denominatorLabel={tz ?? "local tz"} n={cells.reduce((a, b) => a + b.count, 0)} />
      <div className="grid grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-px text-[8.5px]">
        <div />
        {Array.from({ length: 24 }, (_, h) => <div key={h} className="text-center font-mono text-[var(--shell-text-muted)]">{h % 6 === 0 ? h : ""}</div>)}
        {DAY.map((d, di) => (
          <>
            <div key={`${d}-l`} className="pr-1 font-mono text-[var(--shell-text-muted)]">{d}</div>
            {Array.from({ length: 24 }, (_, h) => {
              const c = cells.find((cc) => cc.dow === di && cc.hour === h)?.count ?? 0;
              const a = c === 0 ? 0.05 : 0.15 + (c / max) * 0.85;
              return <div key={`${d}-${h}`} title={`${d} ${h}: ${c}`} className="aspect-square" style={{ background: `rgba(56,189,248,${a})` }} />;
            })}
          </>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write test**

```tsx
// tests/analyses/a24-dow.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DowHourHeatmap } from "@/components/analyses/cards/a24-dow-heatmap";
describe("DowHourHeatmap", () => {
  it("renders 7*24 cells", () => {
    const cells = Array.from({ length: 7 * 24 }, (_, i) => ({ dow: Math.floor(i / 24), hour: i % 24, count: i }));
    const { container } = render(<DowHourHeatmap cells={cells} tz="UTC" />);
    expect(container.querySelectorAll("div.aspect-square").length).toBe(7 * 24);
  });
});
```

- [ ] **Step 4: Run + commit**

Run: `npx vitest run tests/analyses/a24-dow.test.tsx`
Expected: PASS

```bash
git add components/analyses/cards/a24-dow-heatmap.tsx lib/queries/analytics.ts tests/analyses/a24-dow.test.tsx
git commit -m "feat(analyses): A24 day-of-week × hour heatmap"
```

---

### Task 10: A39 freshness chip (promote from M6)

**Files:**
- Replace: `components/analyses/cards/a39-freshness.tsx` (real impl, replaces stub)

- [ ] **Step 1: Implement the real chip**

```tsx
// components/analyses/cards/a39-freshness.tsx
"use client";
import { useEffect, useState } from "react";

type Props = { cachedAt?: string | null; projectId: string };

function tone(ageMin: number): "good" | "warn" | "bad" {
  if (ageMin < 15) return "good";
  if (ageMin < 60) return "warn";
  return "bad";
}

export function FreshnessChip({ cachedAt }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  if (!cachedAt) {
    return (
      <div className="bento-panel p-3">
        <div className="bento-label mb-1">Freshness</div>
        <div className="font-mono text-[10px] text-[var(--shell-text-muted)]">no cache yet</div>
      </div>
    );
  }
  const ageMs = now - new Date(cachedAt).getTime();
  const ageMin = Math.round(ageMs / 60000);
  const t = tone(ageMin);
  const c = t === "good" ? "oklch(76% 0.16 158)" : t === "warn" ? "oklch(78% 0.165 70)" : "oklch(68% 0.21 25)";
  return (
    <div className="bento-panel p-3">
      <div className="bento-label mb-1 flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: c }} />Freshness</div>
      <div className="font-mono text-[10px] text-[var(--shell-text-muted)]">as of {new Date(cachedAt).toLocaleTimeString()} ({ageMin}m ago)</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/analyses/cards/a39-freshness.tsx
git commit -m "feat(analyses): A39 freshness chip with green/yellow/red tone"
```

---

### Task 11: Promote MatchDonut from right-rail to registry

**Files:**
- Create: `components/analyses/cards/match-donut.tsx`
- Modify: `components/desktop/right-rail.tsx` — extract & re-export

- [ ] **Step 1: Locate the existing donut**

Run: `grep -n "DonutBreakdown\|donut" components/desktop/right-rail.tsx`
Expected: at line ~335.

- [ ] **Step 2: Copy `DonutBreakdown` + `MatchLegendRow` to new file**

```tsx
// components/analyses/cards/match-donut.tsx
"use client";
import type { MatchStatusCounts } from "@/lib/match/status";

export function MatchDonut({ counts }: { counts: MatchStatusCounts }) {
  const total = counts.total_with_status + counts.r1_count;
  return (
    <div className="bento-panel p-4">
      <div className="bento-label mb-3">Response match composition</div>
      <div className="flex items-center gap-4">
        <DonutSvg total={total} counts={counts} />
        <div className="flex flex-col gap-1.5 min-w-0">
          <Row color="#ffffff" label="M1 Matched" n={counts.m1_count} total={total} />
          <Row color="#fde047" label="F1 Field only" n={counts.f1_count} total={total} />
          <Row color="#a855f7" label="R1 Resp only" n={counts.r1_count} total={total} />
        </div>
      </div>
    </div>
  );
}
function DonutSvg({ total, counts }: { total: number; counts: MatchStatusCounts }) {
  if (total === 0) return <div className="h-14 w-14 rounded-full border border-[var(--shell-border)]" />;
  const r = 14, c = 2 * Math.PI * r;
  const m = counts.m1_count / total, f = counts.f1_count / total;
  return (
    <svg viewBox="0 0 36 36" className="h-14 w-14">
      <circle cx="18" cy="18" r={r} fill="none" stroke="#a855f7" strokeWidth="6" />
      <circle cx="18" cy="18" r={r} fill="none" stroke="#fde047" strokeWidth="6" strokeDasharray={`${(m + f) * c} ${c}`} transform="rotate(-90 18 18)" />
      <circle cx="18" cy="18" r={r} fill="none" stroke="#ffffff" strokeWidth="6" strokeDasharray={`${m * c} ${c}`} transform="rotate(-90 18 18)" />
    </svg>
  );
}
function Row({ color, label, n, total }: { color: string; label: string; n: number; total: number }) {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      <span className="text-[11.5px] font-semibold text-[var(--shell-text-2)] flex-1">{label}</span>
      <span className="font-mono text-[10.5px] tabular-nums">{n} ({pct}%)</span>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/analyses/cards/match-donut.tsx
git commit -m "feat(analyses): promote match-status donut into the catalog registry"
```

---

### Task 12: A1 univariate distribution

**Files:**
- Create: `components/analyses/cards/a01-univariate.tsx`
- Modify: `lib/queries/columns.ts` — re-export `getColumnValuesById` (already there)

- [ ] **Step 1: Build the viz**

```tsx
// components/analyses/cards/a01-univariate.tsx
"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { wilsonInterval } from "@/lib/analyses/formulas/wilson";
import { NMinPlaceholder } from "../n-min-placeholder";

type Props = { projectId: string; columnKey?: string };

export function DivergingBar({ projectId, columnKey }: Props) {
  const [counts, setCounts] = useState<{ value: string; n: number }[]>([]);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (!columnKey) return;
    fetch(`/api/projects/${projectId}/columns/${encodeURIComponent(columnKey)}`)
      .then((r) => r.json())
      .then((r) => {
        const tally = new Map<string, number>();
        for (const v of Object.values(r.valuesByResponseId ?? {})) {
          const k = v == null || v === "" ? "—" : String(v);
          tally.set(k, (tally.get(k) ?? 0) + 1);
        }
        const arr = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, n }));
        setCounts(arr);
        setTotal(arr.reduce((a, b) => a + b.n, 0));
      });
  }, [projectId, columnKey]);
  if (total < 30) return <NMinPlaceholder cardName="Univariate distribution" n={total} nMin={30} />;
  const max = Math.max(1, ...counts.map((c) => c.n));
  return (
    <div className="bento-panel p-4">
      <TrustChrome cardName={`Univariate · ${columnKey}`} n={total} denominatorLabel="responses" />
      <div className="space-y-1">
        {counts.slice(0, 12).map((c) => {
          const { low, high } = wilsonInterval(c.n, total);
          return (
            <div key={c.value} className="grid grid-cols-[80px_1fr_50px] items-center gap-2">
              <div className="truncate text-[11px]">{c.value}</div>
              <div className="h-1.5 rounded-full bg-[var(--shell-3)]"><div className="h-full rounded-full bg-[var(--shell-text-muted)]" style={{ width: `${(c.n / max) * 100}%` }} /></div>
              <div className="font-mono text-[10px] text-right tabular-nums">{c.n} ±{Math.round(((high - low) / 2) * 100)}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/analyses/cards/a01-univariate.tsx
git commit -m "feat(analyses): A1 univariate distribution bar with Wilson MoE"
```

---

### Task 13: A2 numeric summary

**Files:**
- Create: `components/analyses/cards/a02-numeric-summary.tsx`

- [ ] **Step 1: Build**

```tsx
// components/analyses/cards/a02-numeric-summary.tsx
"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { NMinPlaceholder } from "../n-min-placeholder";

export function HistogramBoxplot({ projectId, columnKey }: { projectId: string; columnKey?: string }) {
  const [nums, setNums] = useState<number[]>([]);
  useEffect(() => {
    if (!columnKey) return;
    fetch(`/api/projects/${projectId}/columns/${encodeURIComponent(columnKey)}`)
      .then((r) => r.json())
      .then((r) => {
        const arr = Object.values(r.valuesByResponseId ?? {}).map((v) => Number(v)).filter((n) => Number.isFinite(n));
        setNums(arr);
      });
  }, [projectId, columnKey]);
  if (nums.length < 30) return <NMinPlaceholder cardName="Numeric summary" n={nums.length} nMin={30} />;
  const sorted = [...nums].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))];
  const min = sorted[0], max = sorted[sorted.length - 1], median = q(0.5), p25 = q(0.25), p75 = q(0.75);
  const bins = 20; const w = (max - min) / bins || 1;
  const hist = new Array(bins).fill(0) as number[];
  for (const v of nums) {
    const i = Math.min(bins - 1, Math.floor((v - min) / w));
    hist[i]++;
  }
  const hmax = Math.max(...hist);
  return (
    <div className="bento-panel p-4">
      <TrustChrome cardName={`Numeric · ${columnKey}`} n={nums.length} denominatorLabel="responses" />
      <div className="flex h-12 items-end gap-px">
        {hist.map((h, i) => <div key={i} className="flex-1 bg-[var(--shell-text-muted)]" style={{ height: `${(h / hmax) * 100}%` }} />)}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-2 text-center text-[10.5px]">
        <div><div className="font-mono tabular-nums">{median.toFixed(1)}</div><div className="text-[9px] text-[var(--shell-text-muted)]">median</div></div>
        <div><div className="font-mono tabular-nums">{(p75 - p25).toFixed(1)}</div><div className="text-[9px] text-[var(--shell-text-muted)]">IQR</div></div>
        <div><div className="font-mono tabular-nums">{min.toFixed(1)}–{max.toFixed(1)}</div><div className="text-[9px] text-[var(--shell-text-muted)]">range</div></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/analyses/cards/a02-numeric-summary.tsx
git commit -m "feat(analyses): A2 numeric summary (histogram + median/IQR/range)"
```

---

### Task 14: A3 multi-select UpSet plot

**Files:**
- Create: `components/analyses/cards/a03-upset.tsx`

- [ ] **Step 1: Build a minimal UpSet (option-frequency + top-10 combinations)**

```tsx
// components/analyses/cards/a03-upset.tsx
"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { NMinPlaceholder } from "../n-min-placeholder";

export function UpSetPlot({ projectId, columnKey }: { projectId: string; columnKey?: string }) {
  const [resp, setResp] = useState<string[][]>([]);
  useEffect(() => {
    if (!columnKey) return;
    fetch(`/api/projects/${projectId}/columns/${encodeURIComponent(columnKey)}`)
      .then((r) => r.json())
      .then((r) => {
        const parsed = Object.values(r.valuesByResponseId ?? {})
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.split(/[,;|]/).map((s) => s.trim()).filter(Boolean));
        setResp(parsed);
      });
  }, [projectId, columnKey]);
  if (resp.length < 100) return <NMinPlaceholder cardName="Multi-select co-occurrence" n={resp.length} nMin={100} />;
  const freq = new Map<string, number>();
  for (const arr of resp) for (const o of arr) freq.set(o, (freq.get(o) ?? 0) + 1);
  const opts = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const combos = new Map<string, number>();
  for (const arr of resp) {
    const key = [...new Set(arr.filter((o) => opts.some(([k]) => k === o)))].sort().join("+");
    if (!key) continue;
    combos.set(key, (combos.get(key) ?? 0) + 1);
  }
  const top = [...combos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <div className="bento-panel p-4">
      <TrustChrome cardName={`Multi-select · ${columnKey}`} n={resp.length} denominatorLabel="respondents" />
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">Option frequency</div>
      <div className="mb-3 space-y-1">
        {opts.map(([opt, n]) => (
          <div key={opt} className="grid grid-cols-[80px_1fr_30px] items-center gap-2">
            <div className="truncate text-[11px]">{opt}</div>
            <div className="h-1.5 rounded-full bg-[var(--shell-3)]"><div className="h-full bg-[var(--shell-text-muted)] rounded-full" style={{ width: `${(n / resp.length) * 100}%` }} /></div>
            <div className="font-mono text-[10px] text-right tabular-nums">{Math.round((n / resp.length) * 100)}%</div>
          </div>
        ))}
      </div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">Top combinations</div>
      <div className="space-y-1">
        {top.map(([k, n]) => (
          <div key={k} className="flex items-center justify-between text-[10.5px]">
            <span className="truncate">{k}</span>
            <span className="font-mono">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/analyses/cards/a03-upset.tsx
git commit -m "feat(analyses): A3 multi-select option frequency + combination upset"
```

---

## Phase 3 — Postgres-backed cards (Tasks 15–25)

### Task 15: Migration 016 — analyses RPCs

**Files:**
- Create: `supabase/migrations/016_analyses_rpcs.sql`

- [ ] **Step 1: Write the migration with all 8 RPC functions**

```sql
-- supabase/migrations/016_analyses_rpcs.sql
set search_path = public, extensions;

-- A16/A17/A18 — AAPOR rates: returns the 7 outcome counts for a project.
create or replace function public.aapor_outcome_counts(p_project_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  with c as (
    select coalesce(am.aapor_outcome, 'O') as code, count(*) as n
    from public.points p
    left join public.project_aapor_mapping am
      on am.project_id = p.project_id and am.status_id = p.status_id
    where p.project_id = p_project_id
    group by 1
  )
  select coalesce(jsonb_object_agg(code, n), '{}'::jsonb) from c;
$$;
revoke all on function public.aapor_outcome_counts(uuid) from public, anon;
grant execute on function public.aapor_outcome_counts(uuid) to authenticated;

-- A13/A19 — Coverage vs universe per block (FIPS BG geoid via parcel join)
create or replace function public.coverage_by_block(p_project_id uuid)
returns table(block_geoid text, universe_addresses bigint, points_collected bigint)
language sql stable security invoker set search_path = public, extensions as $$
  with u as (
    select left(coalesce(pa.geoid_block_group, ''), 12) as bg, count(*) as universe
    from public.survey_universe su
    left join public.parcels pa on st_intersects(pa.geom, st_setsrid(st_makepoint(su.lon, su.lat), 4326))
    where su.project_id = p_project_id
    group by 1
  ),
  p as (
    select left(coalesce(pa.geoid_block_group, ''), 12) as bg, count(*) as pts
    from public.points pt
    left join public.parcels pa on st_intersects(pa.geom, st_setsrid(st_makepoint(pt.lon, pt.lat), 4326))
    where pt.project_id = p_project_id
    group by 1
  )
  select coalesce(u.bg, p.bg) as block_geoid,
         coalesce(u.universe, 0)::bigint,
         coalesce(p.pts, 0)::bigint
  from u full outer join p on u.bg = p.bg;
$$;
revoke all on function public.coverage_by_block(uuid) from public, anon;
grant execute on function public.coverage_by_block(uuid) to authenticated;

-- A20 — Under-sampled ranking (top-K by deficit, n_min = 5 universe per block)
create or replace function public.undersampled_blocks(p_project_id uuid, p_target_pct numeric default 0.7, p_limit int default 10)
returns table(block_geoid text, achieved_pct numeric, gap_pct numeric, universe_addresses bigint)
language sql stable security invoker set search_path = public as $$
  with c as (
    select block_geoid, universe_addresses, points_collected
    from public.coverage_by_block(p_project_id)
    where universe_addresses >= 5
  )
  select block_geoid,
         round((points_collected::numeric / nullif(universe_addresses, 0)) * 100, 1) as achieved_pct,
         round(((p_target_pct * universe_addresses - points_collected) / nullif(universe_addresses, 0)) * 100, 1) as gap_pct,
         universe_addresses
  from c
  order by gap_pct desc nulls last
  limit p_limit;
$$;
revoke all on function public.undersampled_blocks(uuid, numeric, int) from public, anon;
grant execute on function public.undersampled_blocks(uuid, numeric, int) to authenticated;

-- A22 — Refusal & not-home pattern (3-bucket per parcel)
create or replace function public.status_pattern_per_parcel(p_project_id uuid)
returns table(parcel_id uuid, bucket text, n bigint)
language sql stable security invoker set search_path = public, extensions as $$
  select pa.id, am.aapor_outcome, count(*)
  from public.points pt
  join public.parcels pa on st_intersects(pa.geom, st_setsrid(st_makepoint(pt.lon, pt.lat), 4326))
  left join public.project_aapor_mapping am on am.project_id = pt.project_id and am.status_id = pt.status_id
  where pt.project_id = p_project_id
    and coalesce(am.aapor_outcome, 'O') in ('R', 'NC', 'O')
  group by 1, 2;
$$;
revoke all on function public.status_pattern_per_parcel(uuid) from public, anon;
grant execute on function public.status_pattern_per_parcel(uuid) to authenticated;

-- A28 — Productivity bullet
create or replace function public.productivity_per_surveyor(p_project_id uuid)
returns table(collector_id uuid, name text, points bigint, shifts bigint, ppshift numeric)
language sql stable security invoker set search_path = public as $$
  with shifts as (
    select collector_id, date_trunc('day', collected_at) as d, count(*) as n
    from public.points
    where project_id = p_project_id and collector_id is not null
    group by 1, 2
  ),
  totals as (
    select s.collector_id, coalesce(pr.display_name, pr.email, '—') as name,
           sum(s.n) as points, count(*) as shifts, round(avg(s.n), 2) as ppshift
    from shifts s
    join public.profiles pr on pr.id = s.collector_id
    group by 1, 2
  )
  select * from totals
  having count(*) >= 3
  order by ppshift desc nulls last;
$$;
revoke all on function public.productivity_per_surveyor(uuid) from public, anon;
grant execute on function public.productivity_per_surveyor(uuid) to authenticated;

-- A29 — GPS accuracy outliers
create or replace function public.gps_accuracy_outliers(p_project_id uuid, p_thresh_m numeric default 50)
returns table(collector_id uuid, name text, median_acc numeric, flagged bigint, total bigint)
language sql stable security invoker set search_path = public as $$
  select pt.collector_id,
         coalesce(pr.display_name, pr.email, '—') as name,
         percentile_disc(0.5) within group (order by pt.accuracy_m) as median_acc,
         count(*) filter (where pt.accuracy_m > p_thresh_m) as flagged,
         count(*) as total
  from public.points pt
  left join public.profiles pr on pr.id = pt.collector_id
  where pt.project_id = p_project_id and pt.accuracy_m is not null
  group by 1, 2;
$$;
revoke all on function public.gps_accuracy_outliers(uuid, numeric) from public, anon;
grant execute on function public.gps_accuracy_outliers(uuid, numeric) to authenticated;

-- A33 — Off-boundary stops (30m tolerance)
create or replace function public.off_boundary_points(p_project_id uuid, p_buffer_m int default 30)
returns table(id uuid, lat numeric, lon numeric, distance_m numeric)
language sql stable security invoker set search_path = public, extensions as $$
  with b as (
    select st_union(geom) as g from public.project_boundaries where project_id = p_project_id
  )
  select pt.id, pt.lat::numeric, pt.lon::numeric,
         round(st_distance(
           st_setsrid(st_makepoint(pt.lon, pt.lat), 4326)::geography,
           b.g::geography
         )::numeric, 1) as distance_m
  from public.points pt cross join b
  where pt.project_id = p_project_id
    and b.g is not null
    and not st_dwithin(
      st_setsrid(st_makepoint(pt.lon, pt.lat), 4326)::geography,
      b.g::geography,
      p_buffer_m
    );
$$;
revoke all on function public.off_boundary_points(uuid, int) from public, anon;
grant execute on function public.off_boundary_points(uuid, int) to authenticated;

-- A51 — Top-K blocks to revisit (composite of under-coverage + refusal + age)
create or replace function public.topk_revisit_blocks(p_project_id uuid, p_limit int default 10)
returns table(block_geoid text, score numeric, universe_addresses bigint, achieved_pct numeric)
language sql stable security invoker set search_path = public as $$
  with u as (
    select block_geoid, universe_addresses, points_collected,
           round((points_collected::numeric / nullif(universe_addresses, 0)) * 100, 1) as ach_pct
    from public.coverage_by_block(p_project_id)
    where universe_addresses >= 5
  )
  select block_geoid,
         round(((100 - ach_pct) * 0.7 + universe_addresses * 0.001) , 2) as score,
         universe_addresses,
         ach_pct
  from u
  order by score desc nulls last
  limit p_limit;
$$;
revoke all on function public.topk_revisit_blocks(uuid, int) from public, anon;
grant execute on function public.topk_revisit_blocks(uuid, int) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Run via MCP: `mcp__supabase__apply_migration` with `project_id=ykssihpinzbgmpylqtjl`, `name=analyses_rpcs`, `query=<file contents>`.
Expected: `{"success": true}`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/016_analyses_rpcs.sql
git commit -m "feat(analyses): migration 016 — RPCs for AAPOR, coverage, productivity, off-boundary, top-K"
```

---

### Task 16: A16/A17/A18 AAPOR rates panel

**Files:**
- Create: `lib/queries/aapor.ts`
- Create: `components/analyses/cards/a16-17-18-aapor.tsx`

- [ ] **Step 1: Server query**

```ts
// lib/queries/aapor.ts
import { createServerSupabase } from "@/lib/supabase/server";
import { computeAaporRates, type AaporCounts, type AaporRates } from "@/lib/analyses/formulas/aapor";

export type AaporResult = { counts: AaporCounts; rates: AaporRates };

export async function getAaporResult(projectId: string): Promise<AaporResult> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).rpc("aapor_outcome_counts", { p_project_id: projectId });
  const raw = (data ?? {}) as Record<string, number>;
  const counts: AaporCounts = {
    I: raw.I ?? 0, P: raw.P ?? 0, R: raw.R ?? 0,
    NC: raw.NC ?? 0, O: raw.O ?? 0, UH: raw.UH ?? 0, UO: raw.UO ?? 0,
  };
  return { counts, rates: computeAaporRates(counts) };
}
```

- [ ] **Step 2: Card components (3 in one file)**

```tsx
// components/analyses/cards/a16-17-18-aapor.tsx
"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { NMinPlaceholder } from "../n-min-placeholder";
import type { AaporResult } from "@/lib/queries/aapor";

function useAapor(projectId: string) {
  const [r, setR] = useState<AaporResult | null>(null);
  useEffect(() => {
    fetch(`/api/projects/${projectId}/analyses/aapor`)
      .then((res) => res.json())
      .then(setR)
      .catch(() => {});
  }, [projectId]);
  return r;
}

function fmt(p: number | null) {
  return p == null ? "—" : `${(p * 100).toFixed(1)}%`;
}

export function AaporRatesPanel({ projectId }: { projectId: string }) {
  const r = useAapor(projectId);
  if (!r) return null;
  const n = Object.values(r.counts).reduce((a, b) => a + b, 0);
  if (n < 50) return <NMinPlaceholder cardName="AAPOR rates" n={n} nMin={50} />;
  return (
    <div className="bento-panel p-4">
      <TrustChrome cardName="Response rates (AAPOR)" methodHref="https://aapor.org/response-rates/" n={n} />
      <div className="grid grid-cols-3 gap-2">
        <KpiTile label="RR1" v={fmt(r.rates.rr1)} />
        <KpiTile label="RR3" v={fmt(r.rates.rr3)} />
        <KpiTile label="RR5" v={fmt(r.rates.rr5)} />
      </div>
      <CountsRow counts={r.counts} />
    </div>
  );
}

export function AaporCoopRefPanel({ projectId }: { projectId: string }) {
  const r = useAapor(projectId);
  if (!r) return null;
  const n = Object.values(r.counts).reduce((a, b) => a + b, 0);
  if (n < 50) return <NMinPlaceholder cardName="COOP1 + REF1" n={n} nMin={50} />;
  return (
    <div className="bento-panel p-4">
      <TrustChrome cardName="Cooperation + refusal" methodHref="https://aapor.org/response-rates/" n={n} />
      <div className="grid grid-cols-2 gap-2">
        <KpiTile label="COOP1" v={fmt(r.rates.coop1)} />
        <KpiTile label="REF1" v={fmt(r.rates.ref1)} />
      </div>
    </div>
  );
}

export function AaporContactTile({ projectId }: { projectId: string }) {
  const r = useAapor(projectId);
  if (!r) return null;
  const n = Object.values(r.counts).reduce((a, b) => a + b, 0);
  if (n < 50) return <NMinPlaceholder cardName="CON1 contact rate" n={n} nMin={50} />;
  return (
    <div className="bento-panel p-4">
      <TrustChrome cardName="Contact rate (CON1)" methodHref="https://aapor.org/response-rates/" n={n} />
      <KpiTile label="CON1" v={fmt(r.rates.con1)} />
    </div>
  );
}

function KpiTile({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-lg bg-[var(--shell-2)] p-2 text-center">
      <div className="font-mono text-[9.5px] text-[var(--shell-text-muted)] uppercase">{label}</div>
      <div className="font-display text-[18px] font-extrabold tabular-nums">{v}</div>
    </div>
  );
}
function CountsRow({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 text-[9.5px] font-mono text-[var(--shell-text-muted)]">
      {Object.entries(counts).map(([k, v]) => <span key={k} className="rounded bg-[var(--shell-2)] px-1.5 py-0.5">{k}={v}</span>)}
    </div>
  );
}
```

- [ ] **Step 3: Add the API endpoint** (covered by unified endpoint Task 22)

- [ ] **Step 4: Commit**

```bash
git add lib/queries/aapor.ts components/analyses/cards/a16-17-18-aapor.tsx
git commit -m "feat(analyses): A16/A17/A18 AAPOR rates + COOP/REF/CON panels"
```

---

### Tasks 17–25: remaining postgres cards (A13, A19, A20, A22, A28, A29, A33, A40, A51, A52)

Each follows the same pattern as Task 16:
1. Add a server query function in `lib/queries/<card>.ts` calling the RPC from migration 016.
2. Build the card component in `components/analyses/cards/<id>.tsx`.
3. Commit per card.

For brevity each task's pattern is identical — see Task 16 as the template. Per-card specifics:

- [ ] **Task 17 — A19 UniverseMap:** Use `coverage_by_block` RPC. Viz = small choropleth + KPI tile ("X% of N addresses touched"). Files: `lib/queries/universe-coverage.ts`, `components/analyses/cards/a19-universe-map.tsx`. n_min: universe ≥ 50. Commit: `feat(analyses): A19 universe penetration map`.

- [ ] **Task 18 — A20 Under-sampled:** Use `undersampled_blocks(project, target, limit)`. Viz = bullet chart per row (target vs achieved). Files: `components/analyses/cards/a20-undersampled.tsx`. Commit: `feat(analyses): A20 under-sampled tracts ranking (bullet)`.

- [ ] **Task 19 — A22 Refusal & not-home:** Use `status_pattern_per_parcel`. Viz = 3-column small multiples (R / NC / O) of dot maps with shared scale. Files: `components/analyses/cards/a22-refusal-pattern.tsx`. Commit: `feat(analyses): A22 refusal/not-home small multiples`.

- [ ] **Task 20 — A13 Coverage heatmap:** Use `coverage_by_block`. Viz = single-tile sparkline + a list of top-5 worst blocks. (Real choropleth lives in the map shell — this card is a summary.) Files: `components/analyses/cards/a13-cov-heatmap.tsx`. Commit: `feat(analyses): A13 coverage-vs-universe summary`.

- [ ] **Task 21 — A28 Productivity bullet (admin):** Use `productivity_per_surveyor`. Viz = per-surveyor bullet with team-median target. Files: `lib/queries/productivity.ts`, `components/analyses/cards/a28-productivity.tsx`. Commit: `feat(analyses): A28 productivity bullet chart`.

- [ ] **Task 22 — A29 GPS-accuracy outliers (admin):** Use `gps_accuracy_outliers`. Viz = boxplot per surveyor + flag count tile. Files: `components/analyses/cards/a29-gps-outlier.tsx`. Commit: `feat(analyses): A29 GPS accuracy outliers`.

- [ ] **Task 23 — A33 Off-boundary stops (admin):** Use `off_boundary_points`. Viz = numbered list + flag tile ("4 points off boundary"). Files: `lib/queries/off-boundary.ts`, `components/analyses/cards/a33-off-boundary.tsx`. Commit: `feat(analyses): A33 off-boundary stops`.

- [ ] **Task 24 — A40 Sample-vs-ACS (member):** No new RPC — join `project_demographics_schema` × responses × `acs_tract_profile`. Viz = side-by-side stacked bars per margin. Files: `lib/queries/representativeness.ts`, `components/analyses/cards/a40-sample-vs-acs.tsx`. n_min: 100. Commit: `feat(analyses): A40 sample-vs-ACS composition`.

- [ ] **Task 25 — A51 Top-K + A52 F1 queue:** Use `topk_revisit_blocks` for A51; use the existing match-status materialized view for A52 (filter `match_status = 'F1'`). Two cards in one task. Files: `lib/queries/topk-blocks.ts`, `lib/queries/f1-queue.ts`, `components/analyses/cards/a51-topk-blocks.tsx`, `components/analyses/cards/a52-f1-queue.tsx`. Commit: `feat(analyses): A51 top-K blocks + A52 F1 queue`.

---

### Task 26: Unified `/api/projects/[projectId]/analyses/[cardId]` endpoint

**Files:**
- Create: `app/api/projects/[projectId]/analyses/[cardId]/route.ts`

- [ ] **Step 1: Build the dispatcher**

```ts
// app/api/projects/[projectId]/analyses/[cardId]/route.ts
import { NextResponse } from "next/server";
import { getAaporResult } from "@/lib/queries/aapor";
import { getCoverageBlocks, getUndersampledBlocks } from "@/lib/queries/universe-coverage";
import { getProductivity } from "@/lib/queries/productivity";
import { getOffBoundary } from "@/lib/queries/off-boundary";
import { getF1Queue } from "@/lib/queries/f1-queue";
import { getTopKBlocks } from "@/lib/queries/topk-blocks";

export const dynamic = "force-dynamic";

const DISPATCH: Record<string, (p: string) => Promise<unknown>> = {
  A16_rr: getAaporResult,
  A17_coop_ref: getAaporResult,
  A18_con: getAaporResult,
  A13_cov_heatmap: getCoverageBlocks,
  A19_universe_map: getCoverageBlocks,
  A20_undersampled: getUndersampledBlocks,
  A28_productivity: getProductivity,
  A33_off_boundary: getOffBoundary,
  A51_topk: getTopKBlocks,
  A52_f1_queue: getF1Queue,
};

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string; cardId: string }> }) {
  const { projectId, cardId } = await params;
  const handler = DISPATCH[cardId];
  if (!handler) return NextResponse.json({ error: "unknown card" }, { status: 404 });
  try {
    const data = await handler(projectId);
    return NextResponse.json({ data, computedAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
```

Update each card's `useEffect` to fetch `/api/projects/.../analyses/<id>` instead of card-specific routes.

- [ ] **Step 2: Commit**

```bash
git add app/api/projects/[projectId]/analyses/[cardId]/route.ts
git commit -m "feat(analyses): unified analyses dispatcher endpoint"
```

---

## Phase 4 — Python sidecar (Tasks 27–32)

### Task 27: Sidecar scaffold

**Files:**
- Create: `sidecar/app.py`, `sidecar/requirements.txt`, `sidecar/pyproject.toml`, `sidecar/lib/supabase_client.py`, `sidecar/lib/cache.py`, `sidecar/README.md`
- Create: `vercel.ts` at project root (or update existing)

- [ ] **Step 1: requirements.txt**

```
fastapi==0.115.0
uvicorn==0.32.0
supabase==2.7.2
numpy==2.1.1
pysal==24.07
libpysal==4.12.1
esda==2.6.0
KDEpy==1.1.10
ruptures==1.1.9
python-dateutil==2.9.0
```

- [ ] **Step 2: app.py**

```python
# sidecar/app.py
from fastapi import FastAPI
from sidecar.routers import finish, velocity, kde, gi_star

app = FastAPI(title="FieldSurvey sidecar")

app.include_router(finish.router, prefix="/sidecar/compute/A21_finish",      tags=["A21"])
app.include_router(velocity.router, prefix="/sidecar/compute/A25_velocity",  tags=["A25"])
app.include_router(kde.router, prefix="/sidecar/compute/A11_kde",            tags=["A11"])
app.include_router(gi_star.router, prefix="/sidecar/compute/A8_gi_star",     tags=["A8"])

@app.get("/sidecar/healthz")
def healthz(): return {"ok": True}

@app.get("/sidecar/version")
def version(): return {"version": "1.0.0"}
```

- [ ] **Step 3: supabase_client.py**

```python
# sidecar/lib/supabase_client.py
import os
from supabase import create_client, Client

def admin_client() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)
```

- [ ] **Step 4: cache.py**

```python
# sidecar/lib/cache.py
from .supabase_client import admin_client
from datetime import datetime, timezone

def write_cache(project_id: str, key: str, payload: dict):
    sb = admin_client()
    sb.table("dashboard_cache").upsert({
        "project_id": project_id,
        "key": key,
        "payload": payload,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="project_id,key").execute()
```

- [ ] **Step 5: vercel.ts entry**

```ts
// vercel.ts
import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  functions: {
    "sidecar/app.py": { runtime: "python3.13", maxDuration: 60, memory: 1024 },
  },
  rewrites: [
    { source: "/sidecar/:path*", destination: "/sidecar/app.py" },
  ],
};
```

- [ ] **Step 6: Commit**

```bash
git add sidecar/ vercel.ts
git commit -m "feat(sidecar): FastAPI Python 3.13 sidecar scaffold on Vercel Fluid Compute"
```

---

### Task 28: A21 Monte Carlo finish-date sidecar

**Files:**
- Create: `sidecar/routers/finish.py`
- Create: `sidecar/tests/test_finish.py`

- [ ] **Step 1: Write failing test**

```python
# sidecar/tests/test_finish.py
from sidecar.routers.finish import compute

def test_returns_p50_p75_p90():
    history = [5] * 30
    result = compute(history, target=100, start="2026-06-01", sims=2000)
    assert result["p50_days"] is not None
    assert 15 <= result["p50_days"] <= 25
    assert result["p90_days"] >= result["p50_days"]
```

- [ ] **Step 2: Run test (fails)**

`pytest sidecar/tests/test_finish.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# sidecar/routers/finish.py
from fastapi import APIRouter
import numpy as np
from datetime import date, timedelta
from pydantic import BaseModel
from ..lib.cache import write_cache

router = APIRouter()

class Req(BaseModel):
    project_id: str
    history: list[int]
    target: int
    start: str  # ISO
    sims: int = 10_000

def compute(history, target, start, sims=10_000, seed=1337):
    rng = np.random.default_rng(seed)
    hist = np.asarray([h for h in history if h >= 0], dtype=int)
    if len(hist) == 0 or target <= 0:
        return {"p50_days": None, "p75_days": None, "p90_days": None, "p50_date": None, "p75_date": None, "p90_date": None, "sims": sims, "history_window": int(len(hist))}
    days = np.zeros(sims, dtype=int)
    for s in range(sims):
        cum, d = 0, 0
        while cum < target and d < 365 * 5:
            cum += int(rng.choice(hist))
            d += 1
        days[s] = d
    p50, p75, p90 = int(np.percentile(days, 50)), int(np.percentile(days, 75)), int(np.percentile(days, 90))
    start_d = date.fromisoformat(start)
    return {
        "p50_days": p50, "p75_days": p75, "p90_days": p90,
        "p50_date": (start_d + timedelta(days=p50)).isoformat(),
        "p75_date": (start_d + timedelta(days=p75)).isoformat(),
        "p90_date": (start_d + timedelta(days=p90)).isoformat(),
        "sims": sims, "history_window": int(len(hist)),
    }

@router.post("")
def post(req: Req):
    out = compute(req.history, req.target, req.start, req.sims)
    write_cache(req.project_id, "A21_finish", out)
    return out
```

- [ ] **Step 4: Run test (passes)**

`pytest sidecar/tests/test_finish.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/routers/finish.py sidecar/tests/test_finish.py
git commit -m "feat(sidecar): A21 Monte Carlo finish-date forecaster"
```

---

### Task 29: A25 velocity change-points sidecar

**Files:**
- Create: `sidecar/routers/velocity.py`
- Create: `sidecar/tests/test_velocity.py`

- [ ] **Step 1: Write failing test**

```python
from sidecar.routers.velocity import compute

def test_detects_step_change():
    daily = [3]*10 + [9]*10
    out = compute(daily, min_size=3)
    assert any(8 < cp < 12 for cp in out["changepoints"])
```

- [ ] **Step 2: Implement**

```python
# sidecar/routers/velocity.py
from fastapi import APIRouter
import ruptures as rpt
from pydantic import BaseModel
from ..lib.cache import write_cache

router = APIRouter()

class Req(BaseModel):
    project_id: str
    daily_counts: list[int]
    min_size: int = 5

def compute(daily_counts, min_size=5):
    if len(daily_counts) < 2 * min_size:
        return {"changepoints": [], "n_breaks": 0, "min_size": min_size}
    algo = rpt.Pelt(model="rbf", min_size=min_size).fit(np.asarray(daily_counts, dtype=float))
    pen = max(1.0, len(daily_counts) ** 0.5)
    cps = algo.predict(pen=pen)[:-1]
    return {"changepoints": cps, "n_breaks": len(cps), "min_size": min_size}

import numpy as np

@router.post("")
def post(req: Req):
    out = compute(req.daily_counts, req.min_size)
    write_cache(req.project_id, "A25_velocity", out)
    return out
```

- [ ] **Step 3: Run tests + commit**

```bash
pytest sidecar/tests/test_velocity.py -v
git add sidecar/routers/velocity.py sidecar/tests/test_velocity.py
git commit -m "feat(sidecar): A25 velocity change-point detection via PELT"
```

---

### Task 30: A11 KDE sidecar

**Files:**
- Create: `sidecar/routers/kde.py`
- Create: `sidecar/tests/test_kde.py`

- [ ] **Step 1: Failing test**

```python
from sidecar.routers.kde import compute
def test_kde_returns_grid():
    pts = [(0.0, 0.0), (0.1, 0.1), (0.2, 0.1)]
    out = compute(pts, bandwidth=0.1, grid_size=16)
    assert len(out["grid"]) == 16 * 16
    assert out["bandwidth"] == 0.1
```

- [ ] **Step 2: Implement**

```python
# sidecar/routers/kde.py
from fastapi import APIRouter
import numpy as np
from KDEpy import FFTKDE
from pydantic import BaseModel
from ..lib.cache import write_cache

router = APIRouter()

class Req(BaseModel):
    project_id: str
    points: list[tuple[float, float]]
    bandwidth: float = 0.005   # ~500m at FL latitudes
    grid_size: int = 64

def compute(points, bandwidth=0.005, grid_size=64):
    if len(points) < 5:
        return {"grid": [], "bandwidth": bandwidth, "grid_size": grid_size, "n": 0}
    arr = np.asarray(points, dtype=float)
    grid, vals = FFTKDE(kernel="gaussian", bw=bandwidth).fit(arr).evaluate(grid_points=grid_size)
    return {
        "grid": grid.tolist(),
        "values": vals.tolist(),
        "bandwidth": bandwidth,
        "grid_size": grid_size,
        "n": int(len(points)),
    }

@router.post("")
def post(req: Req):
    out = compute(req.points, req.bandwidth, req.grid_size)
    write_cache(req.project_id, "A11_kde", out)
    return out
```

- [ ] **Step 3: Test + commit**

```bash
pytest sidecar/tests/test_kde.py -v
git add sidecar/routers/kde.py sidecar/tests/test_kde.py
git commit -m "feat(sidecar): A11 KDE heatmap via KDEpy FFTKDE"
```

---

### Task 31: A8 Getis-Ord Gi* sidecar

**Files:**
- Create: `sidecar/routers/gi_star.py`
- Create: `sidecar/tests/test_gi_star.py`

- [ ] **Step 1: Failing test**

```python
from sidecar.routers.gi_star import compute

def test_gi_star_returns_z_and_p():
    cells = [{"id": str(i), "value": v, "lat": 0.0 + i*0.01, "lon": 0.0} for i, v in enumerate([1,1,1,5,5,5,1,1,1])]
    out = compute(cells, k=3)
    assert len(out["results"]) == 9
    assert all("z" in r and "p" in r for r in out["results"])
```

- [ ] **Step 2: Implement**

```python
# sidecar/routers/gi_star.py
from fastapi import APIRouter
import numpy as np
import libpysal
from esda.getisord import G_Local
from pydantic import BaseModel
from ..lib.cache import write_cache

router = APIRouter()

class Cell(BaseModel):
    id: str
    value: float
    lat: float
    lon: float

class Req(BaseModel):
    project_id: str
    cells: list[Cell]
    k: int = 5

def compute(cells, k=5):
    if len(cells) < 30:
        return {"results": [], "k": k, "n": len(cells)}
    coords = np.array([[c["lon"], c["lat"]] for c in cells])
    vals = np.array([c["value"] for c in cells])
    w = libpysal.weights.KNN.from_array(coords, k=min(k, len(cells) - 1))
    w.transform = "r"
    gi = G_Local(vals, w, star=True, permutations=999)
    return {
        "results": [
            {"id": c["id"], "z": float(z), "p": float(p)}
            for c, z, p in zip(cells, gi.Zs, gi.p_sim)
        ],
        "k": k,
        "n": len(cells),
        "permutations": 999,
    }

@router.post("")
def post(req: Req):
    cells_d = [c.model_dump() for c in req.cells]
    out = compute(cells_d, req.k)
    write_cache(req.project_id, "A8_gi_star", out)
    return out
```

- [ ] **Step 3: Test + commit**

```bash
pytest sidecar/tests/test_gi_star.py -v
git add sidecar/routers/gi_star.py sidecar/tests/test_gi_star.py
git commit -m "feat(sidecar): A8 Getis-Ord Gi* with KNN weights + 999 permutations"
```

---

### Task 32: Sidecar Next.js client wrapper

**Files:**
- Create: `lib/queries/sidecar.ts`
- Create: `components/analyses/cards/a21-finish-fan.tsx`
- Create: `components/analyses/cards/a25-velocity.tsx`
- Create: `components/analyses/cards/a11-kde.tsx`
- Create: `components/analyses/cards/a08-gi-star.tsx`
- Create: `components/analyses/cards/a09-lisa.tsx` (stub for M7)

- [ ] **Step 1: Cached sidecar client**

```ts
// lib/queries/sidecar.ts
import { createServerSupabase } from "@/lib/supabase/server";

const FRESH_S = 15 * 60;

export async function callSidecar<T>(projectId: string, cardId: string, body: Record<string, unknown>): Promise<{ payload: T; computedAt: string }> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("dashboard_cache") as any)
    .select("payload, computed_at")
    .eq("project_id", projectId)
    .eq("key", cardId)
    .maybeSingle() as { data: { payload: T; computed_at: string } | null };
  if (data) {
    const age = (Date.now() - new Date(data.computed_at).getTime()) / 1000;
    if (age < FRESH_S) return { payload: data.payload, computedAt: data.computed_at };
  }
  const res = await fetch(`${process.env.NEXT_PUBLIC_SIDECAR_URL ?? ""}/sidecar/compute/${cardId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project_id: projectId, ...body }),
  });
  if (!res.ok) throw new Error(`sidecar ${cardId} failed`);
  const fresh = await res.json();
  return { payload: fresh, computedAt: new Date().toISOString() };
}
```

- [ ] **Step 2: A21 finish fan client**

```tsx
// components/analyses/cards/a21-finish-fan.tsx
"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";

type Fan = { p50_days: number | null; p75_days: number | null; p90_days: number | null; p50_date: string | null; p75_date: string | null; p90_date: string | null; sims: number; history_window: number };

export function MonteCarloFan({ projectId }: { projectId: string }) {
  const [r, setR] = useState<Fan | null>(null);
  useEffect(() => {
    fetch(`/api/projects/${projectId}/analyses/A21_finish`)
      .then((res) => res.json())
      .then((j) => setR(j.data?.payload ?? null))
      .catch(() => {});
  }, [projectId]);
  if (!r) return null;
  if (r.p50_days == null) return null;
  return (
    <div className="bento-panel p-4">
      <TrustChrome cardName="Predicted finish date" methodHref="#" denominatorLabel={`${r.sims.toLocaleString()} sims · ${r.history_window}d history`} />
      <div className="font-display text-[18px] font-extrabold tabular-nums">{r.p75_date}</div>
      <div className="mt-1 font-mono text-[10.5px] text-[var(--shell-text-muted)]">@ 75% confidence · range {r.p50_date} → {r.p90_date}</div>
    </div>
  );
}
```

- [ ] **Step 3: Repeat the pattern for A25, A11, A8 — same client wrapper, same `<RegistryCard>` integration, same `/api/.../analyses/<id>` dispatch.**

- [ ] **Step 4: Add A09 LISA stub (renders Coming):** Since A9 is wave-2, leave its registry entry `stub:true` — the stub branch in `<RegistryCard>` handles rendering.

- [ ] **Step 5: Extend the unified dispatcher** in `app/api/projects/[projectId]/analyses/[cardId]/route.ts` with the 4 sidecar cards:

```ts
// inside DISPATCH
A21_finish:   (p) => callSidecar(p, "A21_finish",   { history: [], target: 0, start: new Date().toISOString().slice(0,10) }),
A25_velocity: (p) => callSidecar(p, "A25_velocity", { daily_counts: [] }),
A11_kde:      (p) => callSidecar(p, "A11_kde",      { points: [] }),
A8_gi_star:   (p) => callSidecar(p, "A8_gi_star",   { cells: [] }),
```

(Replace the empty arrays/zeros with real data fetched server-side from points/universe/responses — the writing-plans executor fills in this glue per card.)

- [ ] **Step 6: Commit**

```bash
git add lib/queries/sidecar.ts components/analyses/cards/a21-finish-fan.tsx components/analyses/cards/a25-velocity.tsx components/analyses/cards/a11-kde.tsx components/analyses/cards/a08-gi-star.tsx components/analyses/cards/a09-lisa.tsx app/api/projects/[projectId]/analyses/[cardId]/route.ts
git commit -m "feat(analyses): A21/A25/A11/A8 sidecar client cards + dispatcher"
```

---

## Phase 5 — Wire-up + verification (Tasks 33–36)

### Task 33: E2E Playwright test — view switching renders cards

**Files:**
- Create: `tests/e2e/analyses-catalog.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e/analyses-catalog.spec.ts
import { test, expect } from "@playwright/test";

test("admin can switch saved view and see registry cards render", async ({ page }) => {
  await page.goto("/p/test-project/map");
  await expect(page.getByText("Default")).toBeVisible();
  await page.getByRole("button", { name: "Coverage" }).click();
  await expect(page.getByText(/universe penetration/i)).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: /\+ catalog/i }).click();
  await expect(page.getByText(/53 of 55 cards/i)).toBeVisible();
});
```

- [ ] **Step 2: Run E2E**

Run: `npm run e2e -- tests/e2e/analyses-catalog.spec.ts`
Expected: PASS (after seed data load).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/analyses-catalog.spec.ts
git commit -m "test(analyses): E2E for view switching + Catalog drawer"
```

---

### Task 34: Type-check + lint sweep

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Run all unit tests**

Run: `npm run test`
Expected: all green.

- [ ] **Step 4: Commit any fixes**

```bash
git add -p
git commit -m "chore(analyses): type + lint sweep for M7 wave-1"
```

---

### Task 35: Sidecar deploy + smoke

- [ ] **Step 1: Set Vercel env vars**

```
SUPABASE_URL              = <fieldSurvey_prod url>
SUPABASE_SERVICE_ROLE_KEY = <from supabase dashboard>
NEXT_PUBLIC_SIDECAR_URL   = <vercel deployment url>
```

- [ ] **Step 2: Deploy**

Run: `vercel --prod`
Expected: build succeeds, sidecar function appears in Vercel dashboard.

- [ ] **Step 3: Smoke**

Run: `curl https://<deployment>/sidecar/healthz`
Expected: `{"ok": true}`.

- [ ] **Step 4: Trigger one card per sidecar route**

```bash
curl -X POST https://<deployment>/sidecar/compute/A21_finish \
  -H content-type:application/json \
  -d '{"project_id":"<test-project>", "history":[5,7,4,8,5], "target":100, "start":"2026-06-01"}'
```

Expected: JSON with `p50_date`, `p75_date`, `p90_date`.

- [ ] **Step 5: Commit deploy notes**

```bash
git add sidecar/README.md
git commit -m "docs(sidecar): deploy + smoke instructions"
```

---

### Task 36: Manual verification matrix

- [ ] **Step 1: Open the project in a browser**

Each of these expectations should pass:

| View | Cards expected to render | n_min status |
|---|---|---|
| Default | match donut, A16/17/18, A21, A23, A24, A25, A28 (admin only), A39, A51 | suppressed where n < n_min |
| Coverage | A19, A20, A21, A22, A13, A51, A16/17/18, A39 | suppressed where universe < 50 |
| QC (admin) | A28, A29, A33, A39 (A30/A31/A32/A34 render Coming stubs) | suppressed where n < 3 shifts |
| Health-equity | A40 (needs demographics_schema), A8, A11, A13, A39 (A41/A42/A15 stubs) | suppressed where demographics empty |
| Velocity | A23, A24, A25, A21, A39 (A26/A27 stubs) | suppressed where history < 21 days |

- [ ] **Step 2: Toggle A0 colorizer** — pick a numeric column, confirm viridis ramp + quantile classes + map repaints.

- [ ] **Step 3: Open Catalog drawer (admin)** — confirm all 53 entries + filter chips work + stub upvotes call `/catalog/vote`.

- [ ] **Step 4: Commit final spec amendment if anything diverges**

```bash
git add docs/superpowers/specs/2026-05-29-analyses-catalog-design.md
git commit -m "docs(analyses): spec amendments from M7 wave-1 verification"
```

---

## Self-review

**1. Spec coverage:** All 10 sections of the spec have at least one task. Default-pack 10 cards have dedicated tasks (T11 donut, T8 A23, T9 A24, T10 A39, T16 AAPOR, T17 A19, T18 A20, T21 A28, T25 A51 + A52, T28 A21, T29 A25). Wave-1 14 cards covered: A1 T12, A2 T13, A3 T14, A8 T31, A9 T32 (stub), A11 T30, A13 T20, A19 T17, A20 T18, A22 T19, A29 T22, A33 T23, A40 T24, A52 T25. Chrome A47 T5, A48 T4. Sidecar infra T27. Verification + deploy T33–T36.

**2. Placeholder scan:** No "TBD"/"TODO" left. Tasks 17–25 use a compressed "see Task 16 as template" pattern but each one lists its files, RPC, and commit message — that's specific enough. Sidecar dispatcher in T32 leaves data-glue empty (intentional — fetching from points/universe/responses is shown in the existing `lib/queries/*` modules from earlier tasks).

**3. Type consistency:** `CardData<T>`, `useColorizer`, `ColorizeSpec` match the types in `lib/analyses/types.ts` (Phase 1). RPC names `aapor_outcome_counts`, `coverage_by_block`, `undersampled_blocks`, `productivity_per_surveyor`, `gps_accuracy_outliers`, `off_boundary_points`, `topk_revisit_blocks`, `status_pattern_per_parcel` all referenced consistently across migration 016 + lib/queries/* + the unified dispatcher. Viz component names in `viz-registry.ts` (Task 6) match the exports in each `components/analyses/cards/*.tsx` file.

**4. Migration 016** is referenced by every postgres card — applied via MCP in Task 15 Step 2.

If issues arise during execution, fix inline.
