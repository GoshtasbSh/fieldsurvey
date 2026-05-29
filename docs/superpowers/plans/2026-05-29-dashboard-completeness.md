# Dashboard Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the FieldSurvey dashboard end-to-end for both desktop and mobile, across all five user types (owner, admin, surveyor, viewer, public), and close the M4 deferred items (cache reads, restored-view swap, DB-side export throttle).

**Architecture:** Most M4 features already shipped (per memory, verified on disk). What remains is (a) translating the approved Bento `/home` mockup into real Next.js, (b) auditing & tightening role-aware behavior across the desktop and mobile shells, (c) wiring the cache layer for reads + restored-view content swap, and (d) one new DB column + index to harden the export throttle. Live Leaflet per-card map thumbs on `/home` (no snapshot pipeline in v1 — saves shipping a headless renderer; defer that to a follow-up).

**Tech Stack:** Next.js 15.3.9 (App Router) · React 19 · Supabase (SSR + browser + admin) · Tailwind + Bento token system · MapLibre (in-survey) + Leaflet (front-of-house) · Plus Jakarta Sans / Inter / IBM Plex Mono · TypeScript strict.

**Out of scope (separate future milestones):**
- M5 — Guest mode, universe opt-in, static-PNG snapshot pipeline for /home cards.
- M6 — PostGIS parcels + admin-drawn boundaries.
- GeoChatBot (Q8 placeholder slot only — actual LLM integration in a separate project).

---

## Role × Surface authority matrix

This is the source of truth for what every role can do on every surface. Every task below references this matrix.

| Surface | Owner | Admin | Surveyor | Viewer | Public (anon) |
|---|---|---|---|---|---|
| `/home` | Full | Full | Full | Full (see only own + shared) | → `/sign-in` |
| `/p/[id]/map` desktop | All + delete project | All except delete | Edit symbology, edit own points | Read-only, no Add FAB, no symbology, no settings link | Redirect to `/public/[id]` if public_read else 404 |
| `/p/[id]/settings` | ✓ | ✓ | 404 | 404 | 404 |
| `/p/[id]/members` | Invite + remove + role | Invite + remove + role | Roster + presence only | Roster + presence only | 404 |
| `/p/[id]/import` | ✓ | ✓ | 404 | 404 | 404 |
| `/p/[id]/responses` | Read | Read | Read | Read | 404 |
| `/p/[id]/points` | Edit all | Edit all | Edit own only | Read-only | 404 |
| `/p/[id]/field` mobile | Collect | Collect | Collect | Redirect to desktop | 404 |
| `/public/[id]` | n/a | n/a | n/a | n/a | Map + counts only (no chat, no PII) |
| Chat | Write | Write | Write | **No write** | n/a |
| Recipients admin | ✓ | ✓ | 404 | 404 | n/a |
| Symbology sliders | ✓ | ✓ | ✓ | Read-only | n/a |
| Export-my-data | ✓ (own points) | ✓ (own points) | ✓ (own points) | n/a | n/a |

---

## File structure — overview of what gets created or modified

### Files created
- `lib/queries/home.ts` — `listHomeCards()` query (per-project completed/points/last_activity/center/bbox)
- `components/home/home-topbar.tsx` — wordmark + ⌘K search + view toggle + +New project + avatar menu
- `components/home/project-card.tsx` — Bento card with live Leaflet thumb + 3 stats + status glyph + hover mode buttons
- `components/home/project-row.tsx` — list-view row variant
- `components/home/view-toggle.tsx` — grid/list toggle persisting to localStorage
- `components/home/drafts-row.tsx` — section above owned/shared when any project matches the draft heuristic
- `components/home/empty-state.tsx` — illustrated parcel-grid empty state
- `components/home/home-thumb.tsx` — lazy-init Leaflet client component for one project (IntersectionObserver-gated)
- `lib/cache/read.ts` — `readCachedBlob(projectId, key)` helper that the in-survey shell consumes
- `supabase/migrations/009_export_throttle.sql` — adds `profiles.last_export_at`
- `tests/queries/home.test.ts` — unit tests for `listHomeCards`
- `tests/cache/read.test.ts` — unit tests for `readCachedBlob`

### Files modified
- `app/home/page.tsx` — full rewrite as Bento grid composing the new components
- `app/home/layout.tsx` — minor — uses Bento token surface
- `components/project-card.tsx` — DELETE (superseded by new `components/home/project-card.tsx`)
- `app/p/[projectId]/(desktop)/responses/page.tsx` — soften role gate to allow viewer (read-only)
- `app/p/[projectId]/(desktop)/points/page.tsx` — disable edit affordances for viewer
- `app/p/[projectId]/(mobile)/layout.tsx` — redirect viewer to desktop with friendly message
- `app/p/[projectId]/(mobile)/field/page.tsx` — same guard
- `app/api/chat/route.ts` (existing POST) — block viewer
- `app/api/export/my-data/route.ts` — switch in-memory throttle to `profiles.last_export_at`
- `components/desktop/map-shell.tsx` — pass full role to children; gate Add FAB + settings link
- `components/desktop/map-overlays.tsx` — hide Add capsule for viewer
- `components/desktop/topbar.tsx` — hide Settings link for non-admin
- `components/desktop/right-rail.tsx` — disable chat composer for viewer
- `components/chat/chat-panel.tsx` — hide composer for viewer
- `app/p/[projectId]/(desktop)/map/page.tsx` — read cache blobs when available; fall back to raw queries
- `lib/queries/analytics.ts` — minor — accept optional cached payload, prefer it
- `components/desktop/history-dropdown.tsx` — connect "View" to a Provider-backed content swap (not just banner)

---

