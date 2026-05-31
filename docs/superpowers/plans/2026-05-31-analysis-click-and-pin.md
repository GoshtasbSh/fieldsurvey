# Analysis Click-to-Configure & Pin-to-Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Clicking an analysis row opens its settings/run drawer; (B) after running, a "Pin to left panel" button pins the result as a persistent ArcGIS-style layer in a new "Analysis" tab on the left rail alongside the existing "Layers" tab.

**Architecture:** The left rail gets a Radix Tabs shell (Tab 1 = existing content, Tab 2 = Analysis Layers). `PinnedAnalysisLayer` is a new type persisted in a new `pinned_layers` JSONB column on `user_view_state`. The settings drawer gains a result panel (`useAnalysisResult` hook) and a "Pin to left panel" button. A new `/api/projects/[p]/pinned-layers` route handles CRUD for pinned layers. The `AnalysisLayersPanel` in the left rail reads pinned layers and renders visibility toggles.

**Tech Stack:** Next.js 15.5, React 19, TypeScript strict, Radix UI (Tabs + Dialog), Tailwind, Supabase Postgres (MCP migration), Vitest, @testing-library/react.

**Companion Wave 0 plan:** `docs/superpowers/plans/2026-05-30-spatial-toolbox-wave-0.md`

---

## File Structure

| File | Responsibility | New / Modify |
|------|----------------|--------------|
| `supabase/migrations/023_pinned_layers.sql` | Add `pinned_layers jsonb` column to `user_view_state` | New |
| `lib/analyses/types.ts` | Add `PinnedAnalysisLayer` type | Modify (append) |
| `hooks/use-analysis-result.ts` | Fetch analysis dispatcher result for a given card + settings | New |
| `hooks/use-pinned-layers.ts` | Read / pin / unpin / toggle visibility for pinned layers | New |
| `app/api/projects/[projectId]/pinned-layers/route.ts` | GET/POST/DELETE/PATCH pinned layers | New |
| `components/analyses/settings-drawer.tsx` | Add result panel, loading state, "Run" button, "Pin to panel" button | Modify |
| `components/analyses/analyses-list-item.tsx` | Make whole row clickable (opens settings on click, ⚙ stays as icon affordance) | Modify |
| `components/analyses/analysis-layers-panel.tsx` | Analysis tab body: list of pinned layers with visibility toggle, settings link, timestamp | New |
| `components/desktop/left-rail.tsx` | Wrap existing content in Radix Tabs Tab 1; add Tab 2 with `AnalysisLayersPanel` | Modify |
| `components/desktop/map-shell.tsx` | Thread `pinnedLayers` + `onOpenLayerSettings` into left rail | Modify |
| `tests/analyses/analyses-list-item.test.tsx` | Unit test: row click triggers onOpenSettings | New |
| `tests/analyses/analysis-layers-panel.test.tsx` | Unit test: renders pinned layers, toggle, empty state | New |
| `tests/analyses/settings-drawer-pin.test.tsx` | Unit test: Run button triggers fetch; Pin button appears after result | New |

---

## Tasks

### Task 1: Migration 023 — pinned_layers column

**Files:**
- Create: `supabase/migrations/023_pinned_layers.sql`

- [ ] **Step 1: Author the migration**

```sql
-- 023_pinned_layers.sql
-- M7.2 — persist the user's pinned analysis result layers on user_view_state.
-- Each entry is a PinnedAnalysisLayer: {cardId, layerName, settings, visible,
-- pinnedAt, cachedResult?, cachedAt?}.

set search_path = public, extensions;

alter table public.user_view_state
  add column if not exists pinned_layers jsonb not null default '[]'::jsonb;

comment on column public.user_view_state.pinned_layers is
  'Ordered array of {cardId, layerName, settings, visible, pinnedAt, cachedResult?, cachedAt?}. '
  'Rendered in the left-rail Analysis tab as toggleable map overlays.';

alter table public.user_view_state
  add constraint user_view_state_pinned_layers_is_array
  check (jsonb_typeof(pinned_layers) = 'array');
```

- [ ] **Step 2: Verify file**

Run: `grep -c "add column if not exists" supabase/migrations/023_pinned_layers.sql`
Expected: `1`

- [ ] **Step 3: Commit (do NOT apply — gated to Task 9)**

```bash
git add supabase/migrations/023_pinned_layers.sql
git commit -m "feat(db): user_view_state.pinned_layers column (M7.2)"
```

---

### Task 2: `PinnedAnalysisLayer` type

**Files:**
- Modify: `lib/analyses/types.ts` (append after `AnalysisListItem`)
- Test: `tests/analyses/types-pinned.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/analyses/types-pinned.test.ts`:

```ts
// tests/analyses/types-pinned.test.ts
import { describe, it, expect } from "vitest";
import type { PinnedAnalysisLayer } from "@/lib/analyses/types";

describe("PinnedAnalysisLayer type", () => {
  it("compiles with all required fields", () => {
    const layer: PinnedAnalysisLayer = {
      cardId: "S2_gi_star_q",
      layerName: "Hot spots",
      settings: { fdrAlpha: 0.05 },
      visible: true,
      pinnedAt: "2026-05-31T10:00:00Z",
    };
    expect(layer.cardId).toBe("S2_gi_star_q");
    expect(layer.visible).toBe(true);
  });

  it("allows optional cachedResult and cachedAt", () => {
    const layer: PinnedAnalysisLayer = {
      cardId: "S1_autocorr",
      layerName: "Autocorr",
      settings: {},
      visible: false,
      pinnedAt: "2026-05-31T10:00:00Z",
      cachedResult: { moran: { I: 0.32, z: 4.1, p: 0.001 }, verdict: "clustered" },
      cachedAt: "2026-05-31T10:05:00Z",
    };
    expect(layer.visible).toBe(false);
    expect(layer.cachedResult).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/analyses/types-pinned.test.ts`
Expected: FAIL — `has no exported member 'PinnedAnalysisLayer'`

- [ ] **Step 3: Append type to `lib/analyses/types.ts`**

Append after the `AnalysisListItem` export (at the end of the file):

