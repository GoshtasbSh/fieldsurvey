# M5 — Guest mode + survey universe (opt-in) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the two locked M5 features from `project_fieldsurvey_keystone_backport_decisions`: (a) Guest mode — admin-issued day-codes let unauthenticated surveyors collect points without an account, and (b) Survey universe — opt-in canvass list per project that drives a mobile "to-visit" UI and switches analytics to canvass-completion %.

**Architecture:**
- **Guest mode** uses a cookie-based session set by `/api/guest/start` after the day-code is validated. Guest writes flow through dedicated server routes (service-role insert) so the API layer is the choke point. `points.guest_session_id` is added so admins can audit which session inserted which point. No Postgres custom claims needed — the API route's session validation is the gate.
- **Universe** is a per-project `survey_universe` table (rows = addresses to visit). A `project_settings.canvass_mode` boolean toggles the feature on per project. When on, mobile shows the to-visit list and point inserts mark the matching row as visited; analytics swap to canvass-completion %.

**Tech Stack:** Next.js 15 App Router · Supabase (Postgres + Storage + RLS) · TypeScript strict · Bento token system · Plus Jakarta Sans/Inter/IBM Plex Mono.

**Out of scope (carry to M6):** PostGIS parcels, project boundary polygons, parcel-source ingest.

---

## File structure

### Files created
- `supabase/migrations/010_guest_and_universe.sql`
- `lib/auth/guest-session.ts` — server helpers: read/validate signed cookie, set/clear it
- `lib/queries/universe.ts` — `listUniverseRows`, `markVisited`
- `app/api/guest/start/route.ts` — POST `{ code }` → sets `fs_guest` cookie + returns `{ ok, projectId, expiresAt }`
- `app/api/guest/end/route.ts` — POST → clears cookie
- `app/api/projects/[projectId]/guest-codes/route.ts` — admin GET list, POST issue new day-code
- `app/api/projects/[projectId]/guest-codes/[codeId]/route.ts` — admin DELETE (revoke)
- `app/api/projects/[projectId]/universe/upload/route.ts` — POST CSV → bulk insert
- `app/api/projects/[projectId]/universe/route.ts` — GET list, DELETE clear
- `app/api/points/guest/route.ts` — POST guest point insert (service role + cookie validate)
- `app/(auth)/sign-in/_components/guest-tab.tsx` — guest-code input + submit
- `components/desktop/guest-codes-admin.tsx` — admin day-code generator + revoke list
- `components/desktop/universe-uploader.tsx` — CSV upload UI
- `components/mobile/to-visit-list.tsx` — to-visit list for canvass_mode mobile
- `tests/auth/guest-session.test.ts`
- `tests/queries/universe.test.ts`

### Files modified
- `app/(auth)/sign-in/page.tsx` — adds a mode toggle (Member vs Guest) at top of the glass card
- `components/auth/atlas-stage.tsx` — no change required; glass-card layout already accommodates an extra row
- `components/mobile/field-shell.tsx` — when `canvass_mode` is true and the user is a guest OR surveyor, show the To-visit list as a new bottom-sheet tab
- `app/p/[projectId]/(desktop)/settings/page.tsx` — adds Universe section (uploader + canvass_mode toggle) and Guest codes section
- `lib/cache/refresh.ts` — when canvass_mode, compute `canvass_blob` (visited/total + per-surveyor)
- `components/desktop/right-rail.tsx` — when canvass_mode active, render a `CanvassCompletion` block in Pulse tab instead of the generic counts
- `lib/db.types.ts` — regenerated after migration
- Middleware/CSP — `app/api/guest/*` cookie path explicit

---

## Phase 1 — Migration 010

### Task 1.1: Schema + RLS

**Files:** Create `supabase/migrations/010_guest_and_universe.sql`

- [ ] **Step 1: Write migration with all 4 tables + columns + RLS.**