## Phase 1 — `/home` Manage page (Bento, real OSM thumbs)

> Translates the approved mockup `mockups/manage-mission-control.html` into real Next.js. Same skeleton; thumbnails are live Leaflet (Carto Dark) instead of static PNGs.

### Task 1.1: Query — `listHomeCards()`

**Files:**
- Create: `lib/queries/home.ts`

- [ ] **Step 1: Write file `lib/queries/home.ts`** with the shape below.

```ts
import { createServerSupabase } from "@/lib/supabase/server";

export type HomeCard = {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  center_lat: number;
  center_lon: number;
  default_zoom: number;
  visibility: "private" | "public_read";
  archived: boolean;
  created_at: string;
  role: string;
  completed_count: number;
  point_count: number;
  last_activity_at: string | null;
  last_actor_name: string | null;
  status: "active" | "setup_incomplete" | "archived";
};

export async function listHomeCards(): Promise<{ owned: HomeCard[]; shared: HomeCard[]; drafts: HomeCard[] }> {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { owned: [], shared: [], drafts: [] };

  // 1. Pull projects with role
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: projRaw } = await sbAny
    .from("projects")
    .select("id, name, description, owner_id, center_lat, center_lon, default_zoom, visibility, archived, created_at, project_members!inner(role)")
    .order("updated_at", { ascending: false });

  type Row = {
    id: string; name: string; description: string | null; owner_id: string;
    center_lat: number; center_lon: number; default_zoom: number;
    visibility: string; archived: boolean; created_at: string;
    project_members: Array<{ role: string }>;
  };
  const rows: Row[] = (projRaw ?? []) as Row[];
  if (rows.length === 0) return { owned: [], shared: [], drafts: [] };

  const ids = rows.map((r) => r.id);

  // 2. Bulk per-project stats — parallel
  const [respCounts, pointCounts, recent] = await Promise.all([
    sbAny
      .from("survey_responses")
      .select("project_id, count:project_id", { count: "estimated", head: false })
      .in("project_id", ids)
      .eq("raw_data->>status", "Completed"),
    sbAny
      .from("points")
      .select("project_id, updated_at, collector_id")
      .in("project_id", ids),
    sbAny
      .from("profiles")
      .select("id, display_name, email"),
  ]);

  type PointRow = { project_id: string; updated_at: string; collector_id: string | null };
  const pointRows: PointRow[] = (pointCounts.data ?? []) as PointRow[];
  type ProfileRow = { id: string; display_name: string | null; email: string };
  const profiles: Map<string, ProfileRow> = new Map(
    ((recent.data ?? []) as ProfileRow[]).map((p) => [p.id, p]),
  );

  // 3. Aggregate per project
  const cards: HomeCard[] = rows.map((r) => {
    const myPoints = pointRows.filter((p) => p.project_id === r.id);
    const latestPoint = myPoints
      .sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1))[0];
    const completedRow = (respCounts.data ?? []).find(
      (x: { project_id: string; count: number }) => x.project_id === r.id,
    );
    const completedCount = (completedRow?.count as number | undefined) ?? 0;
    const pointCount = myPoints.length;
    const lastActorId = latestPoint?.collector_id ?? null;
    const lastActorName =
      lastActorId && profiles.has(lastActorId)
        ? profiles.get(lastActorId)?.display_name ?? profiles.get(lastActorId)?.email ?? null
        : null;
    const ageDays = (Date.now() - new Date(r.created_at).getTime()) / 86_400_000;
    const status: HomeCard["status"] = r.archived
      ? "archived"
      : pointCount === 0 && completedCount === 0 && ageDays < 7
      ? "setup_incomplete"
      : "active";
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      owner_id: r.owner_id,
      center_lat: r.center_lat,
      center_lon: r.center_lon,
      default_zoom: r.default_zoom,
      visibility: r.visibility as "private" | "public_read",
      archived: r.archived,
      created_at: r.created_at,
      role: r.project_members[0].role,
      completed_count: completedCount,
      point_count: pointCount,
      last_activity_at: latestPoint?.updated_at ?? null,
      last_actor_name: lastActorName,
      status,
    };
  });

  return {
    owned: cards.filter((c) => c.owner_id === user.id && c.status !== "setup_incomplete"),
    shared: cards.filter((c) => c.owner_id !== user.id && c.status !== "setup_incomplete"),
    drafts: cards.filter((c) => c.status === "setup_incomplete"),
  };
}
```

- [ ] **Step 2: Add unit test `tests/queries/home.test.ts`** verifying the bucket split, draft heuristic, and the stat aggregation.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(),
}));

// minimal stub builder for chainable supabase mocks
function makeChain(data: unknown) {
  const obj: Record<string, unknown> = {};
  for (const k of ["select", "eq", "in", "order"]) obj[k] = () => obj;
  obj.then = (resolve: (v: { data: unknown }) => void) => resolve({ data });
  return obj;
}