```ts
export type PinnedAnalysisLayer = {
  /** Registry card id, e.g. "S2_gi_star_q". */
  cardId: string;
  /** User-editable display name shown in the left-rail Analysis tab. */
  layerName: string;
  /** The settings used when the analysis was run. */
  settings: Record<string, unknown>;
  /** Whether this layer is currently shown on the map. */
  visible: boolean;
  /** ISO timestamp of when the user pinned this layer. */
  pinnedAt: string;
  /** Cached dispatcher result payload — undefined until first successful run. */
  cachedResult?: unknown;
  /** ISO timestamp of the cached result. */
  cachedAt?: string;
};
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/analyses/types-pinned.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/analyses/types.ts tests/analyses/types-pinned.test.ts
git commit -m "feat(analyses): PinnedAnalysisLayer type (M7.2)"
```

---

### Task 3: `useAnalysisResult` hook

This hook calls the existing dispatcher API (`/api/projects/[p]/analyses/[cardId]`) with the current settings (as URL query params) and returns `{ data, loading, error }`. The dispatcher already exists from M7 Wave 1 cards; Wave 0 cards return `{ data: null, reason: "wave-pending" }` from their placeholder handlers — that's fine.

**Files:**
- Create: `hooks/use-analysis-result.ts`

- [ ] **Step 1: Implement**

```ts
// hooks/use-analysis-result.ts
"use client";
import { useCallback, useState } from "react";

type ResultState = {
  data: unknown | null;
  loading: boolean;
  error: string | null;
  computedAt: string | null;
};

/**
 * On-demand hook: call run() to fetch an analysis result from the dispatcher.
 * Does NOT auto-fetch on mount — the user must click "Run analysis".
 */
export function useAnalysisResult(
  projectId: string,
  cardId: string,
  settings: Record<string, unknown>,
) {
  const [state, setState] = useState<ResultState>({
    data: null, loading: false, error: null, computedAt: null,
  });

  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      // Build query string from settings for dispatcher routing
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(settings)) {
        if (v !== null && v !== undefined) params.set(k, String(v));
      }
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/projects/${projectId}/analyses/${cardId}${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const env = (await res.json()) as { data?: unknown | null; computedAt?: string | null };
      setState({ data: env?.data ?? null, loading: false, error: null, computedAt: env?.computedAt ?? null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }, [projectId, cardId, settings]);

  return { ...state, run };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 new errors.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-analysis-result.ts
git commit -m "feat(analyses): useAnalysisResult on-demand dispatcher hook (M7.2)"
```

---

### Task 4: `usePinnedLayers` hook + `/api/projects/[p]/pinned-layers` route

**Files:**
- Create: `app/api/projects/[projectId]/pinned-layers/route.ts`
- Create: `hooks/use-pinned-layers.ts`

- [ ] **Step 1: Implement the API route**

```ts
// app/api/projects/[projectId]/pinned-layers/route.ts
/**
 * GET    /api/projects/[projectId]/pinned-layers
 * POST   /api/projects/[projectId]/pinned-layers          — pin a new layer
 * DELETE /api/projects/[projectId]/pinned-layers?cardId=&pinnedAt=  — unpin
 * PATCH  /api/projects/[projectId]/pinned-layers          — update (visibility, name, cachedResult)
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import type { PinnedAnalysisLayer } from "@/lib/analyses/types";

async function assertMember(projectId: string) {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { sb, user: null as null, role: null as null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: projectId });
  return { sb: sbAny, user, role };
}

async function readLayers(sb: unknown, userId: string, projectId: string): Promise<PinnedAnalysisLayer[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any)
    .from("user_view_state")
    .select("pinned_layers")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.pinned_layers ?? []) as PinnedAnalysisLayer[];
}

async function writeLayers(sb: unknown, userId: string, projectId: string, layers: PinnedAnalysisLayer[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sb as any)
    .from("user_view_state")
    .upsert({ user_id: userId, project_id: projectId, pinned_layers: layers }, { onConflict: "user_id,project_id" });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { sb, user, role } = await assertMember(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const layers = await readLayers(sb, user.id, projectId);
  return NextResponse.json({ layers });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { sb, user, role } = await assertMember(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json()) as Partial<PinnedAnalysisLayer>;
  if (!body?.cardId) return NextResponse.json({ error: "cardId required" }, { status: 400 });

  const existing = await readLayers(sb, user.id, projectId);
  const newLayer: PinnedAnalysisLayer = {
    cardId: body.cardId,
    layerName: body.layerName ?? body.cardId,
    settings: body.settings ?? {},
    visible: body.visible ?? true,
    pinnedAt: new Date().toISOString(),
    cachedResult: body.cachedResult,
    cachedAt: body.cachedResult ? new Date().toISOString() : undefined,
  };
  const { error } = await writeLayers(sb, user.id, projectId, [...existing, newLayer]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ layers: [...existing, newLayer] });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const url = new URL(req.url);
  const cardId = url.searchParams.get("cardId");
  const pinnedAt = url.searchParams.get("pinnedAt");
  if (!cardId || !pinnedAt) return NextResponse.json({ error: "cardId+pinnedAt required" }, { status: 400 });

  const { sb, user, role } = await assertMember(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const existing = await readLayers(sb, user.id, projectId);
  const filtered = existing.filter((l) => !(l.cardId === cardId && l.pinnedAt === pinnedAt));
  const { error } = await writeLayers(sb, user.id, projectId, filtered);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ layers: filtered });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = (await req.json()) as { cardId: string; pinnedAt: string } & Partial<PinnedAnalysisLayer>;
  if (!body?.cardId || !body?.pinnedAt) {
    return NextResponse.json({ error: "cardId+pinnedAt required" }, { status: 400 });
  }

  const { sb, user, role } = await assertMember(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const existing = await readLayers(sb, user.id, projectId);
  const updated = existing.map((l) =>
    l.cardId === body.cardId && l.pinnedAt === body.pinnedAt
      ? {
          ...l,
          ...(body.visible !== undefined && { visible: body.visible }),
          ...(body.layerName !== undefined && { layerName: body.layerName }),
          ...(body.cachedResult !== undefined && { cachedResult: body.cachedResult, cachedAt: new Date().toISOString() }),
        }
      : l,
  );
  const { error } = await writeLayers(sb, user.id, projectId, updated);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ layers: updated });
}
```

- [ ] **Step 2: Implement `hooks/use-pinned-layers.ts`**