Key shapes:
- `guest_sessions(id uuid PK, project_id uuid FK, code text UNIQUE, label text NULL, issued_by uuid FK profiles, issued_at, expires_at, revoked_at NULL)` — RLS: admin read/insert/delete, no public read
- `points.guest_session_id uuid NULL FK guest_sessions` — added via ALTER
- `survey_universe(id uuid PK, project_id uuid FK, address text, lat double precision NULL, lon double precision NULL, status text DEFAULT 'not_visited' CHECK in 'not_visited','visited','skipped', visited_at NULL, visited_by uuid NULL FK profiles, point_id uuid NULL FK points, external_id text NULL, raw_data jsonb DEFAULT '{}', created_at, updated_at)` — RLS: project member read; admin/surveyor insert/update; admin delete
- `project_settings.canvass_mode boolean NOT NULL DEFAULT false`
- Indexes on `(project_id, status)` for survey_universe, `(project_id, expires_at)` for guest_sessions, `(project_id, lower(address))` for fast match
- Helper RPC `validate_guest_code(p_code text) RETURNS uuid` — returns guest_session_id if code valid + non-revoked + non-expired

- [ ] **Step 2: Apply via MCP `apply_migration`.**

- [ ] **Step 3: Regenerate types + patch `lib/db.types.ts`.**

- [ ] **Step 4: Run `npm run typecheck`.** Expected: zero errors.

---

## Phase 2 — Guest mode backend

### Task 2.1: `lib/auth/guest-session.ts`

**Files:** Create

- [ ] **Step 1: Implement helpers.**

```ts
// readGuestSession() — reads HMAC-signed httpOnly cookie 'fs_guest';
//   returns { sessionId, projectId, expiresAt } or null
// setGuestSession(sessionId, projectId, expiresAt) — sets the cookie
// clearGuestSession()
```

Uses `crypto` (node) + a server-only `GUEST_COOKIE_SECRET` env var.

- [ ] **Step 2: Add `GUEST_COOKIE_SECRET` to `.env.example`.**

- [ ] **Step 3: Add unit test `tests/auth/guest-session.test.ts` for HMAC tamper detection.**

### Task 2.2: `POST /api/guest/start` + `POST /api/guest/end`

**Files:** Create both routes.

- [ ] **Step 1: Validate code via `validate_guest_code` RPC. If valid, set cookie, return projectId. If invalid → 401.**

- [ ] **Step 2: End route just clears the cookie.**

### Task 2.3: `POST /api/points/guest`

**Files:** Create.

- [ ] **Step 1: Read cookie via `readGuestSession`. 401 if missing/invalid.**

- [ ] **Step 2: Validate body (lat, lon, status_id, optional notes/photos).**

- [ ] **Step 3: Use `createAdminSupabase()` to insert with `guest_session_id = sessionId, collector_id = NULL, project_id = sessionProjectId`. Returns inserted row id.**

---

## Phase 3 — Guest tab on sign-in + mobile guest landing

### Task 3.1: Mode toggle on sign-in glass card

**Files:** Modify `app/(auth)/sign-in/page.tsx`. Create `app/(auth)/sign-in/_components/guest-tab.tsx`.

- [ ] **Step 1: Add a segmented control above the form: `Member` / `Guest`. State `mode`. Default = `member` (current behavior).**

- [ ] **Step 2: When `mode === 'guest'`, render `<GuestTab />` which has a single input "Project code" and a button "Continue as guest". On submit, POST to `/api/guest/start` with `{ code }`. On 200, redirect to `/p/<projectId>/field`. On 401 show inline error.**

### Task 3.2: Mobile layout guest path

**Files:** Modify `app/p/[projectId]/(mobile)/layout.tsx`.

- [ ] **Step 1: Before redirecting non-collect-role users, check for guest session via `readGuestSession`. If present AND projectId matches, allow.**

---

## Phase 4 — Admin day-code generator + revoke list

### Task 4.1: Admin endpoints

**Files:** Create `app/api/projects/[projectId]/guest-codes/route.ts` (GET + POST) and `[codeId]/route.ts` (DELETE).

- [ ] **Step 1: GET — list non-revoked guest_sessions for project, admin/owner only.**
- [ ] **Step 2: POST — generate a random 6-char code (alphabet excluding ambiguous chars), set expires_at = now() + 24h, label optional. Insert + return.**
- [ ] **Step 3: DELETE — mark revoked_at = now() on the row.**

### Task 4.2: Admin UI

