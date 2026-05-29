# M6 + cache content-swap + static thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the three items deferred at the end of M5:
1. **M6 — PostGIS parcels + admin-drawn project boundaries.** Locked by `project_fieldsurvey_keystone_backport_decisions`: FL parcels via PostGIS + admin-drawn boundary. Used to snap canvass-universe rows to parcel centroids on import and to render a per-project boundary overlay on the map.
2. **Cache READ content-swap.** M4 wired the freshness badge but Pulse/Analyze tabs still pull raw values. Prefer `pulse_blob`/`analyze_blob` payloads when fresh; fall back to raw queries.
3. **Static-PNG /home thumbnails.** Replace per-card live Leaflet thumbnails with server-rendered PNGs in Supabase Storage.

**Architecture:**
- PostGIS extension + two new tables (`project_boundaries`, `parcels`) with GIST indexes and member-read RLS. Snap-on-import uses a SQL helper that resolves an address string to its parcel centroid.
- For the cache swap, the desktop map page reads cached blobs in parallel with the raw queries and picks the cache when `age_seconds < THRESHOLD_S`. The tab components don't know about the source — they always receive the same shape.
- Static thumbs are generated server-side by stitching 4 Carto Dark Matter tiles with `sharp`, uploading to a `project-thumbs` Supabase Storage bucket (public-read), and storing the path on `projects`. `/home` renders an `<img>` when the path exists and falls back to live Leaflet otherwise.

**Tech Stack:** Next.js 15 App Router · Supabase Postgres + PostGIS + Storage · `sharp` (already pre-installed by Next.js for `next/image`) · MapLibre overlay for boundaries · Bento token system.

**Out of scope:**
- Boundary drawing on the map (admin uploads GeoJSON; map-draw UI is a future polish).
- Statewide FL parcel ingest (admin uploads per-project GeoJSON; bulk FL ingest is a separate operational job).
- Thumb generation for archived projects.

---

## File structure

### Files created
- `supabase/migrations/012_postgis_parcels_boundaries.sql`
- `supabase/migrations/013_project_thumbs.sql`
- `lib/queries/parcels.ts` — parcel + boundary helpers
- `lib/thumb/generate.ts` — server-side tile stitcher
- `app/api/projects/[projectId]/boundaries/route.ts` — GET list / POST GeoJSON
- `app/api/projects/[projectId]/boundaries/[boundaryId]/route.ts` — DELETE
- `app/api/projects/[projectId]/parcels/upload/route.ts` — POST GeoJSON FeatureCollection
- `app/api/projects/[projectId]/parcels/route.ts` — GET count + DELETE clear
- `app/api/projects/[projectId]/thumb/refresh/route.ts` — POST regenerate
- `components/desktop/boundary-admin.tsx` — upload/delete UI in Settings
- `components/desktop/parcel-admin.tsx` — upload/delete UI in Settings
- `components/map/boundary-overlay.tsx` — MapLibre `GeoJSONSource` + line/fill layers
- `tests/queries/parcels.test.ts`
- `tests/thumb/generate.test.ts`

### Files modified
- `app/p/[projectId]/(desktop)/settings/page.tsx` — adds Boundary and Parcels sections
- `app/p/[projectId]/(desktop)/map/page.tsx` — passes boundary GeoJSON + cached-blob swap
- `components/desktop/map-shell.tsx` — threads boundary + cache-derived props
- `components/map/maplibre-map.tsx` — mounts BoundaryOverlay when GeoJSON present
- `components/mobile/field-shell.tsx` — boundary overlay (read-only)
- `app/api/projects/[projectId]/universe/upload/route.ts` — snap-on-import via parcels
- `app/api/cron/refresh-caches/route.ts` (or equivalent existing hook) — fire thumb-refresh best-effort
- `lib/cache/refresh.ts` — optional best-effort thumb refresh
- `components/home/home-thumb.tsx` — `<img>` swap with Leaflet fallback
- `lib/queries/home.ts` — surface `thumb_path` in HomeCard
- `lib/db.types.ts` — patched for new tables/columns

---

## Phase 1 — Migration 012 (PostGIS + boundaries + parcels)

### Task 1.1: Schema + RLS + indexes + helper RPC

**Files:** Create `supabase/migrations/012_postgis_parcels_boundaries.sql`.