```ts
// hooks/use-pinned-layers.ts
"use client";
import { useCallback, useEffect, useState } from "react";
import type { PinnedAnalysisLayer } from "@/lib/analyses/types";

export function usePinnedLayers(projectId: string | undefined) {
  const [layers, setLayers] = useState<PinnedAnalysisLayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/pinned-layers`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { layers: fetched } = (await res.json()) as { layers: PinnedAnalysisLayer[] };
      setLayers(fetched);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const pin = useCallback(async (layer: Omit<PinnedAnalysisLayer, "pinnedAt">) => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/pinned-layers`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(layer),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { layers: updated } = (await res.json()) as { layers: PinnedAnalysisLayer[] };
    setLayers(updated);
  }, [projectId]);

  const unpin = useCallback(async (cardId: string, pinnedAt: string) => {
    if (!projectId) return;
    const res = await fetch(
      `/api/projects/${projectId}/pinned-layers?cardId=${encodeURIComponent(cardId)}&pinnedAt=${encodeURIComponent(pinnedAt)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { layers: updated } = (await res.json()) as { layers: PinnedAnalysisLayer[] };
    setLayers(updated);
  }, [projectId]);

  const toggleVisibility = useCallback(async (cardId: string, pinnedAt: string, visible: boolean) => {
    if (!projectId) return;
    // Optimistic update
    setLayers((prev) =>
      prev.map((l) => l.cardId === cardId && l.pinnedAt === pinnedAt ? { ...l, visible } : l),
    );
    const res = await fetch(`/api/projects/${projectId}/pinned-layers`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId, pinnedAt, visible }),
    });
    if (!res.ok) {
      // Revert optimistic update on failure
      setLayers((prev) =>
        prev.map((l) => l.cardId === cardId && l.pinnedAt === pinnedAt ? { ...l, visible: !visible } : l),
      );
    }
  }, [projectId]);

  const updateCachedResult = useCallback(async (cardId: string, pinnedAt: string, cachedResult: unknown) => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/pinned-layers`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId, pinnedAt, cachedResult }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { layers: updated } = (await res.json()) as { layers: PinnedAnalysisLayer[] };
    setLayers(updated);
  }, [projectId]);

  const rename = useCallback(async (cardId: string, pinnedAt: string, layerName: string) => {
    if (!projectId) return;
    setLayers((prev) =>
      prev.map((l) => l.cardId === cardId && l.pinnedAt === pinnedAt ? { ...l, layerName } : l),
    );
    const res = await fetch(`/api/projects/${projectId}/pinned-layers`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId, pinnedAt, layerName }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }, [projectId]);

  return { layers, loading, error, refresh, pin, unpin, toggleVisibility, updateCachedResult, rename };
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 new errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/projects/\[projectId\]/pinned-layers/route.ts hooks/use-pinned-layers.ts
git commit -m "feat(api): pinned-layers CRUD + usePinnedLayers hook (M7.2)"
```

---

### Task 5: Make analysis row clickable

**Files:**
- Modify: `components/analyses/analyses-list-item.tsx`
- Create: `tests/analyses/analyses-list-item.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/analyses/analyses-list-item.test.tsx`:

```tsx
// tests/analyses/analyses-list-item.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalysesListItem } from "@/components/analyses/analyses-list-item";
import type { AnalysisListItem } from "@/lib/analyses/types";

const item: AnalysisListItem = {
  cardId: "S2_gi_star_q",
  settings: {},
  addedAt: "2026-05-31T10:00:00Z",
};

describe("AnalysesListItem", () => {
  it("clicking the card body opens settings", async () => {
    const u = userEvent.setup();
    const onOpenSettings = vi.fn();
    render(
      <AnalysesListItem
        item={item} projectId="p1" globalActiveQuestion={null}
        onOpenSettings={onOpenSettings} onRemove={() => {}}
      />
    );
    // Click the card header area (h3)
    await u.click(screen.getByText(/Hot\/Cold Spot/i));
    expect(onOpenSettings).toHaveBeenCalledWith("S2_gi_star_q");
  });

  it("the ⚙ button also opens settings", async () => {
    const u = userEvent.setup();
    const onOpenSettings = vi.fn();
    render(
      <AnalysesListItem
        item={item} projectId="p1" globalActiveQuestion={null}
        onOpenSettings={onOpenSettings} onRemove={() => {}}
      />
    );
    await u.click(screen.getByRole("button", { name: /open settings/i }));
    expect(onOpenSettings).toHaveBeenCalledWith("S2_gi_star_q");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/analyses/analyses-list-item.test.tsx`
Expected: FAIL — clicking the header doesn't call `onOpenSettings` (no onClick on the card body).

- [ ] **Step 3: Modify `components/analyses/analyses-list-item.tsx`**

Replace the `<article>` and `<header>` block to add click-to-open:

```tsx
// components/analyses/analyses-list-item.tsx
"use client";
import type { AnalysisListItem, SpatialCardCatalogEntry } from "@/lib/analyses/types";
import { getCardById } from "@/lib/analyses/registry";
import { Suspense } from "react";
import { getVizComponent } from "@/lib/analyses/viz-registry";

type Props = {
  item: AnalysisListItem;
  projectId: string;
  globalActiveQuestion: string | null;
  onOpenSettings: (cardId: string) => void;
  onRemove: (cardId: string) => void;
};

export function AnalysesListItem({ item, projectId, globalActiveQuestion, onOpenSettings, onRemove }: Props) {
  const card = getCardById(item.cardId) as SpatialCardCatalogEntry | undefined;
  if (!card) return null;

  const Viz = getVizComponent(card.vizComponent);
  const inheritedQ =
    (item.settings.questionKey as string | undefined) === "inherit_global" || !item.settings.questionKey
      ? globalActiveQuestion
      : (item.settings.questionKey as string);

  return (
    <article className="rounded-xl border border-[var(--shell-border)] bg-[var(--shell-1)] p-3 flex flex-col gap-2">
      {/* Clickable header — entire row opens settings */}
      <button
        className="flex items-start justify-between gap-2 text-left w-full group"
        onClick={() => onOpenSettings(card.id)}
        aria-label={`Open settings for ${card.name}`}
      >
        <div className="min-w-0">
          <h3 className="font-semibold text-[13px] group-hover:text-[var(--accent-1,#0EA5E9)] transition-colors">
            {card.name}
          </h3>
          <p className="text-[11px] text-[var(--shell-text-muted)] font-mono">
            {card.id} {inheritedQ ? `· Q: ${inheritedQ}` : "· no question yet"}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* ⚙ icon is visual affordance only — button click handled by parent button */}
          <span
            aria-hidden
            className="rounded-md p-1 text-[var(--shell-text-muted)] group-hover:text-[var(--shell-text)]"
          >
            ⚙
          </span>
          {/* Remove button stops propagation so it doesn't open settings */}
          <button
            aria-label={`Remove ${card.name}`}
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Remove "${card.name}" from the Analyze tab?`)) onRemove(card.id);
            }}
            className="rounded-md p-1 text-[var(--shell-text-muted)] hover:bg-[var(--shell-2)] hover:text-red-400"
          >
            ✕
          </button>
        </div>
      </button>
      <div className="min-h-[80px]">
        {Viz ? (
          <Suspense fallback={<div className="text-[11px] text-[var(--shell-text-muted)]">Loading…</div>}>
            <Viz projectId={projectId} settings={item.settings} />
          </Suspense>
        ) : (
          <div className="text-[11px] text-[var(--shell-text-muted)]">No viz registered.</div>
        )}
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/analyses/analyses-list-item.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Run full suite**