**Files:** Create `components/desktop/guest-codes-admin.tsx`. Modify `app/p/[projectId]/(desktop)/settings/page.tsx`.

- [ ] **Step 1: List with code + label + issued_at + expires_at + Revoke button.**
- [ ] **Step 2: "Issue new code" form with optional label.**
- [ ] **Step 3: Add section to Settings page.**

---

## Phase 5 — Universe CSV upload + canvass_mode toggle

### Task 5.1: Upload endpoint

**Files:** Create `app/api/projects/[projectId]/universe/upload/route.ts`.

- [ ] **Step 1: Parse multipart CSV. Required col: `address`. Optional: `lat`, `lon`, `external_id`.**
- [ ] **Step 2: Owner/admin only. Bulk insert with batches of 200. Return `{ inserted, errors }`.**

### Task 5.2: Universe list/clear endpoint

**Files:** Create `app/api/projects/[projectId]/universe/route.ts`.

- [ ] **Step 1: GET — paginated list with status filter.**
- [ ] **Step 2: DELETE — clear all (admin-only, with confirmation header `x-confirm: yes`).**

### Task 5.3: canvass_mode toggle in Settings

**Files:** Modify `app/p/[projectId]/(desktop)/settings/page.tsx`. Create `components/desktop/universe-uploader.tsx`.

- [ ] **Step 1: Settings page reads `canvass_mode` from `project_settings`. Adds a toggle.**
- [ ] **Step 2: Upload card with drag-and-drop CSV input. Disabled when canvass_mode off.**

---

## Phase 6 — Universe mobile to-visit list

### Task 6.1: `lib/queries/universe.ts`

- [ ] **Step 1: `listUniverseRows(projectId, status?, limit?)`.**
- [ ] **Step 2: `markVisited(rowId, pointId)` updates status + visited_at + visited_by + point_id.**

### Task 6.2: To-visit bottom sheet

**Files:** Create `components/mobile/to-visit-list.tsx`. Modify `components/mobile/field-shell.tsx`.

- [ ] **Step 1: New bottom-sheet section "To-visit · N remaining" — only rendered when canvass_mode is true.**
- [ ] **Step 2: Tapping a row centres the map on its lat/lon and pre-fills the Add modal's address.**
- [ ] **Step 3: After successful point insert, call `markVisited` if the inserted point geocoded close to a universe row (≤30m, mirrors the existing match logic).**

---

## Phase 7 — Canvass-completion analytics swap

### Task 7.1: Compute the blob

**Files:** Modify `lib/cache/refresh.ts`.

- [ ] **Step 1: When project's `canvass_mode = true`, compute `canvass_blob = { total: N, visited: M, pct: M/N, by_surveyor: [...] }` and write to dashboard_cache.**

### Task 7.2: UI swap

**Files:** Modify `components/desktop/right-rail.tsx`.

- [ ] **Step 1: When canvass_mode true, Pulse tab renders a `CanvassCompletion` block in place of the generic counters.**
- [ ] **Step 2: Component reads cached `canvass_blob` (via `readCachedBlob`) with raw-query fallback.**

---

## Phase 8 — Verification

- [ ] **Step 1: `npm run typecheck` → 0 errors.**
- [ ] **Step 2: `npm test` → all suites pass; add coverage for new helpers.**
- [ ] **Step 3: `mcp__supabase__get_advisors security` → no new warnings.**
- [ ] **Step 4: Update memory: append a `project-fieldsurvey-m5-shipped.md` memory describing what shipped.**

---

## Spec coverage self-check

| Spec line | Plan task |
|---|---|
| `guest_sessions` + day-code RPC | 1.1 + 4.1 |
| RLS carve-out on points | 1.1 (`guest_session_id` column + admin-API path) |
| Login-screen guest tab | 3.1 |
| Admin day-code generator + revoke list | 4.2 |
| `survey_universe` table + `canvass_mode` toggle | 1.1 + 5.3 |
| Universe CSV upload wizard | 5.1 + 5.3 |
| Mobile to-visit list | 6.2 |
| Canvass-completion analytics swap | 7.1 + 7.2 |

No placeholders. No `TBD`s.