Key shapes:
- `create extension if not exists postgis with schema extensions;` (Supabase pattern)
- `project_boundaries(id uuid pk, project_id uuid fk projects, name text, geometry geometry(MultiPolygon,4326) not null, created_by uuid fk profiles, created_at timestamptz default now())`
- `parcels(id uuid pk, project_id uuid fk projects, county text null, parcel_apn text null, address text null, geometry geometry(MultiPolygon,4326) not null, centroid geometry(Point,4326) not null, source text not null default 'admin-upload', external_id text null, created_at)`
- GIST indexes on `project_boundaries.geometry`, `parcels.geometry`, `parcels.centroid`
- B-tree on `(project_id, lower(address))` for snap lookup
- RLS: project-member read, owner/admin insert/delete (parcels), member read + owner/admin write (boundaries)
- Helper RPC `find_parcel_for_address(p_project uuid, p_address text) returns table(parcel_id uuid, centroid_lat double precision, centroid_lon double precision)` — SECURITY INVOKER, set `search_path = extensions, public, pg_temp`. Uses `lower(address) = lower(p_address)` for an exact match first; future refinement can add fuzzy matching.
- Helper RPC `parcels_within_boundary(p_project uuid) returns setof uuid` — returns parcel ids inside the project's first boundary; used by future workflows (declared but not consumed in this milestone).

- [ ] **Step 1: Write the migration.**
- [ ] **Step 2: Apply via MCP `apply_migration`.**
- [ ] **Step 3: Patch `lib/db.types.ts` with the two new tables + RPC.**
- [ ] **Step 4: `npm run typecheck` → 0 errors.**

---

## Phase 2 — Boundary upload + map overlay

### Task 2.1: API routes
**Files:** Create
- `app/api/projects/[projectId]/boundaries/route.ts` — GET list (member-read), POST `{name?, geojson}` (admin). Body GeoJSON must be `Polygon` or `MultiPolygon`; we coerce Polygon → MultiPolygon. Returns inserted row (id, name, created_at, bbox).
- `app/api/projects/[projectId]/boundaries/[boundaryId]/route.ts` — DELETE (admin).

### Task 2.2: Settings admin UI
**Files:** Create `components/desktop/boundary-admin.tsx`. Modify `app/p/[projectId]/(desktop)/settings/page.tsx`.
- Drag-drop GeoJSON upload or paste-text input. Shows current boundary as a small list with vertex count + delete.

### Task 2.3: Render overlay on desktop map
**Files:** Create `components/map/boundary-overlay.tsx`. Modify `components/map/maplibre-map.tsx`, `app/p/[projectId]/(desktop)/map/page.tsx`, `components/desktop/map-shell.tsx`.
- Server reads `project_boundaries` rows, fetches them as GeoJSON via `ST_AsGeoJSON`.
- MapLibre adds a `GeoJSONSource` + line layer (Bento accent stroke, dashed at z<10, solid otherwise) + a subtle fill.

### Task 2.4: Mobile map mirror
**Files:** Modify `components/mobile/field-shell.tsx`.
- Reuse the same `BoundaryOverlay` component since MapLibre is shared.

---

## Phase 3 — Parcel ingest + universe snap-on-import

### Task 3.1: Upload API
**Files:** Create `app/api/projects/[projectId]/parcels/upload/route.ts`.
- Multipart `file` (GeoJSON FeatureCollection). Each feature must be Polygon/MultiPolygon. Properties optional: `address`, `parcel_apn`, `county`, `external_id`.
- Insert in batches of 200; compute centroid via `ST_Centroid(ST_GeomFromGeoJSON(...))`.
- 100k-row cap, returns `{ inserted, skipped, errors }`.

### Task 3.2: List/clear API
**Files:** Create `app/api/projects/[projectId]/parcels/route.ts`.
- GET returns `{ total }` and a small sample (10 rows for the admin UI).
- DELETE clears all parcels for the project (admin only + `x-confirm: yes`).

### Task 3.3: Admin UI
**Files:** Create `components/desktop/parcel-admin.tsx`. Modify settings page.
- Shows count, last-uploaded-at, drag-drop GeoJSON, clear-all.

### Task 3.4: Snap-on-import
**Files:** Modify `app/api/projects/[projectId]/universe/upload/route.ts`. Create `lib/queries/parcels.ts`.
- For each universe row missing `lat`/`lon`, call `find_parcel_for_address(projectId, address)`. If hit → fill lat/lon from centroid before insert.
- Idempotent: rows that already have coords skip the lookup.

### Task 3.5: Tests
**Files:** Create `tests/queries/parcels.test.ts`.
- Stub Supabase client; assert lookup is called only for null-coord rows.

---