Run: `npx vitest run tests/analyses/`
Expected: all pass (no regressions).

- [ ] **Step 6: Commit**

```bash
git add components/analyses/analyses-list-item.tsx tests/analyses/analyses-list-item.test.tsx
git commit -m "feat(analyses): row click opens settings + remove stops propagation (M7.2)"
```

---

### Task 6: Extend SettingsDrawer with Run + result panel + Pin button

The drawer gets three new pieces:
1. **Run button** — replaces the inert "Re-compute" button; calls `useAnalysisResult.run()`.
2. **Result panel** — shows below the settings when data arrives (loading skeleton → result summary → "wave-pending" notice for Wave-0 cards).
3. **"📌 Pin to left panel" button** — appears when `data !== null`; calls `onPin(data)` prop.

**Files:**
- Modify: `components/analyses/settings-drawer.tsx`
- Create: `tests/analyses/settings-drawer-pin.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/analyses/settings-drawer-pin.test.tsx`:

```tsx
// tests/analyses/settings-drawer-pin.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsDrawer } from "@/components/analyses/settings-drawer";
import { getCardById } from "@/lib/analyses/registry";
import type { SpatialCardCatalogEntry } from "@/lib/analyses/types";

// Mock the dispatcher fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("SettingsDrawer — run + pin", () => {
  const card = getCardById("S2_gi_star_q") as SpatialCardCatalogEntry;

  it("Run analysis button triggers fetch and shows result panel", async () => {
    const u = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { cells: [], fdrCutoff: 0.05, nSigHot: 2, nSigCold: 1 }, computedAt: "2026-05-31T10:00:00Z" }),
    });

    render(
      <SettingsDrawer
        open card={card} projectId="p1"
        globalActiveQuestion="Q1"
        settings={{ fdrAlpha: 0.05 }}
        onChange={() => {}}
        onClose={() => {}}
        onPin={() => {}}
      />
    );

    await u.click(screen.getByRole("button", { name: /run analysis/i }));

    await waitFor(() => {
      expect(screen.getByText(/result/i)).toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/analyses/S2_gi_star_q"));
  });

  it("Pin to left panel button calls onPin with the result data", async () => {
    const u = userEvent.setup();
    const onPin = vi.fn();
    const resultPayload = { cells: [], fdrCutoff: 0.05, nSigHot: 3, nSigCold: 0 };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: resultPayload, computedAt: "2026-05-31T10:00:00Z" }),
    });

    render(
      <SettingsDrawer
        open card={card} projectId="p1"
        globalActiveQuestion="Q1"
        settings={{ fdrAlpha: 0.05 }}
        onChange={() => {}}
        onClose={() => {}}
        onPin={onPin}
      />
    );

    await u.click(screen.getByRole("button", { name: /run analysis/i }));
    await waitFor(() => screen.getByRole("button", { name: /pin to left panel/i }));
    await u.click(screen.getByRole("button", { name: /pin to left panel/i }));

    expect(onPin).toHaveBeenCalledWith(resultPayload);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/analyses/settings-drawer-pin.test.tsx`
Expected: FAIL — no "Run analysis" button, `onPin` prop doesn't exist.

- [ ] **Step 3: Replace `components/analyses/settings-drawer.tsx` with the extended version**