describe("listHomeCards", () => {
  beforeEach(() => vi.resetModules());

  it("returns empty buckets when no user", async () => {
    const { createServerSupabase } = await import("@/lib/supabase/server");
    (createServerSupabase as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: () => makeChain([]),
    });
    const { listHomeCards } = await import("@/lib/queries/home");
    const out = await listHomeCards();
    expect(out).toEqual({ owned: [], shared: [], drafts: [] });
  });
});
```

- [ ] **Step 3: Run test** `npx vitest run tests/queries/home.test.ts -t "returns empty buckets"` → expect 1 passed.

- [ ] **Step 4: Commit**

```bash
git add lib/queries/home.ts tests/queries/home.test.ts
git commit -m "feat(home): add listHomeCards query with role, stats, draft heuristic"
```

### Task 1.2: Lazy-init Leaflet thumb component

**Files:**
- Create: `components/home/home-thumb.tsx`

- [ ] **Step 1: Write component.**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";

type Props = {
  lat: number;
  lon: number;
  zoom?: number;
  basemap?: "dark" | "satellite";
};

export function HomeThumb({ lat, lon, zoom = 13, basemap = "dark" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !ref.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current) return;
      const m = L.map(ref.current, {
        center: [lat, lon],
        zoom,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
        // @ts-expect-error - tap exists at runtime
        tap: false,
      });
      mapRef.current = m;
      const tileUrl =
        basemap === "satellite"
          ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
      L.tileLayer(tileUrl, { maxZoom: 19, subdomains: "abcd" }).addTo(m);
      if (ref.current) ref.current.style.pointerEvents = "none";
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [visible, lat, lon, zoom, basemap]);

  return <div ref={ref} className="h-full w-full bg-[var(--bento-surface-3)]" aria-hidden />;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/home/home-thumb.tsx
git commit -m "feat(home): lazy-init Leaflet thumb component (intersection observer)"
```

### Task 1.3: Bento project card

**Files:**
- Create: `components/home/project-card.tsx`

- [ ] **Step 1: Write component.**

```tsx
import Link from "next/link";
import { HomeThumb } from "./home-thumb";
import type { HomeCard } from "@/lib/queries/home";

function relTime(iso: string | null): string {
  if (!iso) return "no activity";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function StatusGlyph({ status }: { status: HomeCard["status"] }) {
  if (status === "active") return <span className="inline-block h-2 w-2 rounded-full bg-[var(--bento-accent)] shadow-[0_0_6px_var(--bento-accent-glow)]" aria-label="Active" />;
  if (status === "setup_incomplete") return <span className="inline-block h-2 w-2 rounded-full border border-[var(--bento-warning)]" aria-label="Setup incomplete" />;
  return <span className="inline-block h-2 w-2 rounded-full border border-[var(--bento-ink-3)]" aria-label="Archived" />;
}

export function ProjectCard({ card }: { card: HomeCard }) {
  return (
    <Link
      href={`/p/${card.id}`}
      className="group block overflow-hidden rounded-[var(--bento-radius-lg)] border border-[var(--bento-rule)] bg-[var(--bento-surface)] shadow-[var(--bento-shadow-sm)] transition-transform duration-200 hover:-translate-y-1 hover:shadow-[var(--bento-shadow-lg)]"
      aria-label={`Open project ${card.name}, ${card.status}, ${card.completed_count} completed, ${card.point_count} points, last activity ${relTime(card.last_activity_at)}`}
    >
      <div className="aspect-[16/9] overflow-hidden">
        <div className="h-full w-full transition-transform duration-300 group-hover:scale-105">
          <HomeThumb lat={card.center_lat} lon={card.center_lon} zoom={card.default_zoom ?? 13} />
        </div>
      </div>
      <div className="p-4">
        <div className="mb-1 flex items-center gap-2">
          <StatusGlyph status={card.status} />
          <h3 className="font-display text-[15.5px] font-bold leading-tight text-[var(--bento-ink-1)]">{card.name}</h3>
        </div>
        <p className="line-clamp-1 text-[12.5px] text-[var(--bento-ink-2)]">{card.description ?? "No description"}</p>
        <div className="mt-3 flex items-end justify-between">
          <div className="flex gap-4">
            <Stat n={card.completed_count} l="completed" />
            <Stat n={card.point_count} l="points" />
            <Stat n={relTime(card.last_activity_at)} l="activity" />
          </div>
          {card.last_actor_name ? (
            <span className="text-[11px] text-[var(--bento-ink-3)]">{card.last_actor_name}</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function Stat({ n, l }: { n: number | string; l: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[16px] font-semibold leading-none text-[var(--bento-ink-1)]">{n}</span>
      <span className="bento-label">{l}</span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/home/project-card.tsx
git commit -m "feat(home): Bento project card with live thumb + stats + status glyph"
```

### Task 1.4: List-view row + view toggle

**Files:**
- Create: `components/home/project-row.tsx`
- Create: `components/home/view-toggle.tsx`

- [ ] **Step 1: Write `components/home/project-row.tsx`.**

```tsx
import Link from "next/link";
import type { HomeCard } from "@/lib/queries/home";

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d === 0) return `${Math.floor(ms / 3_600_000)}h`;
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

export function ProjectRow({ card }: { card: HomeCard }) {
  return (
    <Link
      href={`/p/${card.id}`}
      className="grid grid-cols-[20px_minmax(160px,1fr)_minmax(180px,2fr)_80px_80px_90px_140px] items-center gap-3 border-b border-[var(--bento-rule)] px-4 py-3 transition-colors hover:bg-[var(--bento-surface-2)]"
    >
      <span className={card.status === "active" ? "h-1.5 w-1.5 rounded-full bg-[var(--bento-accent)]" : "h-1.5 w-1.5 rounded-full border border-[var(--bento-ink-3)]"} />
      <span className="truncate font-display text-[13.5px] font-bold text-[var(--bento-ink-1)]">{card.name}</span>
      <span className="truncate text-[12px] text-[var(--bento-ink-2)]">{card.description ?? "—"}</span>
      <span className="text-right font-mono text-[13px] text-[var(--bento-ink-1)]">{card.completed_count}</span>
      <span className="text-right font-mono text-[13px] text-[var(--bento-ink-1)]">{card.point_count}</span>
      <span className="text-right font-mono text-[12px] text-[var(--bento-ink-2)]">{relTime(card.last_activity_at)}</span>
      <span className="truncate text-[12px] text-[var(--bento-ink-3)]">{card.last_actor_name ?? "—"}</span>
    </Link>
  );
}
```