## Phase 4 — Cache content-swap (Pulse/Analyze prefer blobs)

### Task 4.1: Centralized cache-or-raw resolver
**Files:** Modify `app/p/[projectId]/(desktop)/map/page.tsx`.
- After reading `cacheBlobs`, define `FRESH_S = 15 * 60`.
- For each tab's props, prefer cache when present AND `age_seconds < FRESH_S`. Otherwise keep the raw-query value.
- The shape returned by each tab is unchanged; MapShell consumers see no diff.

Specifically:
- `pulse_blob` payload → `pointsTotal`, `todayDelta`, `matchCounts`, `daily`.
- `analyze_blob` payload → `matchCounts`, `hourly`, `dow`, `surveyors`, `coverage`.

### Task 4.2: Surface origin to the UI (optional)
**Files:** Modify `components/desktop/topbar.tsx`.
- Show "live" vs "cached <age>" pill — already shows cached badge; just clarify when source is cache.

---

## Phase 5 — Migration 013 (projects.thumb_path)

### Task 5.1: Schema
**Files:** Create `supabase/migrations/013_project_thumbs.sql`.
- `alter table projects add column thumb_path text null, add column thumb_updated_at timestamptz null;`
- Create Storage bucket `project-thumbs` (public read) via SQL using `storage.create_bucket(...)`.
- Storage RLS: public read; insert/update/delete via service-role only (no policy for anon/authenticated, matches existing photo bucket pattern).

### Task 5.2: Apply + types patch
- [ ] Apply via MCP `apply_migration`.
- [ ] Patch `lib/db.types.ts` columns.

---

## Phase 6 — Static thumb generator + /home swap

### Task 6.1: `lib/thumb/generate.ts`
- Inputs: `{ centerLat, centerLon, zoom: 11, width: 480, height: 280, basemap: 'carto-dark' }`.
- Compute the 4 tiles surrounding the center at zoom `z`. Fetch tiles with cached `Accept-Encoding: gzip` headers (Carto serves 256×256). Composite into a 480×280 canvas using `sharp` (resize + crop the 512×512 tile mosaic).
- Returns a `Buffer` PNG.

### Task 6.2: `/api/projects/[projectId]/thumb/refresh/route.ts`
- POST (admin). Generates the thumb, uploads to `project-thumbs/{projectId}-{ts}.png` via service-role client, sets `projects.thumb_path` + `thumb_updated_at`. Returns the new path.

### Task 6.3: Best-effort hook in cache refresh
**Files:** Modify `lib/cache/refresh.ts`.
- After writing all blobs, if `projects.thumb_updated_at` is missing or older than 7 days, attempt thumb regeneration. Failures non-fatal.

### Task 6.4: `/home` swap
**Files:** Modify `components/home/home-thumb.tsx`, `lib/queries/home.ts`.
- `HomeCard` gains `thumb_path: string | null`.
- `HomeThumb` first renders `<img src={publicUrl}>`; falls back to Leaflet only if path is null. Leaflet path stays IntersectionObserver-gated.

### Task 6.5: Test the stitcher
**Files:** Create `tests/thumb/generate.test.ts`.
- Stub `fetch`, assert `generate` calls four tile URLs at the expected (z,x,y) for a known centerLat/centerLon and returns a non-empty Buffer.

---

## Phase 7 — Verification + memory

- [ ] `npm run typecheck` → 0 errors.
- [ ] `npm test` → all suites pass.
- [ ] `mcp__supabase__get_advisors security` → no new warnings.
- [ ] Update memory: append `project-fieldsurvey-m6-shipped.md`.

---

## Spec coverage self-check

| Spec line | Plan task |
|---|---|
| PostGIS extension on | 1.1 |
| `project_boundaries` table + RLS | 1.1 |
| `parcels` table + RLS + indexes | 1.1 |
| `find_parcel_for_address` RPC | 1.1 |
| Boundary upload + admin UI | 2.1 + 2.2 |
| Render boundary overlay desktop + mobile | 2.3 + 2.4 |
| Parcel GeoJSON ingest + admin UI | 3.1 + 3.2 + 3.3 |
| Universe snap-on-import to parcel centroid | 3.4 |
| Pulse/Analyze prefer cached blobs | 4.1 |
| `projects.thumb_path` + Storage bucket | 5.1 |
| Server-rendered tile-stitch thumbs | 6.1 + 6.2 |
| Auto-refresh on cache write | 6.3 |
| /home renders `<img>` with Leaflet fallback | 6.4 |

No placeholders. No `TBD`s.
