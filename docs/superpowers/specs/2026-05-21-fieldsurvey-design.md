# FieldSurvey — Design Specification

**Date:** 2026-05-21
**Status:** Approved (brainstorming phase complete)
**Working name:** FieldSurvey (placeholder; rename before launch)
**Repo origin:** Copy of the KeyStone Survey Dashboards repo. Original Keystone instance is untouched. This repo will host an entirely new product.

---

## 1. Vision

FieldSurvey is an **open SaaS for general spatial surveys**. Any person — faculty, student, NGO, urban planner, citizen-science volunteer — signs up, creates one or more **survey projects**, invites a team, and collects geolocated points in the field via a mobile PWA. Each project has its own map, status vocabulary, team, and dashboard. Owners can keep projects private or expose them as public read-only.

The product replaces the single-purpose Keystone Field app with a generic, multi-project, multi-tenant platform that preserves the proven patterns (offline-first PWA, Supabase RLS, realtime, Qualtrics CSV import) but generalizes the data model.

---

## 2. Core decisions (locked in brainstorming)

| Area | Decision |
|---|---|
| Audience | Open SaaS — anyone can sign up |
| Domain | General spatial surveys (door-to-door, environmental sampling, asset audits, citizen reporting) |
| Roles per project | Owner / Admin / Surveyor / Viewer |
| Project setup minimum | Name + map center (lat/lon or geocoded address) |
| Geometry | Points only (v1) |
| Statuses | Per-project, fully customizable (label + color + icon + default flag) |
| Survey form | Link to external Qualtrics / Google Forms; results imported via CSV |
| Offline | Full offline-first PWA with IndexedDB outbox and service-worker sync |
| Mobile delivery | PWA only |
| Frontend | Next.js 15 (App Router) + TypeScript + React + Tailwind + shadcn/ui |
| Backend | Supabase (Auth + Postgres + RLS + Realtime + Storage) + Python Vercel serverless for CSV / Qualtrics work |
| Map tiles | OpenStreetMap (free) |
| Visibility | Private by default; opt-in public read-only with shareable URL |
| Extras in v1 | Team chat, presence, photos on points, email notifications |
| Limits | Free for everyone, soft caps (10 projects/user, 10k points/project, 100 MB photos/project, 20 invites/project) |
| Infra | NEW separate Supabase project + NEW separate Vercel project — must not touch Keystone instances |

---

## 3. Architecture