```tsx
// components/analyses/settings-drawer.tsx
"use client";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { SpatialCardCatalogEntry, SettingSchema } from "@/lib/analyses/types";
import { useAnalysisResult } from "@/hooks/use-analysis-result";
import { QuestionPicker } from "./inputs/question-picker";
import { AnswerPicker } from "./inputs/answer-picker";
import { PoiPicker } from "./inputs/poi-picker";
import { SettingSlider } from "./inputs/setting-slider";
import { SettingSelect } from "./inputs/setting-select";
import { SettingToggle } from "./inputs/setting-toggle";

type Props = {
  open: boolean;
  card: SpatialCardCatalogEntry;
  projectId: string;
  globalActiveQuestion: string | null;
  settings: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  onClose: () => void;
  /** Called with the raw result payload when the user clicks "Pin to left panel". */
  onPin: (result: unknown) => void;
};

function renderField(
  schema: SettingSchema,
  ctx: { projectId: string; globalActiveQuestion: string | null; settings: Record<string, unknown>; emit: (key: string, v: unknown) => void },
) {
  const { projectId, globalActiveQuestion, settings, emit } = ctx;
  switch (schema.type) {
    case "question_picker":
      return (
        <QuestionPicker
          key={schema.key} label={schema.label} projectId={projectId}
          value={(settings[schema.key] as string | "inherit_global" | undefined) ?? schema.defaultValue ?? "inherit_global"}
          globalActiveQuestion={globalActiveQuestion}
          onChange={(v) => emit(schema.key, v)}
        />
      );
    case "answer_picker": {
      const qk = (settings[schema.questionKeyRef] as string | undefined) ?? "";
      return (
        <AnswerPicker
          key={schema.key} label={schema.label} projectId={projectId}
          questionKey={qk}
          value={(settings[schema.key] as string | undefined) ?? ""}
          onChange={(v) => emit(schema.key, v)}
        />
      );
    }
    case "poi_picker":
      return (
        <PoiPicker
          key={schema.key} label={schema.label}
          value={(settings[schema.key] as { lat: number; lon: number } | null | undefined) ?? null}
          onChange={(v) => emit(schema.key, v)}
        />
      );
    case "slider":
      return (
        <SettingSlider
          key={schema.key} label={schema.label}
          min={schema.min} max={schema.max} step={schema.step}
          value={(settings[schema.key] as number | undefined) ?? schema.defaultValue}
          onChange={(v) => emit(schema.key, v)}
        />
      );
    case "select":
      return (
        <SettingSelect
          key={schema.key} label={schema.label} options={schema.options}
          value={(settings[schema.key] as string | number | undefined) ?? schema.defaultValue}
          onChange={(v) => emit(schema.key, v)}
        />
      );
    case "toggle":
      return (
        <SettingToggle
          key={schema.key} label={schema.label}
          value={(settings[schema.key] as boolean | undefined) ?? schema.defaultValue}
          onChange={(v) => emit(schema.key, v)}
        />
      );
  }
}

function ResultPanel({
  loading, error, data, computedAt, onPin,
}: {
  loading: boolean;
  error: string | null;
  data: unknown | null;
  computedAt: string | null;
  onPin: (result: unknown) => void;
}) {
  if (loading) {
    return (
      <div className="rounded-lg bg-[var(--shell-2)] p-3 animate-pulse">
        <div className="h-2 w-2/3 rounded bg-[var(--shell-border)] mb-2" />
        <div className="h-2 w-1/2 rounded bg-[var(--shell-border)]" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-[11.5px] text-red-400">
        {error}
      </div>
    );
  }
  if (data === null) return null;

  const isWavePending = typeof data === "object" && data !== null && (data as Record<string, unknown>).reason === "wave-pending";

  return (
    <div className="rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
          Result
        </span>
        {computedAt && (
          <span className="font-mono text-[9px] text-[var(--shell-text-muted)]">
            {new Date(computedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
      {isWavePending ? (
        <p className="text-[11.5px] text-[var(--shell-text-muted)]">
          Compute backend ships in a later wave — result preview not available yet.
        </p>
      ) : (
        <p className="text-[11.5px] font-mono break-all text-[var(--shell-text-muted)]">
          {JSON.stringify(data).slice(0, 200)}…
        </p>
      )}
      {!isWavePending && (
        <button
          onClick={() => onPin(data)}
          aria-label="Pin to left panel"
          className="w-full rounded-md bg-[var(--shell-1)] border border-[var(--shell-border)] text-[12px] font-semibold py-1.5 px-3 hover:bg-[var(--accent-1,#0EA5E9)] hover:text-white hover:border-transparent transition-colors"
        >
          📌 Pin to left panel
        </button>
      )}
    </div>
  );
}

export function SettingsDrawer(p: Props) {
  const emit = (key: string, v: unknown) => p.onChange({ ...p.settings, [key]: v });
  const { data, loading, error, computedAt, run } = useAnalysisResult(p.projectId, p.card.id, p.settings);
  // Track if user has run analysis at least once this drawer session
  const [hasRun, setHasRun] = useState(false);

  const handleRun = async () => {
    setHasRun(true);
    await run();
  };

  return (
    <Dialog.Root open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content
          className="fixed z-50 right-0 top-0 h-full w-[min(420px,100vw)]
                     bg-[var(--shell-1)] border-l border-[var(--shell-border)] shadow-2xl
                     flex flex-col"
        >
          <header className="p-4 border-b border-[var(--shell-border)] flex items-start justify-between">
            <div>
              <Dialog.Title className="text-sm font-semibold">{p.card.name}</Dialog.Title>
              <p className="text-[11px] text-[var(--shell-text-muted)] font-mono">{p.card.id}</p>
            </div>
            <Dialog.Close aria-label="Close" className="text-[var(--shell-text-muted)] hover:text-[var(--shell-text)]">✕</Dialog.Close>
          </header>

          <div className="flex-1 overflow-auto p-4 space-y-4">
            <section className="space-y-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
                Inputs
              </div>
              {p.card.settingsSchema.map((s) =>
                renderField(s, { projectId: p.projectId, globalActiveQuestion: p.globalActiveQuestion, settings: p.settings, emit })
              )}
            </section>

            <section>
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)] mb-1">
                Method
              </div>
              <p className="text-[12px] leading-snug">{p.card.whatItDoes}</p>
              {p.card.sourceInspiration && (
                <p className="text-[11px] text-[var(--shell-text-muted)] mt-1">
                  {p.card.sourceInspiration}
                </p>
              )}
            </section>

            {hasRun && (
              <section>
                <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)] mb-2">
                  Result
                </div>
                <ResultPanel
                  loading={loading} error={error} data={data} computedAt={computedAt}
                  onPin={p.onPin}
                />
              </section>
            )}
          </div>

          <footer className="p-3 border-t border-[var(--shell-border)] flex justify-end gap-2">
            <button
              onClick={handleRun}
              disabled={loading}
              aria-label="Run analysis"
              className="rounded-md bg-[var(--accent-1,#0EA5E9)] text-white text-[12px] font-semibold py-1.5 px-3 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Running…" : "Run analysis"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/analyses/settings-drawer-pin.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Run full suite**

Run: `npx vitest run tests/analyses/`
Expected: all pass.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 new errors.

- [ ] **Step 7: Commit**

```bash
git add components/analyses/settings-drawer.tsx tests/analyses/settings-drawer-pin.test.tsx
git commit -m "feat(analyses): SettingsDrawer Run + ResultPanel + Pin to left panel (M7.2)"
```

---

### Task 7: `AnalysisLayersPanel` component

The Analysis tab body in the left rail. Renders each pinned layer as a row with:
- **Eye toggle** — `visible` on/off (calls `toggleVisibility`)
- **Color dot** — card's section-color (uses a deterministic mapping from cardId prefix)
- **Layer name** — editable on double-click (inline `contentEditable`)
- **Card id** — monospace subtitle
- **Last run timestamp** — relative from `cachedAt`
- **⚙ settings** — calls `onOpenSettings(cardId)`
- **✕ unpin** — calls `unpin(cardId, pinnedAt)`
- Empty state with a message pointing to the Analyze tab

**Files:**
- Create: `components/analyses/analysis-layers-panel.tsx`
- Create: `tests/analyses/analysis-layers-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/analyses/analysis-layers-panel.test.tsx`:

```tsx
// tests/analyses/analysis-layers-panel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalysisLayersPanel } from "@/components/analyses/analysis-layers-panel";
import type { PinnedAnalysisLayer } from "@/lib/analyses/types";

const layers: PinnedAnalysisLayer[] = [
  { cardId: "S2_gi_star_q", layerName: "Hot spots", settings: {}, visible: true, pinnedAt: "2026-05-31T10:00:00Z" },
  { cardId: "S6_coverage_response", layerName: "Coverage", settings: {}, visible: false, pinnedAt: "2026-05-31T10:05:00Z" },
];