- [ ] **Step 2: Write `components/home/view-toggle.tsx`.**

```tsx
"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, List } from "lucide-react";

type View = "grid" | "list";

export function useHomeView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>("grid");
  useEffect(() => {
    const stored = localStorage.getItem("fs-home-view");
    if (stored === "grid" || stored === "list") setView(stored);
  }, []);
  const setAndStore = (v: View) => {
    setView(v);
    try { localStorage.setItem("fs-home-view", v); } catch { /* ignore */ }
  };
  return [view, setAndStore];
}

export function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="bento-seg">
      <button onClick={() => onChange("grid")} className={view === "grid" ? "bento-seg-on" : ""} aria-pressed={view === "grid"}>
        <LayoutGrid size={13} /> Grid
      </button>
      <button onClick={() => onChange("list")} className={view === "list" ? "bento-seg-on" : ""} aria-pressed={view === "list"}>
        <List size={13} /> List
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/home/project-row.tsx components/home/view-toggle.tsx
git commit -m "feat(home): list-view row + grid/list toggle with localStorage persistence"
```

### Task 1.5: Drafts row + empty state

**Files:**
- Create: `components/home/drafts-row.tsx`
- Create: `components/home/empty-state.tsx`

- [ ] **Step 1: Write `components/home/drafts-row.tsx`.**

```tsx
import Link from "next/link";
import type { HomeCard } from "@/lib/queries/home";
import { ArrowRight } from "lucide-react";

export function DraftsRow({ cards }: { cards: HomeCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="bento-label">Finish setting up · <span className="text-[var(--bento-ink-3)]">{cards.length}</span></h2>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.id}
            href={`/p/${c.id}`}
            className="rounded-[var(--bento-radius-lg)] border border-[var(--bento-warning)]/30 bg-[var(--bento-warning-soft)] p-4 transition-all hover:border-[var(--bento-warning)]/60"
          >
            <h3 className="mb-1 font-display text-[14.5px] font-bold text-[var(--bento-ink-1)]">{c.name}</h3>
            <p className="mb-3 line-clamp-1 text-[12px] text-[var(--bento-ink-2)]">{c.description ?? "—"}</p>
            <span className="inline-flex items-center gap-1.5 rounded-[var(--bento-radius-sm)] bg-[var(--bento-warning)]/15 px-2.5 py-1 text-[11.5px] font-semibold text-[var(--bento-warning)]">
              Resume setup <ArrowRight size={11} />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Write `components/home/empty-state.tsx`.**

```tsx
import Link from "next/link";
import { Plus } from "lucide-react";