### 3.1 High-level diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                          FieldSurvey                               │
│                                                                    │
│  Browser / Mobile PWA  ───────────► Next.js 15 (App Router)        │
│   (same Next.js app                 + React + TS + Tailwind        │
│    serves both)                     + shadcn/ui                    │
│                                     + MapLibre GL JS               │
│                                     + Supabase JS SDK              │
│                                     │                              │
│                                     ▼                              │
│                            ┌────────────────┐                      │
│                            │   Vercel       │                      │
│                            │   (one project)│                      │
│                            │                │                      │
│                            │ app/api/* TS   │── light CRUD where  │
│                            │   routes       │   RLS isn't enough  │
│                            │                │                      │
│                            │ api/py/* Py    │── CSV import,        │
│                            │   functions    │   Qualtrics matching,│
│                            │                │   daily cron, geocode│
│                            └───────┬────────┘                      │
│                                    │                                │
│                                    ▼                                │
│                            ┌────────────────────────┐               │
│                            │ Supabase (new project) │               │
│                            │ ─ Postgres + PostGIS   │               │
│                            │ ─ Auth                 │               │
│                            │ ─ Realtime             │               │
│                            │ ─ Storage (photos)     │               │
│                            │ ─ Row-Level Security   │               │
│                            └────────────────────────┘               │
└────────────────────────────────────────────────────────────────────┘
```

### 3.2 Stack

| Layer | Tool |
|---|---|
| Frontend framework | Next.js 15 (App Router) |
| Language | TypeScript 5.x strict |
| Styling | Tailwind CSS v3 + shadcn/ui |
| Icons | Lucide |
| Charts | Recharts |
| Maps | MapLibre GL JS + OpenStreetMap tiles |
| Auth + DB + Realtime + Storage | Supabase |
| Server APIs | Next.js Route Handlers (TS) + Vercel Python serverless |
| Email | Gmail SMTP via nodemailer (Keystone's primary path; uses a dedicated Gmail App Password) |
| Geocoding | Nominatim (free) |
| Hosting | Vercel (new project) |
| CI | GitHub Actions (typecheck, lint, build, E2E) |
| Tests | Vitest (unit) + Playwright (E2E) |
| PWA | Hand-rolled service worker + manifest |
| Visual design passes | `frontend-design`, `impeccable`, `liquid-glass-design`, `ui-ux-pro-max`, `frontend-patterns` |

### 3.3 What carries over from Keystone (as patterns, re-written in TS)

- Offline IndexedDB outbox + replay flow from `keystone_field_web/index.html`
- Service-worker tile caching from `keystone_field_web/sw.js`
- Realtime chat + presence channel patterns
- Gmail SMTP transactional email pattern from `api/_email_logic.py::_send_via_gmail_smtp` (the Keystone primary path; Resend was a fallback we drop)
- Qualtrics CSV parse + address matching from `api/_processing.py` / `api/iaq-points.py`
- RLS hardening lessons from migrations 17–22 (no public service-role exposure, deny-by-default, security-definer helpers)

### 3.4 What is thrown out

- All Keystone-specific tables (`community_contacts`, `iaq_surveys`, `parcels`, `field_survey_points`, Keystone-flavored team/membership/guest tables)
- The Plotly Dash desktop dashboard (`app.py`, `static/`)
- The vanilla HTML PWA (`keystone_field_web/`)
- The standalone FastAPI service (`keystone_field_api/`)
- Single-project hard-coded map center, status list, and schema

---

## 4. Data model

### 4.1 Tables

```
profiles                       (1 row per Supabase auth user)
├─ id              uuid pk    → references auth.users(id)
├─ email           text
├─ display_name    text
├─ avatar_url      text       (Supabase Storage path)
├─ created_at      timestamptz

projects
├─ id              uuid pk
├─ owner_id        uuid       → profiles(id)
├─ name            text
├─ description     text
├─ center_lat      double precision
├─ center_lon      double precision
├─ default_zoom    int        (default 14)
├─ visibility      text       ('private' | 'public_read')
├─ archived        boolean
├─ created_at      timestamptz
├─ updated_at      timestamptz

project_members
├─ project_id      uuid       → projects(id) on delete cascade
├─ user_id         uuid       → profiles(id) on delete cascade
├─ role            text       ('owner' | 'admin' | 'surveyor' | 'viewer')
├─ joined_at       timestamptz
└─ PRIMARY KEY (project_id, user_id)

project_invites
├─ id              uuid pk
├─ project_id      uuid       → projects(id) on delete cascade
├─ email           text
├─ role            text
├─ token           text       unique, random
├─ invited_by      uuid       → profiles(id)
├─ expires_at      timestamptz
├─ accepted_at     timestamptz nullable
├─ created_at      timestamptz

project_statuses
├─ id              uuid pk
├─ project_id      uuid       → projects(id) on delete cascade
├─ label           text
├─ color           text       ('#34d399')
├─ icon            text       (lucide icon name, optional)
├─ sort_order      int
├─ is_default      boolean

project_settings
├─ project_id      uuid pk    → projects(id) on delete cascade
├─ external_survey_url   text
├─ qualtrics_survey_id   text
├─ qualtrics_match_field text  ('address' | 'street_name' | 'point_id')
└─ updated_at      timestamptz

points
├─ id              uuid pk
├─ project_id      uuid       → projects(id) on delete cascade
├─ status_id       uuid       → project_statuses(id)
├─ lat             double precision
├─ lon             double precision
├─ accuracy_m      double precision
├─ address         text
├─ notes           text
├─ collector_id    uuid       → profiles(id) on delete set null
├─ collected_at    timestamptz
├─ created_at      timestamptz
├─ updated_at      timestamptz
├─ is_offline_sync boolean
└─ client_id       text       (idempotency key from PWA)

point_photos
├─ id              uuid pk
├─ point_id        uuid       → points(id) on delete cascade
├─ storage_path    text
├─ width_px        int
├─ height_px       int
├─ uploaded_by     uuid       → profiles(id)
├─ uploaded_at     timestamptz

survey_responses                (imported Qualtrics CSV rows)
├─ id              uuid pk
├─ project_id      uuid       → projects(id) on delete cascade
├─ point_id        uuid       → points(id) on delete set null
├─ source          text       ('qualtrics_csv' | 'google_forms_csv' | 'manual')
├─ raw_data        jsonb
├─ matched_field   text
├─ imported_at     timestamptz
├─ imported_by     uuid       → profiles(id)

survey_imports                  (audit log of import jobs)
├─ id              uuid pk
├─ project_id      uuid       → projects(id) on delete cascade
├─ filename        text
├─ row_count       int
├─ matched_count   int
├─ unmatched_count int
├─ status          text       ('completed' | 'failed' | 'processing')
├─ error_message   text
├─ created_by      uuid       → profiles(id)
├─ created_at      timestamptz

chat_messages
├─ id              uuid pk
├─ project_id      uuid       → projects(id) on delete cascade
├─ author_id       uuid       → profiles(id)
├─ body            text
├─ created_at      timestamptz
```

Presence is ephemeral via Supabase Realtime presence channels (no DB table).

### 4.2 Storage buckets

- `avatars` — public read, owner write.
- `point-photos` — private. Path: `point-photos/{project_id}/{point_id}/{uuid}.jpg`. Storage RLS policy checks `is_project_member(project_id parsed from path)`.

### 4.3 RLS helper functions

```sql
create or replace function is_project_member(p_project uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from project_members
    where project_id = p_project and user_id = auth.uid()
  );
$$;

create or replace function project_role(p_project uuid)
returns text language sql security definer stable as $$
  select role from project_members
  where project_id = p_project and user_id = auth.uid();
$$;

create or replace function is_public_project(p_project uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from projects where id = p_project and visibility = 'public_read'
  );
$$;
```

### 4.4 RLS policy summary

| Table | Read | Insert | Update | Delete |
|---|---|---|---|---|
| `profiles` | self + any user sharing a project | self only | self only | denied |
| `projects` | members OR `visibility='public_read'` | any authenticated user (auto-becomes owner) | owner/admin | owner only |
| `project_members` | members | owner/admin OR accept-invite RPC | owner/admin | owner/admin |
| `project_invites` | owner/admin | owner/admin | owner/admin | owner/admin |
| `project_statuses` | members + public | owner/admin | owner/admin | owner/admin (blocked at app layer if in use) |
| `project_settings` | members + public | owner/admin | owner/admin | n/a |
| `points` | members + public | members in `(owner,admin,surveyor)` and `collector_id = auth.uid()` | own row + owner/admin override | own row + owner/admin override |
| `point_photos` | members + public | uploader = auth.uid() and member | own row + admin override | own row + admin override |
| `survey_responses` | members + public | owner/admin (via import) | owner/admin | owner/admin |
| `survey_imports` | members | owner/admin | owner/admin | owner/admin |
| `chat_messages` | members | members (author = auth.uid()) | denied (immutable) | owner/admin |

### 4.5 Key invariants

- A project always has at least one owner. `transfer_ownership(p_project, p_new_owner)` RPC swaps owners atomically.
- The owner cannot leave a project — must transfer first or delete.
- Deleting a project cascades all child rows and storage objects (storage cleanup via Postgres trigger calling Storage admin endpoint).
- `points.client_id` is generated by the PWA before submit so offline replays cannot duplicate.
- Status delete is blocked at the app layer with "X points still use this status — reassign first."

---

## 5. Page structure and user flows

### 5.1 URL map

```
/                                Marketing landing + sign-in entry
/sign-in
/sign-up
/reset-password
/invite/[token]

/home                            Authenticated home: card grid of projects
/home/new                        Create project
/account                         Profile / password / delete account
/account/notifications           Email preferences

/p/[projectId]                   Auto-redirects to /map or /field by device
/p/[projectId]/map               Desktop dashboard map view
/p/[projectId]/field             Mobile field PWA view
/p/[projectId]/points            Points table
/p/[projectId]/responses         Imported Qualtrics responses
/p/[projectId]/analytics         Charts: status, time-series, productivity, heatmap preview
/p/[projectId]/chat              Realtime chat
/p/[projectId]/members           Member list + invites (owner/admin)
/p/[projectId]/settings          Project settings + danger zone (owner)
/p/[projectId]/import            CSV import (owner/admin)

/public/[projectId]              Anonymous read-only project view
```

### 5.2 Device auto-routing

Matches the Keystone behavior. On sign-in:

```ts
// lib/device.ts
export function detectClient() {
  const ua = navigator.userAgent;
  const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const isNarrow   = window.innerWidth < 768;
  const isTouch    = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const isMobile   = isMobileUA || (isNarrow && isTouch);
  return { isMobile, os: detectOS(ua) };
}
```

- Sign-in success → mobile users land on `/home?view=mobile`; project tap → `/p/[id]/field`.
- Desktop users → `/home`; project tap → `/p/[id]/map`.
- Bare `/p/[id]` redirects to `/field` or `/map` based on device.
- OS-aware tweaks: iOS safe-area insets, iOS custom install banner (no `beforeinstallprompt`), Android standard install prompt, desktop keyboard shortcuts.
- User can override via avatar menu "Switch to desktop view / mobile view" (writes `localStorage.deviceOverride`).
- Cookie `fs_device_pref` hints layout server-side to avoid flash.

### 5.3 Primary user flows

1. **Sign up & first project** — sign-up → email confirm → empty home → create-project (name + center) → empty map.
2. **Invite teammate** — Members page → invite email + role → token email via Gmail SMTP → invitee clicks `/invite/[token]` → signup-if-needed → membership row added.
3. **Surveyor adds point (offline-safe)** — `/p/[id]/field` → tap + → fill sheet → save → if offline: queued in IndexedDB + photos held as blobs; if online: direct write + Storage upload → realtime broadcast to dashboard.
4. **Admin imports Qualtrics CSV** — `/p/[id]/import` → drag CSV → Python serverless parses & matches → preview matched/unmatched → review unmatched → commit → `survey_responses` written.
5. **Make project public read-only** — Settings → Visibility toggle → typed-name confirm → shareable `/public/[id]` URL.
6. **Email notifications** — invites, accepted invites, role changes, opt-in daily digest, soft-cap warnings.

### 5.4 Component / layout patterns

**Desktop project shell**:
```
┌──────────────────────────────────────────────────────────────────────┐
│ ⬢ FieldSurvey  | Project Name ▼      ⏺ live  🌗  👤 GS              │
├──────┬───────────────────────────────────────────────────────────────┤
│ 🗺  │                                                                │
│ 📋  │                                                                │
│ 📊  │              Active route content fills here                   │
│ 📈  │                                                                │
│ 💬  │                                                                │
│ 👥  │                                                                │
│ ⚙   │                                                                │
│ 📤  │                                                                │
└──────┴───────────────────────────────────────────────────────────────┘
```

**Mobile field shell**:
```
┌──────────────────────────────────┐
│ ◀  Project Name           👤    │
├──────────────────────────────────┤
│        MapLibre canvas           │
│        + GPS dot                 │
│        + status-colored points   │
│                  ┌───┐           │
│                  │ + │ ← FAB     │
│                  └───┘           │
├──────────────────────────────────┤
│  🗺      ➕      💬      ⋯     │
└──────────────────────────────────┘
```

---

## 6. Mobile field PWA (offline-first)

### 6.1 Screens

```
/p/[id]/field                   Map + FAB + tabs (default)
/p/[id]/field/add               Add-point sheet (bottom sheet)
/p/[id]/field/point/[ptId]      Point detail sheet
/p/[id]/field/chat              Chat
/p/[id]/field/more              My points today / Sync queue / Switch to desktop / Sign out
```

### 6.2 Add-point sheet fields

- Live GPS lat/lon + accuracy (override-able by dropping pin)
- Status dropdown (from `project_statuses`)
- Auto-reverse-geocoded address (editable)
- Notes textarea
- 0..N photos (camera or file picker)

### 6.3 Offline-first architecture

```
                ┌─────────────────────┐
                │  Mobile PWA (React) │
                └──────────┬──────────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
        Online?         IndexedDB     Service worker
                       outbox queue   (background sync)
            │              │              │
            ▼              ▼              ▼
    Supabase direct   Append row        Replay when
    (insert point,    + photo blob       online event fires
     upload photo)
```

### 6.4 IndexedDB schema

- `outbox_points` — `{ client_id, project_id, status_id, lat, lon, accuracy_m, notes, collected_at, photo_blob_refs[], attempts, last_error }`
- `outbox_photos` — photo blobs keyed by temp id
- `cached_points` — last-known server points per project (instant offline render)
- `cached_statuses` — per-project status vocabulary
- Map tiles cached via service-worker `caches` API

### 6.5 Sync flow

1. On `online` event (or app foreground), service worker reads `outbox_points` in `collected_at` order.
2. For each row: upload photos → get final paths → `insert into points` with `client_id` → insert `point_photos` → delete outbox row.
3. On 4xx: mark failed, surface to "Sync queue" UI with retry/edit/discard.
4. On 5xx / network: exponential backoff (1s, 5s, 30s, 5m, 30m, give up at 10 attempts).
5. Refresh `cached_points` from server.
6. `BroadcastChannel` notifies open tabs to refresh.

### 6.6 Tiles offline

- Service worker pre-caches tiles in a bounding box around `project.center` (zoom 14–17, ~10km radius) on first online open.
- "Download offline map" button in More menu for custom areas.
- Cache size capped (100 MB) with LRU.

### 6.7 Sensors used

- Geolocation API (`watchPosition`, high accuracy)
- File-input `capture="environment"` + MediaDevices for camera
- Vibration API for save-confirm haptics
- Battery + Network Info APIs for warnings & throttle

### 6.8 Sync queue UI (More tab)

- List pending and failed outbox items with status, age, last error
- Per-row: Retry now / Edit & retry / Discard
- Top: Force sync all
- Badge on More tab when queue > 0

### 6.9 iOS PWA quirks planned for

- No real Background Sync — replay on foreground only
- Custom install banner (no `beforeinstallprompt`)
- IndexedDB quota warning at > 50 MB
- Safe-area insets via `env(safe-area-inset-*)`

---

## 7. Desktop dashboard

### 7.1 Sidebar nav

`Map · Points · Responses · Analytics · Chat · Members · Settings · Import` (Import visible to owner/admin only).

### 7.2 Map view (`/p/[id]/map`)

- Full-canvas MapLibre map
- Persistent right drawer with **Filters** and **Details** tabs
- Filters: status multi-select, surveyor multi-select, date range, text search; toggles for heatmap, clusters, boundary
- Details: pin info + photos + matched response (if any) + edit / delete / reassign
- Map controls: zoom, recenter, geolocate, legend, live status mini-chart, "last updated Ns ago"

### 7.3 Points table (`/p/[id]/points`)

Columns: `Status · Address · Lat/Lon · Collector · Collected at · Updated · Notes · Photos · Actions`. Bulk actions (admin/owner). CSV + GeoJSON export.

### 7.4 Responses (`/p/[id]/responses`)

Imported Qualtrics rows as table. Per-question quick stats above the table. Filter matched/unmatched. Per-row: View JSON / Remap / Unlink / Delete. Top-right: Re-run match.

### 7.5 Analytics (`/p/[id]/analytics`)

Four cards on one scrollable page (Recharts):
1. Status breakdown donut + table
2. Activity over time (line, daily/weekly/monthly, stacked by status)
3. Surveyor productivity (bar, stacked by status)
4. Heatmap / cluster preview (small embedded map)

### 7.6 Chat (`/p/[id]/chat`)

Single thread. Realtime via Supabase channel. Avatar + name + timestamp; today/yesterday/older sections. Presence dots. `@mention` autocomplete. Admin/owner delete.

### 7.7 Members (`/p/[id]/members`)

Member rows: avatar, name, email, role, joined. Invite member (sheet: email + role). Pending invites with Re-send/Revoke. Role change dropdown (owner/admin only). Owner row → Transfer ownership. Leave project button (non-owner).

### 7.8 Settings (`/p/[id]/settings`)

Sections: General · Location · Statuses (drag-reorder, color/icon, default toggle) · External Survey (URL, ID, match field) · Visibility (private / public_read) · Notifications · Danger zone (Transfer / Archive / Delete typed-name confirm).

### 7.9 Import (`/p/[id]/import`)

Drag-drop CSV → Python serverless parses + matches → preview table with matched/unmatched → editable match values for unmatched → Commit → `survey_responses` + `survey_imports` audit. History list of prior imports.

### 7.10 Empty states, realtime, components

Every page has a clean empty state. All list pages subscribe to `project:${id}` realtime channel. shadcn/ui primitives + Tailwind + MapLibre + Recharts + Lucide. Dark mode default, light mode toggle. Accent `#38bdf8`.

---

## 8. Milestones

### 8.1 M1 — Foundation (Weeks 1–2)

Goal: sign up, create empty projects, invite teammates, accept invites. No points yet.

Deliverables:
- Repo cleaned (Keystone wiped, snapshot tagged)
- New Supabase project provisioned, migration `001_init.sql` (profiles, projects, project_members, project_invites, project_statuses, project_settings)
- New Vercel project linked, env vars set, preview working
- Next.js 15 App Router scaffold + Tailwind + shadcn/ui
- Auth pages (sign-in, sign-up, reset, confirm)
- Home page (project card grid: Owned, Member of, + New)
- Create-project flow (name + geocoded map center)
- Project shell (sidebar desktop / tab bar mobile, device auto-routing)
- Members page + invite email via Gmail SMTP
- Account + delete account
- Email templates (invite, password reset, welcome)
- CI green: typecheck, lint, smoke Playwright on auth + create

Demo at end of M1: "I signed up, made 3 projects, invited a teammate by email, they accepted, and we're both in the project shell looking at an empty map."

### 8.2 M2 — Core survey loop / MVP (Weeks 3–5)

Goal: real fieldwork loop end-to-end with offline support and photos.

Deliverables:
- Migration `002_points.sql` (points, point_photos, storage bucket point-photos with RLS)
- Per-project statuses CRUD in Settings (drag-reorder, color picker)
- Map view (desktop + mobile) with MapLibre + OSM
- Add-point sheet (mobile) and modal (desktop)
- Point detail drawer with edit/delete
- Offline outbox (IndexedDB) + service worker sync + idempotency
- Service worker tile pre-caching with "Download offline map"
- Photo capture + upload + Storage RLS
- Filter bar (status / surveyor / date / text)
- Status breakdown chart on map page
- Points table page (sortable)
- CSV + GeoJSON export
- Realtime live point updates
- Reverse-geocoding (Nominatim) for new points
- Visual passes with `frontend-design` + `impeccable` + `liquid-glass-design` on FAB / bottom sheet / tab bar

Demo at end of M2: "On my phone I drove around offline and added 30 points with photos. They synced when I got back to wifi. On my laptop dashboard, I filtered to 'No Answer' and exported a GeoJSON."

### 8.3 M3 — Coordination & analysis (Weeks 6–7)

Goal: teams coordinate live and import response data.

Deliverables:
- Migration `003_chat_responses.sql` (chat_messages, survey_responses, survey_imports)
- Chat page (realtime + @mentions)
- Presence channel + green-dot indicator
- Analytics page (donut, time-series, productivity, heatmap preview)
- Heatmap + cluster toggles on map page
- Responses page (JSON drawer + per-question stats)
- Import page (CSV drag-drop, preview, commit, history)
- Python serverless `/api/py/import-survey-csv.py` (ported & generalized from Keystone matching logic)
- Public read-only mode + shareable URL + `/public/[id]` route
- Email notifications (invites, role changes, daily digest opt-in)
- Soft caps (10 projects, 10k points, 100 MB photos, 20 invites) + warnings
- Account → Notifications preferences
- Final visual polish with `ui-ux-pro-max` + `impeccable` review
- E2E coverage of 6 primary user flows
- DEPLOY.md + ONBOARDING.md updated

Demo at end of M3: "Three of us are in the project chat coordinating in real time. I uploaded the Qualtrics CSV and 168 of 183 responses matched to points. The heatmap shows clusters of refusals on Main Street. I shared the public URL with the city council."

---

## 9. Repo cleanup plan (executed at the start of M1)

### Step 0 — Safety net (single commit before any deletion)

```bash
git tag legacy-keystone-snapshot
git push origin legacy-keystone-snapshot

mkdir -p legacy
zip -r legacy/keystone-snapshot.zip \
  app.py keystone_field_api keystone_field_web dashboard field login \
  static scripts supabase/migrations api \
  AUDIT_PHASE3.md DEPLOY.md PARITY.md PHASE1_DEPLOY.md PI_PRESENTATION.md \
  REVIEW_STATUS.md mockups graphify-out audit-*.png

git add legacy/keystone-snapshot.zip
git commit -m "chore(legacy): snapshot Keystone v1 before FieldSurvey rewrite"
```

### Step 1 — Hard delete Keystone-specific files (one commit)

Delete: `app.py`, `keystone_field_api/`, `keystone_field_web/`, `dashboard/`, `field/`, `login/`, `static/`, `scripts/`, `api/` (all `.py`), `supabase/migrations/` (all 22), `supabase/functions/daily-report/`, `mockups/`, `graphify-out/`, `output/`, `data/`, Keystone tests in `tests/`, Keystone docs in `docs/`, all `audit-*.png`, `AUDIT_PHASE3.md`, `DEPLOY.md`, `PARITY.md`, `PHASE1_DEPLOY.md`, `PI_PRESENTATION.md`, `REVIEW_STATUS.md`, `index.html`, `requirements.txt`, `requirements-local.txt`, `vercel.json`, `.env`, `.vercel/`.

Keep: `.git/`, `.gitignore` (cleaned), `.claude/`, new `legacy/keystone-snapshot.zip`, `docs/superpowers/specs/` (containing this spec).

### Step 2 — Scaffold FieldSurvey (subsequent commits per M1 plan)

- `package.json`, `tsconfig.json`, Next.js 15 App Router skeleton (`app/`, `components/`, `lib/`, `public/`)
- `supabase/migrations/001_init.sql`
- `api/py/__init__.py` + stub function
- New `vercel.json` (TS + Python runtime, empty cron section)
- New `.env.example` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `EMAIL_FROM_NAME`, `NEXT_PUBLIC_APP_URL`)
- New `README.md` (FieldSurvey overview + setup)
- New `DEPLOY.md` and `SETUP.md` (provisioning steps)

---

## 10. New infrastructure provisioning

### 10.1 Supabase (free tier)

- Create new project named `fieldsurvey-prod` (region: nearest)
- Copy URL + anon key + service-role key into `.env.local`
- SQL editor → paste `001_init.sql`, run
- Auth → templates → paste FieldSurvey invite / welcome / reset email templates
- Storage → create bucket `point-photos` (private) and `avatars` (public)
- Authentication → enable email/password and magic link; disable Keystone-specific invite-code constraint

### 10.2 Vercel (free Hobby)

- `vercel link` from this directory → choose Create new project → name `fieldsurvey`
- Set env vars (Production + Preview + Development)
- Deploy → confirm preview URL
- Custom domain later

### 10.3 Gmail App Password (outbound email via Gmail SMTP)

Same pattern as Keystone (`api/_email_logic.py::_send_via_gmail_smtp`).

- Pick or create a dedicated Gmail account (e.g. `fieldsurvey-mail@gmail.com`). Recipients see this as the sender of all FieldSurvey mail.
- Enable 2-Step Verification at https://myaccount.google.com/security
- Generate an App Password at https://myaccount.google.com/apppasswords (app name "FieldSurvey"), copy the 16-character string.
- Env vars: `GMAIL_USER=<address>`, `GMAIL_APP_PASSWORD=<16-char>`, `EMAIL_FROM_NAME=FieldSurvey` (optional display-name override).

### 10.4 Isolation verification

- `.vercel/` is fully fresh (created by `vercel link` after old one was deleted in Step 1)
- Manual smoke-test signup confirms new infra; no rows appear in the old Keystone Supabase project

---

## 11. Soft caps (M3)

| Cap | Limit |
|---|---|
| Projects per user | 10 |
| Points per project | 10 000 |
| Photo bytes per project | 100 MB |
| Pending invites per project | 20 |

Caps are configurable via a `system_limits` table. Approaching cap triggers a friendly in-app warning ("8/10 projects used") plus an email at 90 %.

---

## 12. Visual design direction

Implementation passes will use these skills iteratively:
- **frontend-design** — escape generic AI aesthetics; distinctive, polished, production-grade UI.
- **impeccable** — visual hierarchy, accessibility, motion, anti-pattern audits.
- **liquid-glass-design** — iOS-26 frosted-glass surfaces on mobile FAB, bottom sheet, tab bar.
- **ui-ux-pro-max** — palette / font / chart guidance across 161 palettes, 57 font pairings, 25 chart types.
- **frontend-patterns** — reusable structural patterns (data tables, drawers, sheets, empty states).

Baseline:
- Dark mode default, light mode toggle.
- Accent token `#38bdf8` (sky-400) with full light/dark scale defined in `app/globals.css`.
- Typography: Plus Jakarta Sans (headings) + Inter (body) + IBM Plex Mono (data). Already loaded in current Keystone — carries over.

---

## 13. Non-goals (explicit, for v1)

- No native iOS/Android apps (PWA only).
- No payment / Stripe / paid tiers (free with soft caps).
- No in-app form builder (link to Qualtrics/Google Forms instead).
- No lines / polygons (points only).
- No internal AI features (chat assistant, auto-categorization) in v1.
- No team-level "organizations" abstraction (a user is the org).
- No per-project custom domains.

---

## 14. Open follow-ups (post-design, pre-implementation)

- Decide which OpenStreetMap tile provider to use by default (osm.org direct, MapTiler free tier, Stadia free tier) before M2 — affects production stability under load.
- Decide reverse-geocoding rate-limit strategy for Nominatim (cache per project; rate cap per user).
- Confirm Supabase region preference before provisioning.
- Decide whether to keep the dedicated Gmail address as the long-term sender, or migrate later to a verified custom domain (SendGrid/Amazon SES) for higher volume.

---

**End of design specification.**