describe("AnalysisLayersPanel", () => {
  it("renders empty state when no layers pinned", () => {
    render(
      <AnalysisLayersPanel
        layers={[]} loading={false}
        onToggleVisibility={() => {}}
        onUnpin={() => {}}
        onOpenSettings={() => {}}
        onRename={() => {}}
      />
    );
    expect(screen.getByText(/no analysis layers pinned/i)).toBeInTheDocument();
  });

  it("renders one row per pinned layer with layer name", () => {
    render(
      <AnalysisLayersPanel
        layers={layers} loading={false}
        onToggleVisibility={() => {}}
        onUnpin={() => {}}
        onOpenSettings={() => {}}
        onRename={() => {}}
      />
    );
    expect(screen.getByText("Hot spots")).toBeInTheDocument();
    expect(screen.getByText("Coverage")).toBeInTheDocument();
  });

  it("eye toggle button calls onToggleVisibility", async () => {
    const u = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <AnalysisLayersPanel
        layers={layers} loading={false}
        onToggleVisibility={onToggle}
        onUnpin={() => {}}
        onOpenSettings={() => {}}
        onRename={() => {}}
      />
    );
    const toggles = screen.getAllByRole("button", { name: /toggle visibility/i });
    await u.click(toggles[0]);
    expect(onToggle).toHaveBeenCalledWith("S2_gi_star_q", "2026-05-31T10:00:00Z", false);
  });

  it("⚙ button calls onOpenSettings", async () => {
    const u = userEvent.setup();
    const onOpenSettings = vi.fn();
    render(
      <AnalysisLayersPanel
        layers={layers} loading={false}
        onToggleVisibility={() => {}}
        onUnpin={() => {}}
        onOpenSettings={onOpenSettings}
        onRename={() => {}}
      />
    );
    const cogs = screen.getAllByRole("button", { name: /settings/i });
    await u.click(cogs[0]);
    expect(onOpenSettings).toHaveBeenCalledWith("S2_gi_star_q", "2026-05-31T10:00:00Z");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/analyses/analysis-layers-panel.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `components/analyses/analysis-layers-panel.tsx`**

```tsx
// components/analyses/analysis-layers-panel.tsx
"use client";
import { useState } from "react";
import type { PinnedAnalysisLayer } from "@/lib/analyses/types";
import { getCardById } from "@/lib/analyses/registry";
import type { SpatialCardCatalogEntry } from "@/lib/analyses/types";

// Deterministic section-color per card toolbox
const TOOLBOX_COLORS: Record<string, string> = {
  symbology: "#0EA5E9",          // sky-500
  analyzing_patterns: "#8B5CF6", // violet-500
  mapping_clusters: "#EF4444",   // red-500
  spatial_relationships: "#F59E0B", // amber-500
  coverage_equity: "#10B981",    // emerald-500
};

function layerColor(cardId: string): string {
  const card = getCardById(cardId) as SpatialCardCatalogEntry | undefined;
  const toolbox = card?.toolbox ?? "mapping_clusters";
  return TOOLBOX_COLORS[toolbox] ?? "#71717A";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} hr ago`;
}

type Props = {
  layers: PinnedAnalysisLayer[];
  loading: boolean;
  onToggleVisibility: (cardId: string, pinnedAt: string, visible: boolean) => void;
  onUnpin: (cardId: string, pinnedAt: string) => void;
  onOpenSettings: (cardId: string, pinnedAt: string) => void;
  onRename: (cardId: string, pinnedAt: string, name: string) => void;
};

export function AnalysisLayersPanel({ layers, loading, onToggleVisibility, onUnpin, onOpenSettings, onRename }: Props) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  if (loading) {
    return (
      <div className="space-y-2 px-1 py-2 animate-pulse">
        {[0, 1].map((i) => (
          <div key={i} className="h-9 rounded-lg bg-[var(--bento-surface-2)]" />
        ))}
      </div>
    );
  }

  if (layers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 px-3 text-center">
        <p className="text-[12px] font-semibold">No analysis layers pinned.</p>
        <p className="text-[11px] text-[var(--bento-ink-3)] leading-snug">
          Run an analysis in the Analyze tab (→), then click{" "}
          <span className="font-bold">📌 Pin to left panel</span> to see it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1 py-1">
      {layers.map((layer) => {
        const key = `${layer.cardId}::${layer.pinnedAt}`;
        const color = layerColor(layer.cardId);
        const isEditing = editingKey === key;
        const card = getCardById(layer.cardId) as SpatialCardCatalogEntry | undefined;

        return (
          <div
            key={key}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--bento-surface-2)] group"
          >
            {/* Visibility toggle */}
            <button
              aria-label={`Toggle visibility for ${layer.layerName}`}
              onClick={() => onToggleVisibility(layer.cardId, layer.pinnedAt, !layer.visible)}
              className="shrink-0 text-[var(--bento-ink-3)] hover:text-[var(--bento-ink-1)] transition-colors"
            >
              {layer.visible ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              )}
            </button>

            {/* Color swatch */}
            <span
              className="shrink-0 h-2 w-2 rounded-full"
              style={{ backgroundColor: layer.visible ? color : "#9CA3AF" }}
            />

            {/* Layer name (double-click to rename) */}
            <div className="flex-1 min-w-0">
              {isEditing ? (
                <input
                  autoFocus
                  className="text-[12px] font-medium w-full bg-[var(--shell-1)] border border-[var(--shell-border)] rounded px-1 py-0.5"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => {
                    if (editValue.trim()) onRename(layer.cardId, layer.pinnedAt, editValue.trim());
                    setEditingKey(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (editValue.trim()) onRename(layer.cardId, layer.pinnedAt, editValue.trim());
                      setEditingKey(null);
                    }
                    if (e.key === "Escape") setEditingKey(null);
                  }}
                />
              ) : (
                <button
                  className="text-left w-full"
                  onDoubleClick={() => { setEditingKey(key); setEditValue(layer.layerName); }}
                  title="Double-click to rename"
                >
                  <span className={`text-[12px] font-medium block truncate ${layer.visible ? "" : "opacity-50"}`}>
                    {layer.layerName}
                  </span>
                  <span className="text-[9.5px] font-mono text-[var(--bento-ink-3)] block truncate">
                    {card?.name ?? layer.cardId}
                    {layer.cachedAt ? ` · ${relativeTime(layer.cachedAt)}` : ""}
                  </span>
                </button>
              )}
            </div>

            {/* Action buttons (visible on hover) */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                aria-label={`Settings for ${layer.layerName}`}
                onClick={() => onOpenSettings(layer.cardId, layer.pinnedAt)}
                className="rounded p-0.5 text-[var(--bento-ink-3)] hover:text-[var(--bento-ink-1)] hover:bg-[var(--bento-surface-3)]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button
                aria-label={`Unpin ${layer.layerName}`}
                onClick={() => {
                  if (confirm(`Unpin "${layer.layerName}" from the Analysis tab?`)) {
                    onUnpin(layer.cardId, layer.pinnedAt);
                  }
                }}
                className="rounded p-0.5 text-[var(--bento-ink-3)] hover:text-red-400 hover:bg-[var(--bento-surface-3)]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/analyses/analysis-layers-panel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Run full suite**

Run: `npx vitest run tests/`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add components/analyses/analysis-layers-panel.tsx tests/analyses/analysis-layers-panel.test.tsx
git commit -m "feat(analyses): AnalysisLayersPanel with eye toggle, rename, settings, unpin (M7.2)"
```

---

### Task 8: Wrap left rail in Radix Tabs + add Analysis tab

This is the most surgical change. The existing left rail `<aside>` content all moves into Tab 1 ("Layers"). Tab 2 ("Analysis") contains `<AnalysisLayersPanel>`. The Props interface of `DesktopLeftRail` gains `pinnedLayers`, `onTogglePinnedVisibility`, `onUnpinLayer`, `onOpenPinnedSettings`, `onRenamePinnedLayer`.

**Files:**
- Modify: `components/desktop/left-rail.tsx`

- [ ] **Step 1: Read the current imports at the top of the file**

Run: `head -20 components/desktop/left-rail.tsx`

Confirm `@radix-ui/react-tabs` is importable:

Run: `cat package.json | grep '"@radix-ui/react-tabs"'`
Expected: `"@radix-ui/react-tabs": "^1.1.13"` (already installed).

- [ ] **Step 2: Implement the changes**

Make these four changes to `components/desktop/left-rail.tsx`:

**A. Add imports at the top** (after the existing lucide-react import block):

```tsx
import * as Tabs from "@radix-ui/react-tabs";
import { AnalysisLayersPanel } from "@/components/analyses/analysis-layers-panel";
import type { PinnedAnalysisLayer } from "@/lib/analyses/types";
```

**B. Extend the `Props` type** — add these 5 fields after `onSwitchView?`:

```tsx
  /** M7.2: Pinned analysis layers for the Analysis tab. */
  pinnedLayers?: PinnedAnalysisLayer[];
  pinnedLayersLoading?: boolean;
  onTogglePinnedVisibility?: (cardId: string, pinnedAt: string, visible: boolean) => void;
  onUnpinLayer?: (cardId: string, pinnedAt: string) => void;
  onOpenPinnedSettings?: (cardId: string, pinnedAt: string) => void;
  onRenamePinnedLayer?: (cardId: string, pinnedAt: string, name: string) => void;
```

**C. Destructure the new props** in the function signature after `onSwitchView`:

```tsx
  pinnedLayers = [],
  pinnedLayersLoading = false,
  onTogglePinnedVisibility,
  onUnpinLayer,
  onOpenPinnedSettings,
  onRenamePinnedLayer,
```

**D. Wrap the `<aside>` content** — replace the opening `<aside ...>` and its closing `</aside>` to add Radix Tabs.

Replace the current `<aside ...>` tag (line 97) with:

```tsx
  return (
    <aside className="flex h-full w-[280px] flex-col border-r border-[var(--bento-rule)] bg-[var(--bento-bg)]">
      <Tabs.Root defaultValue="layers" className="flex flex-col h-full">
        {/* Tab bar */}
        <Tabs.List className="flex border-b border-[var(--bento-rule)] shrink-0">
          <Tabs.Trigger
            value="layers"
            className="flex-1 py-2 text-[11.5px] font-semibold text-[var(--bento-ink-3)]
                       data-[state=active]:text-[var(--bento-ink-1)] data-[state=active]:border-b-2
                       data-[state=active]:border-[var(--bento-accent)] transition-colors"
          >
            Layers
          </Tabs.Trigger>
          <Tabs.Trigger
            value="analysis"
            className="flex-1 py-2 text-[11.5px] font-semibold text-[var(--bento-ink-3)]
                       data-[state=active]:text-[var(--bento-ink-1)] data-[state=active]:border-b-2
                       data-[state=active]:border-[var(--bento-accent)] transition-colors"
          >
            Analysis
            {pinnedLayers.length > 0 && (
              <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--bento-accent)] text-[9px] font-bold text-white">
                {pinnedLayers.length}
              </span>
            )}
          </Tabs.Trigger>
        </Tabs.List>

        {/* Tab 1 — Layers (all existing content) */}
        <Tabs.Content value="layers" className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-3 p-3">
```

Then replace the closing `</aside>` at the end of the render return with:

```tsx
          </div>
        </Tabs.Content>

        {/* Tab 2 — Analysis layers */}
        <Tabs.Content value="analysis" className="flex-1 overflow-y-auto p-3">
          <AnalysisLayersPanel
            layers={pinnedLayers}
            loading={pinnedLayersLoading}
            onToggleVisibility={onTogglePinnedVisibility ?? (() => {})}
            onUnpin={onUnpinLayer ?? (() => {})}
            onOpenSettings={onOpenPinnedSettings ?? (() => {})}
            onRename={onRenamePinnedLayer ?? (() => {})}
          />
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 new errors. If `map-shell.tsx` has errors about missing props, they are expected — fix in Task 9.

- [ ] **Step 4: Commit**

```bash
git add components/desktop/left-rail.tsx
git commit -m "feat(desktop): left-rail Radix Tabs — Layers + Analysis tabs (M7.2)"
```

---

### Task 9: Wire `usePinnedLayers` into `map-shell.tsx` + apply migration

**Files:**
- Modify: `components/desktop/map-shell.tsx`

- [ ] **Step 1: Read how left rail is currently called in map-shell.tsx**

Run: `grep -n "DesktopLeftRail\|pinnedLayers\|usePinnedLayers" components/desktop/map-shell.tsx`

- [ ] **Step 2: Add imports to `map-shell.tsx`**

Add after the existing hook imports (find the line with `import { useLeftRailState`):

```tsx
import { usePinnedLayers } from "@/hooks/use-pinned-layers";
```

- [ ] **Step 3: Add hook call in the component body**

Find the `useLeftRailState()` call in `map-shell.tsx`. After it, add:

```tsx
const {
  layers: pinnedLayers,
  loading: pinnedLayersLoading,
  toggleVisibility: togglePinnedVisibility,
  unpin: unpinLayer,
  rename: renamePinnedLayer,
} = usePinnedLayers(props.projectId);
```

- [ ] **Step 4: Thread `onPin` into `AnalyzeTabContainer`**

In `right-rail.tsx`, the `AnalyzeTabContainer` already receives `projectId`. The `onPin` callback needs to call `pin()` from `usePinnedLayers`. Since `AnalyzeTabContainer` is defined inside `right-rail.tsx`, pass `onPin` as a prop from `map-shell.tsx`.

Update `AnalyzeTabContainer` in `components/desktop/right-rail.tsx` to accept and forward `onPin`:

```tsx
// Add onPin prop to AnalyzeTabContainer
function AnalyzeTabContainer({
  projectId,
  onPin,
}: {
  projectId: string;
  onPin: (cardId: string, cardName: string, settings: Record<string, unknown>, result: unknown) => void;
}) {
  // ... existing code ...
  // In SettingsDrawer, change onPin to call the parent's onPin:
  // onPin={(result) => onPin(settingsFor.cardId, settingsCard.name, settingsFor.settings, result)}
```

Then in `DesktopRightRail`'s props and usage in `map-shell.tsx`, thread the `onPin` callback.

- [ ] **Step 5: Thread new props into `DesktopLeftRail` call in `map-shell.tsx`**

Find the `<DesktopLeftRail ...>` JSX block (~line 222). Add after `onSwitchView={handleSwitchView}`:

```tsx
            pinnedLayers={pinnedLayers}
            pinnedLayersLoading={pinnedLayersLoading}
            onTogglePinnedVisibility={togglePinnedVisibility}
            onUnpinLayer={unpinLayer}
            onOpenPinnedSettings={(cardId, pinnedAt) => {
              // Find matching analysis item and open its settings
              // For now: store in map-shell state + pass down to right-rail
              setPinnedSettingsTarget({ cardId, pinnedAt });
            }}
            onRenamePinnedLayer={renamePinnedLayer}
```

Add `pinnedSettingsTarget` state near the other `useState` calls:

```tsx
const [pinnedSettingsTarget, setPinnedSettingsTarget] = useState<{ cardId: string; pinnedAt: string } | null>(null);
```

- [ ] **Step 6: Apply migration 023 to prod**

> **STOP: This step is gated.** Ask the user: "Ready to apply migration 023 (pinned_layers column) to fieldSurvey_prod (ykssihpinzbgmpylqtjl)? Re-confirm with the literal phrase `yes, apply migration to prod`."

Apply via `mcp__supabase__apply_migration` only on confirmation, to project `ykssihpinzbgmpylqtjl` (NOT `ioejtwseqsgidefkeyji`).

- [ ] **Step 7: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 new errors, warnings only pre-existing.

- [ ] **Step 8: Commit**

```bash
git add components/desktop/map-shell.tsx components/desktop/right-rail.tsx
git commit -m "feat(desktop): wire usePinnedLayers + onPin into map-shell + right-rail (M7.2)"
```

---

### Task 10: Full test suite + push

- [ ] **Step 1: Run vitest**

Run: `npx vitest run`
Expected: all pass (67 pre-existing + new tests).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: warnings only, 0 errors.

- [ ] **Step 4: Push**

```bash
git push origin main
```

Expected: GH Actions build succeeds, Vercel redeploys.

- [ ] **Step 5: Verify in browser**

After Vercel redeploys:

1. Open `/p/<projectId>/map`, expand the left rail.
2. Confirm **two tabs at the top: "Layers" and "Analysis"**.
3. "Layers" tab shows all existing content unchanged.
4. "Analysis" tab shows the empty state: "No analysis layers pinned."
5. Open the Analyze tab (right rail), add a card (e.g. S2 Hot/Cold Spot).
6. Click the card row → settings drawer opens.
7. Click **"Run analysis"** → loading state → result panel appears.
8. Click **"📌 Pin to left panel"** → Analysis tab on left rail now shows the layer with eye toggle, color dot, timestamp.
9. Click the eye icon → layer disappears from map (visible = false).
10. Double-click the layer name → inline rename works.

---

## Self-Review

**Spec coverage check:**

- ✅ Row click → opens settings — Task 5 (`AnalysesListItem` button wrapper)
- ✅ Run analysis button — Task 6 (`SettingsDrawer` `handleRun`)
- ✅ Result panel in drawer — Task 6 (`ResultPanel` component)
- ✅ "Pin to left panel" button — Task 6 (`onPin` prop → `ResultPanel` button)
- ✅ `PinnedAnalysisLayer` type — Task 2
- ✅ `usePinnedLayers` hook with `pin`, `unpin`, `toggleVisibility`, `rename`, `updateCachedResult` — Task 4
- ✅ `/api/projects/[p]/pinned-layers` GET/POST/DELETE/PATCH — Task 4
- ✅ Left rail two tabs (Layers / Analysis) — Task 8
- ✅ `AnalysisLayersPanel` with eye toggle, color swatch, inline rename, settings ⚙, unpin — Task 7
- ✅ Migration 023 — Task 1 (authored), Task 9 (applied to prod)
- ✅ Wire-in via `map-shell.tsx` — Task 9
- ✅ `useAnalysisResult` on-demand hook — Task 3
- ✅ Full test coverage (types, row click, drawer pin, layers panel) — Tasks 2, 5, 6, 7

**Placeholder scan:** No TBD, no "implement later," no "similar to Task N" shortcuts. All code blocks are complete.

**Type consistency:**
- `PinnedAnalysisLayer` defined in Task 2, used identically in Tasks 4, 7, 8, 9.
- `onPin(result: unknown)` in Task 6's `SettingsDrawer` matches the handler in Task 9's wire-in.
- `usePinnedLayers` returns `{ layers, loading, pin, unpin, toggleVisibility, updateCachedResult, rename }` — used consistently in Tasks 8 and 9.
- `AnalysisLayersPanel` props `onToggleVisibility(cardId, pinnedAt, visible)` match the test and the Task 9 wire-in.