export function EmptyState() {
  return (
    <div className="rounded-[var(--bento-radius-xl)] border border-dashed border-[var(--bento-rule)] bg-[var(--bento-surface-2)] p-16 text-center">
      <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-[var(--bento-radius-lg)] bg-[var(--bento-accent-soft)]">
        <div className="h-3 w-3 rounded-full bg-[var(--bento-accent)] shadow-[0_0_18px_var(--bento-accent-glow)]" />
      </div>
      <h2 className="mb-2 font-display text-[24px] font-bold text-[var(--bento-ink-1)]">Your first survey starts with a parcel.</h2>
      <p className="mx-auto mb-6 max-w-[480px] text-[13.5px] leading-relaxed text-[var(--bento-ink-2)]">
        Upload an address list, draw a study area, or import a CSV of responses. FieldSurvey re-geocodes every address and snaps it to its parcel center automatically.
      </p>
      <div className="flex items-center justify-center gap-4">
        <Link
          href="/home/new"
          className="inline-flex items-center gap-2 rounded-[var(--bento-radius-md)] bg-[var(--bento-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--bento-on-accent)] shadow-[var(--bento-shadow-accent)] transition-transform hover:-translate-y-0.5"
        >
          <Plus size={14} /> Create your first project
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/home/drafts-row.tsx components/home/empty-state.tsx
git commit -m "feat(home): drafts row + empty state"
```

### Task 1.6: Home topbar

**Files:**
- Create: `components/home/home-topbar.tsx`

- [ ] **Step 1: Write topbar, reusing the Bento brand grammar from `components/desktop/topbar.tsx`.**

```tsx
import Link from "next/link";
import { Plus } from "lucide-react";
import { UserMenu, type UserMenuUser } from "@/components/user-menu";

export function HomeTopbar({ user }: { user: UserMenuUser }) {
  return (
    <header className="grid h-[64px] grid-cols-[280px_1fr_360px] items-center border-b border-[var(--bento-rule)] bg-[var(--bento-surface)] px-6">
      <div className="flex items-center gap-3">
        <Link href="/home" className="bento-focus relative h-10 w-10 rounded-[12px]" style={{ background: "linear-gradient(135deg, var(--bento-accent), var(--bento-magenta))" }} aria-label="FieldSurvey home">
          <span className="absolute inset-[10px] rounded-[5px]" style={{ background: "var(--bento-surface)" }} />
          <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: "var(--bento-accent)" }} />
        </Link>
        <div className="leading-tight">
          <div className="font-display text-[14.5px] font-bold tracking-tight">
            field<span style={{ color: "var(--bento-accent)" }}>survey</span>
          </div>
          <div className="text-[10.5px] text-[var(--bento-ink-3)]">spatial atlas</div>
        </div>
      </div>
      <div className="flex items-center justify-center" />
      <div className="flex items-center justify-end gap-3">
        <Link
          href="/home/new"
          className="inline-flex items-center gap-2 rounded-[var(--bento-radius-md)] bg-[var(--bento-accent)] px-3.5 py-2 text-[13px] font-semibold text-[var(--bento-on-accent)] shadow-[var(--bento-shadow-accent)]"
        >
          <Plus size={14} /> New project
        </Link>
        <UserMenu user={user} />
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/home/home-topbar.tsx
git commit -m "feat(home): Bento topbar matching dashboard wordmark"
```

### Task 1.7: Rewrite `/home` page composition

**Files:**
- Modify: `app/home/page.tsx`
- Modify: `app/home/layout.tsx`
- Delete: `components/project-card.tsx`

- [ ] **Step 1: Replace `app/home/page.tsx` with composition.**

```tsx
import { listHomeCards } from "@/lib/queries/home";
import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { HomeTopbar } from "@/components/home/home-topbar";
import { HomeBody } from "@/components/home/home-body";

export default async function HomePage() {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/sign-in");
  const { data: profile } = await sb
    .from("profiles")
    .select("display_name, email, avatar_url")
    .eq("id", user.id)
    .maybeSingle();
  const { owned, shared, drafts } = await listHomeCards();
  return (
    <main className="min-h-screen bg-[var(--bento-bg)]">
      <HomeTopbar
        user={{
          id: user.id,
          email: profile?.email ?? user.email ?? "",
          displayName: profile?.display_name ?? null,
          avatarUrl: profile?.avatar_url ?? null,
        }}
      />
      <HomeBody owned={owned} shared={shared} drafts={drafts} />
    </main>
  );
}
```

- [ ] **Step 2: Create `components/home/home-body.tsx` — client component to host the view toggle.**

```tsx
"use client";

import type { HomeCard } from "@/lib/queries/home";
import { DraftsRow } from "./drafts-row";
import { EmptyState } from "./empty-state";
import { ProjectCard } from "./project-card";
import { ProjectRow } from "./project-row";
import { ViewToggle, useHomeView } from "./view-toggle";

export function HomeBody({ owned, shared, drafts }: { owned: HomeCard[]; shared: HomeCard[]; drafts: HomeCard[] }) {
  const [view, setView] = useHomeView();
  const empty = owned.length === 0 && shared.length === 0 && drafts.length === 0;
  return (
    <div className="mx-auto max-w-[1320px] px-6 py-10">
      {empty ? <EmptyState /> : (
        <>
          <DraftsRow cards={drafts} />
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="bento-label">Owned by you · <span className="text-[var(--bento-ink-3)]">{owned.length}</span></h2>
            <ViewToggle view={view} onChange={setView} />
          </div>
          {owned.length === 0 ? (
            <p className="mb-10 text-[13px] text-[var(--bento-ink-3)]">You don't own any projects yet.</p>
          ) : view === "grid" ? (
            <div className="mb-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {owned.map((c) => <ProjectCard key={c.id} card={c} />)}
            </div>
          ) : (
            <div className="mb-10 overflow-hidden rounded-[var(--bento-radius-lg)] border border-[var(--bento-rule)] bg-[var(--bento-surface)]">
              {owned.map((c) => <ProjectRow key={c.id} card={c} />)}
            </div>
          )}
          {shared.length > 0 && (
            <>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="bento-label">Shared with you · <span className="text-[var(--bento-ink-3)]">{shared.length}</span></h2>
              </div>
              {view === "grid" ? (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {shared.map((c) => <ProjectCard key={c.id} card={c} />)}
                </div>
              ) : (
                <div className="overflow-hidden rounded-[var(--bento-radius-lg)] border border-[var(--bento-rule)] bg-[var(--bento-surface)]">
                  {shared.map((c) => <ProjectRow key={c.id} card={c} />)}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Simplify `app/home/layout.tsx`.**

```tsx
import "leaflet/dist/leaflet.css";

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

- [ ] **Step 4: Delete `components/project-card.tsx` (superseded).**

```bash
git rm components/project-card.tsx
```

- [ ] **Step 5: Typecheck.**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add app/home/page.tsx app/home/layout.tsx components/home/home-body.tsx
git commit -m "feat(home): Bento manage page composition (grid/list/drafts/empty)"
```

### Task 1.8: Mobile `/home`

**Files:**
- Modify: `components/home/home-body.tsx` to be responsive (drops to 1-column grid, hides sidebars).
- (No code change beyond the Tailwind classes already wired in 1.7 — verify in dev.)

- [ ] **Step 1: `npm run dev` and test at 390px viewport.** Confirm cards stack one-per-row and view toggle remains visible. No code edits expected.

- [ ] **Step 2: Commit (no-op if unchanged) — or fix any responsive bug found.**

---

## Phase 2 — Role-aware completeness (desktop)

> Audit + tighten every desktop surface against the role × surface matrix at the top of the plan.

### Task 2.1: Type-safe role helper

**Files:**
- Create: `lib/auth/role.ts`

- [ ] **Step 1: Write helper.**

```ts
export type ProjectRole = "owner" | "admin" | "surveyor" | "viewer" | null;

export function canEditProject(role: ProjectRole): boolean {
  return role === "owner" || role === "admin";
}
export function canEditPoints(role: ProjectRole): boolean {
  return role === "owner" || role === "admin" || role === "surveyor";
}
export function canEditOthersPoints(role: ProjectRole): boolean {
  return role === "owner" || role === "admin";
}
export function canEditSymbology(role: ProjectRole): boolean {
  return role === "owner" || role === "admin" || role === "surveyor";
}
export function canManageMembers(role: ProjectRole): boolean {
  return role === "owner" || role === "admin";
}
export function canManageRecipients(role: ProjectRole): boolean {
  return role === "owner" || role === "admin";
}
export function canWriteChat(role: ProjectRole): boolean {
  return role === "owner" || role === "admin" || role === "surveyor";
}
export function canAccessSettings(role: ProjectRole): boolean {
  return role === "owner" || role === "admin";
}
export function canImport(role: ProjectRole): boolean {
  return role === "owner" || role === "admin";
}
export function canCollectMobile(role: ProjectRole): boolean {
  return role === "owner" || role === "admin" || role === "surveyor";
}
```

- [ ] **Step 2: Write unit test `tests/auth/role.test.ts`.**

```ts
import { describe, it, expect } from "vitest";
import * as R from "@/lib/auth/role";

describe("role helpers", () => {
  it("owner can do everything", () => {
    expect(R.canEditProject("owner")).toBe(true);
    expect(R.canManageMembers("owner")).toBe(true);
    expect(R.canCollectMobile("owner")).toBe(true);
  });
  it("viewer can do nothing destructive", () => {
    expect(R.canEditProject("viewer")).toBe(false);
    expect(R.canEditPoints("viewer")).toBe(false);
    expect(R.canEditSymbology("viewer")).toBe(false);
    expect(R.canWriteChat("viewer")).toBe(false);
    expect(R.canCollectMobile("viewer")).toBe(false);
  });
  it("surveyor can collect + edit own + symbology, not admin", () => {
    expect(R.canCollectMobile("surveyor")).toBe(true);
    expect(R.canEditSymbology("surveyor")).toBe(true);
    expect(R.canManageMembers("surveyor")).toBe(false);
    expect(R.canAccessSettings("surveyor")).toBe(false);
  });
  it("unauthenticated null is locked out", () => {
    expect(R.canEditPoints(null)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test.**

```bash
npx vitest run tests/auth/role.test.ts
```

Expected: all 4 passed.

- [ ] **Step 4: Commit**

```bash
git add lib/auth/role.ts tests/auth/role.test.ts
git commit -m "feat(auth): typed role helpers with unit tests"
```

### Task 2.2: Gate Settings link in topbar

**Files:**
- Modify: `components/desktop/topbar.tsx`

- [ ] **Step 1: Add `role?: ProjectRole` prop and conditionally render the Settings link only when `canAccessSettings(role)`.** Read current topbar to locate where the History dropdown sits; the settings link belongs near there but only for admin+.

- [ ] **Step 2: Update `map-shell.tsx` to thread `role` through to the topbar.**

- [ ] **Step 3: Verify typecheck.**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add components/desktop/topbar.tsx components/desktop/map-shell.tsx
git commit -m "feat(role): gate Settings link to owner/admin in desktop topbar"
```

### Task 2.3: Gate Add-point capsule + Add modal for viewer

**Files:**
- Modify: `components/desktop/map-overlays.tsx`
- Modify: `components/desktop/map-shell.tsx`

- [ ] **Step 1: Thread `role` to `map-overlays.tsx`. Wrap the Add capsule + Add modal trigger with `canEditPoints(role)` check.**

- [ ] **Step 2: Typecheck + commit.**

```bash
git add components/desktop/map-overlays.tsx components/desktop/map-shell.tsx
git commit -m "feat(role): hide Add-point affordance for viewer on desktop map"
```

### Task 2.4: Gate chat composer for viewer + API enforcement

**Files:**
- Modify: `components/chat/chat-panel.tsx`
- Modify: `app/api/chat/route.ts` (if exists; otherwise wherever POST /api/chat lives)

- [ ] **Step 1: Add `role?: ProjectRole` prop to ChatPanel. Render composer textarea + send button only when `canWriteChat(role)`. Show inline message "Viewers can read but not write" when role === 'viewer'.**

- [ ] **Step 2: Locate POST handler for chat messages (`grep -rn "from(\"chat_messages\").insert" app/`). Add server-side guard returning 403 when `project_role(projectId)` is `viewer` or null.**

- [ ] **Step 3: Add test fixture `tests/role/chat-viewer.test.ts` mocking supabase to verify the guard returns 403.**

- [ ] **Step 4: Commit**

```bash
git add components/chat/chat-panel.tsx app/api/chat/route.ts tests/role/chat-viewer.test.ts
git commit -m "feat(role): viewer cannot write chat (UI + server enforce)"
```

### Task 2.5: Allow viewer access to /responses (read-only)

**Files:**
- Modify: `app/p/[projectId]/(desktop)/responses/page.tsx`

- [ ] **Step 1: Read the file. Locate any `notFound()` call that rejects viewer. Soften to allow viewer; ensure the table is rendered without per-row edit affordances.**

- [ ] **Step 2: Typecheck + commit.**

```bash
git add app/p/[projectId]/(desktop)/responses/page.tsx
git commit -m "feat(role): viewer can view responses page (read-only)"
```

### Task 2.6: Points page — surveyor sees only own edit affordances

**Files:**
- Modify: `app/p/[projectId]/(desktop)/points/page.tsx`
- Modify: `components/desktop/points-table.tsx`

- [ ] **Step 1: Pass `role` + `currentUserId` to `points-table.tsx`. Conditionally render Edit / Delete buttons per row: visible only when `canEditOthersPoints(role)` OR `point.collector_id === currentUserId`.**

- [ ] **Step 2: Verify in dev with three accounts (owner / surveyor / viewer).** (Manual smoke; document in commit message.)

- [ ] **Step 3: Commit**

```bash
git add app/p/[projectId]/(desktop)/points/page.tsx components/desktop/points-table.tsx
git commit -m "feat(role): points table edit affordances per role (surveyor=own only, viewer=none)"
```

### Task 2.7: Members page — viewer reads roster, cannot manage

**Files:**
- Modify: `app/p/[projectId]/(desktop)/members/page.tsx`

- [ ] **Step 1: Replace any `notFound()` for non-admin with role-aware rendering. Pass `canManage = canManageMembers(role)` to the client list. Hide invite form + role-edit dropdown when `!canManage`.**

- [ ] **Step 2: Commit**

```bash
git add app/p/[projectId]/(desktop)/members/page.tsx
git commit -m "feat(role): members page read-only for surveyor/viewer"
```

### Task 2.8: Recipients admin — already admin-gated, double-check

**Files:**
- Modify: `components/desktop/recipients-admin.tsx` (if it shows up in settings even when surveyor lands there — but settings already gates on admin+, so this should be safe)

- [ ] **Step 1: grep `RecipientsAdmin` usage and confirm it only appears inside `/p/[id]/settings/page.tsx`. If yes, no change needed — note in commit log.**

- [ ] **Step 2: No commit if unchanged.**

---

## Phase 3 — Role-aware mobile

### Task 3.1: Block viewer from mobile field shell

**Files:**
- Modify: `app/p/[projectId]/(mobile)/layout.tsx`

- [ ] **Step 1: Make the mobile layout async, fetch role via `getProjectForUser`, redirect viewer to a friendly desktop URL `/use-desktop?next=/p/{id}/map` (new tiny page).**

```tsx
import { redirect } from "next/navigation";
import { getProjectForUser } from "@/lib/queries/project";
import { canCollectMobile } from "@/lib/auth/role";

export default async function MobileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const res = await getProjectForUser(projectId);
  const role = (res?.role ?? null) as Parameters<typeof canCollectMobile>[0];
  if (!canCollectMobile(role)) {
    redirect(`/use-desktop?next=/p/${projectId}/map`);
  }
  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--shell-base)] text-[var(--shell-text)]">
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Create `app/use-desktop/page.tsx` — minimal explainer.**

```tsx
import Link from "next/link";

export default async function UseDesktopPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[var(--bento-bg)] px-6 text-[var(--bento-ink-1)]">
      <div className="max-w-md text-center">
        <h1 className="mb-3 font-display text-[24px] font-bold">Open this on a desktop</h1>
        <p className="mb-6 text-[14px] text-[var(--bento-ink-2)]">
          Viewer access is read-only and lives on the desktop dashboard, not the mobile field PWA.
        </p>
        <Link
          href={sp.next ?? "/home"}
          className="inline-flex items-center gap-2 rounded-[var(--bento-radius-md)] bg-[var(--bento-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--bento-on-accent)]"
        >
          Go to {sp.next ?? "home"}
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add "app/p/[projectId]/(mobile)/layout.tsx" app/use-desktop/page.tsx
git commit -m "feat(role): viewer redirected from mobile field shell to desktop"
```

### Task 3.2: Mobile sync error guard — anonymous user

**Files:**
- Modify: `components/mobile/field-shell.tsx`

- [ ] **Step 1: Inspect `field-shell.tsx` sync queue submission. Verify it already requires auth (it should via Supabase RLS). If not, add a `try { await sb.auth.getUser() }` guard.**

- [ ] **Step 2: No commit if no change needed.**

---

## Phase 4 — Cache READ wiring

### Task 4.1: `readCachedBlob()` helper + tests

**Files:**
- Create: `lib/cache/read.ts`
- Create: `tests/cache/read.test.ts`

- [ ] **Step 1: Write helper.**

```ts
import { createServerSupabase } from "@/lib/supabase/server";

export type CacheKey = "pulse_blob" | "analyze_blob" | "match_status_blob" | "points_geojson" | "responses_geojson";

export async function readCachedBlob<T = unknown>(projectId: string, key: CacheKey): Promise<{ payload: T; computed_at: string } | null> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("dashboard_cache") as any)
    .select("payload, computed_at")
    .eq("project_id", projectId)
    .eq("data_type", key)
    .maybeSingle();
  if (!data) return null;
  return { payload: data.payload as T, computed_at: data.computed_at as string };
}
```

- [ ] **Step 2: Test happy + miss path. Commit.**

```bash
git add lib/cache/read.ts tests/cache/read.test.ts
git commit -m "feat(cache): readCachedBlob helper for in-survey shell"
```

### Task 4.2: Map page reads cached blobs with raw fallback

**Files:**
- Modify: `app/p/[projectId]/(desktop)/map/page.tsx`

- [ ] **Step 1: For `pulse_blob`, `analyze_blob`, `match_status_blob`, `points_geojson` — call `readCachedBlob` first. If null OR `computed_at` is older than 1 hour, fall back to the existing raw query. Pass the cached `computed_at` down to `<MapShell>` so the UI can show "as of N hours ago".**

- [ ] **Step 2: Commit**

```bash
git add app/p/[projectId]/(desktop)/map/page.tsx
git commit -m "feat(cache): map page reads dashboard_cache with raw query fallback"
```

### Task 4.3: "Cached as of …" badge in topbar

**Files:**
- Modify: `components/desktop/topbar.tsx`
- Modify: `components/desktop/map-shell.tsx`

- [ ] **Step 1: Add `cachedAt?: string | null` prop to topbar. Render a small mono badge "cached 14m ago" when present. Update Map page to pass it.**

- [ ] **Step 2: Commit**

```bash
git add components/desktop/topbar.tsx components/desktop/map-shell.tsx
git commit -m "feat(cache): topbar shows cache freshness badge"
```

---

## Phase 5 — Restored-view content swap

> Currently the History dropdown banner appears but the dashboard still shows live data. Wire the provider so consumers actually swap.

### Task 5.1: Provider exposes typed snapshot

**Files:**
- Modify: `components/desktop/history-dropdown.tsx`

- [ ] **Step 1: Extend `RestoredViewProvider` to carry `payload` (the JSONB) and `data_type`. Update `useRestoredView()` return shape.**

- [ ] **Step 2: When user clicks View on a row, fetch the row's payload via `GET /api/projects/{id}/history/{versionId}` (new endpoint) — but the existing list endpoint already includes payload? Verify; if not, add the by-id endpoint.**

- [ ] **Step 3: Commit**

```bash
git add components/desktop/history-dropdown.tsx app/api/projects/[projectId]/history/[versionId]/route.ts
git commit -m "feat(history): provider carries snapshot payload + by-id endpoint"
```

### Task 5.2: MapShell prefers snapshot over live data

**Files:**
- Modify: `components/desktop/map-shell.tsx`
- Modify: `components/desktop/right-rail.tsx`

- [ ] **Step 1: Inside MapShell, consume `useRestoredView()`. When `active`, swap `features` (from match_status_blob payload) and Pulse/Analyze counters. Block all mutations (overlay the Add capsule with a "viewing snapshot" caption).**

- [ ] **Step 2: Manual verify: enter restored view → Add capsule disabled → exit → Add capsule re-enabled. Commit.**

```bash
git add components/desktop/map-shell.tsx components/desktop/right-rail.tsx
git commit -m "feat(history): restored view actually swaps map + analytics content"
```

---

## Phase 6 — Export throttle to DB

### Task 6.1: Migration 009

**Files:**
- Create: `supabase/migrations/009_export_throttle.sql`

- [ ] **Step 1: Write migration.**

```sql
alter table public.profiles
  add column if not exists last_export_at timestamptz;
```

- [ ] **Step 2: Apply via MCP `apply_migration` after explicit user OK.**

- [ ] **Step 3: Regenerate types via MCP and rewrite `lib/db.types.ts`.**

- [ ] **Step 4: Commit migration.**

```bash
git add supabase/migrations/009_export_throttle.sql lib/db.types.ts
git commit -m "feat(export): add profiles.last_export_at for DB-side throttle"
```

### Task 6.2: Switch route to DB throttle

**Files:**
- Modify: `app/api/export/my-data/route.ts`

- [ ] **Step 1: Replace in-memory `Map<userId, lastExport>` with a SELECT on `profiles.last_export_at`. If less than 1 hour ago → 429. On success → UPDATE profiles set last_export_at = now().**

- [ ] **Step 2: Add unit test mocking supabase to verify 429 returns when within window.**

- [ ] **Step 3: Commit**

```bash
git add app/api/export/my-data/route.ts tests/api/export-throttle.test.ts
git commit -m "feat(export): DB-side throttle via profiles.last_export_at"
```

---

## Phase 7 — End-to-end verification

### Task 7.1: Typecheck + tests + lint full sweep

- [ ] **Step 1: Run all three.**

```bash
npm run typecheck && npm test && npm run lint
```

Expected: all green.

- [ ] **Step 2: Re-run security advisors.**

```
mcp__supabase__get_advisors security
```

Expected: no new warnings beyond pre-existing baseline.

### Task 7.2: Manual smoke per role × surface

- [ ] **Step 1: `npm run dev`. Create three test accounts (owner / surveyor / viewer) inside the same project.**

- [ ] **Step 2: For each role, walk through the role matrix at the top of this plan and confirm each surface matches.**

- [ ] **Step 3: Confirm `/home` renders Leaflet thumbs, grid/list toggle persists, drafts row appears for a brand-new project with zero points.**

- [ ] **Step 4: Confirm restored-view swap by triggering `POST /api/projects/<id>/cache/refresh` twice (once → first snapshot exists), then opening History → View → confirm map and analytics show the snapshot data.**

### Task 7.3: Update memory + spec

- [ ] **Step 1: Append a completion note to `project_fieldsurvey_m4_locked_decisions.md` memory recording what shipped.**

- [ ] **Step 2: Update `project_fieldsurvey_front_of_house.md` memory — the /home page is no longer "awaiting implementation"; it shipped. Reference this plan doc as the build record.**

- [ ] **Step 3: Final commit.**

```bash
git add docs/superpowers/plans/2026-05-29-dashboard-completeness.md
git commit -m "docs: add dashboard completeness plan"
```

---

## Spec coverage self-check

| Plan section | Spec / requirement | Where covered |
|---|---|---|
| Role × surface matrix | User's "different user types" ask | Phase 2 + Phase 3 + Task 2.1 |
| /home Bento + real OSM thumbs | Approved mockup `mockups/manage-mission-control.html` + locked Q "live Leaflet thumbs" | Phase 1 |
| Mobile parity | User's "both dashboards (desktop and mobile)" | Phase 1.8 + Phase 3 |
| Cache reads | Memory's deferred M4 item | Phase 4 |
| Restored-view swap | Memory's deferred M4 item | Phase 5 |
| DB-side export throttle | Memory's deferred M4 item | Phase 6 |
| Migrations 005-008 applied | Earlier session work | Already done — referenced only |
| Front-of-house auth shell | Earlier session work | Already done — referenced only |

Out of scope (carry to future plans): M5 (guest mode, universe, static-PNG snapshot pipeline) and M6 (PostGIS parcels).

No `TBD` / `TODO` / "fill in later" lines present.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-29-dashboard-completeness.md`.**

Two execution options:

1. **Inline Execution (recommended for this scope)** — I execute every phase in this session, with a stop checkpoint at each phase boundary so you can review the diff before moving on. Lower coordination cost; I retain full context.
2. **Subagent-Driven** — A fresh subagent per task with two-stage review. Higher isolation but slower iteration for the >40 task volume here.

My recommendation: **Inline Execution** for this plan — the tasks share a lot of code-style context (Bento tokens, Supabase patterns, role helpers) that's expensive to re-establish per subagent.
