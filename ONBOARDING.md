# FieldSurvey — Onboarding

Welcome. This guide gets a new contributor productive in ~30 minutes.

## What you're working on

FieldSurvey is a multi-tenant SaaS for spatial surveys (door-to-door, environmental sampling, asset audits, citizen reporting). Researchers spin up a project, invite a team, collect geolocated points in the field via a mobile PWA, and import survey responses to match against those points.

The product is a rewrite of the prior single-purpose Keystone survey app, generalized to support any project.

## Repo layout

```
app/
  (auth)/             sign-in, sign-up, reset, callback
  home/               authenticated home (project card grid + create)
  account/            profile, password, notification preferences
  p/[projectId]/
    page.tsx          device-detect redirect (cookie > UA > viewport)
    (desktop)/        full dashboard shell — admin & power users
      map/            map + match-status + right rail
      points/         sortable table + CSV/GeoJSON export
      responses/      imported survey responses + JSON drawer
      members/        invite + role management
      settings/       statuses CRUD + visibility toggle
      import/         CSV import wizard
    (mobile)/         field-collection PWA — no response data shown
      field/          map + chat + more tabs
  public/[projectId]/ anonymous read-only project view
  api/                Next.js route handlers
api/py/               Python serverless (Census-backed matcher)
components/
  desktop/            top bar, rails, overlays, modals, tables
  mobile/             field shell, sheets, more panel, sync queue
  chat/               shared realtime chat panel
  match/              Match-Status legend section
  map/                MapLibre wrapper with M1/F1/R1 stroke encoding
lib/
  match/              M1/F1/R1 semantics + Keystone-exact symbology
  geocode/            U.S. Census geocoder + Haversine
  offline/            IndexedDB outbox + sync worker
  queries/            server-side data fetchers
  supabase/           browser/server/admin clients
public/sw.js          service worker (tile cache + outbox sync hook)
supabase/migrations/  001 (init), 002 (points + match), 003 (chat + caps)
```

## Local setup

```bash
git clone https://github.com/GoshtasbSh/fieldsurvey.git
cd fieldsurvey
npm install
cp .env.example .env.local
# Fill in: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, GMAIL_USER, GMAIL_APP_PASSWORD,
# NEXT_PUBLIC_APP_URL, and a fresh INTERNAL_API_SECRET (openssl rand -hex 32)
npm run dev
```

Open http://localhost:3000.

If the Supabase project is new, apply migrations 001 → 002 → 003 via the SQL editor (see [DEPLOY.md](DEPLOY.md)).

## The mental model

Read this once and you'll understand 80% of the codebase:

1. **Match-status M1/F1/R1 is the central concept.** Every point or response is in exactly one group:
   - **M1** = field point + response, linked. Visual: white ring (`#ffffff`, 1.5px stroke).
   - **F1** = field point, status=Completed, but the matching algorithm couldn't link a response to it. Visual: yellow ring (`#fde047`, 2.8px). Needs human attention to chase.
   - **R1** = response with no field point. Visual: purple house glyph (`#a855f7`). Tells the team "don't visit this house — they already responded online."
   - Stored as a **view** (`v_match_status`), never a column. Re-derived on every read. Documented in `lib/match/status.ts` and the memory file `project_fieldsurvey_match_status.md`.

2. **Mobile is field-collection only.** The mobile PWA (`app/p/[id]/(mobile)/`) NEVER shows survey-response data, M1/F1/R1 rings, or R1 glyphs — regardless of the viewer's role. Response work is desktop-only for admin/member. Enforced in the page query (`safeFeatures` strips `match_status`) and by code review.

3. **Device routing is cookie > UA > viewport** (`lib/device.ts`). `fs_device_pref` overrides everything — the Switch View button in the mobile More tab sets it.

4. **Offline-first add-point.** `AddPointForm` writes to IndexedDB outbox first, then attempts a live drain via `/api/points`. On `online` / `visibilitychange`, the outbox drains in order. Photos use the IDB blob id as the storage path so retries are idempotent.

5. **Address matching never trusts response lat/lon.** A Qualtrics export's `LocationLatitude` is where the SURVEY WAS FILLED, not where the house is. The Python matcher always re-geocodes the address column (chosen in the import wizard) via the U.S. Census geocoder, then snaps to the nearest field point within `match_radius_m` (default 30m).

## Common tasks

### Add a new database table

1. Write `supabase/migrations/00X_<name>.sql`
2. Apply via Supabase Dashboard SQL editor (or `mcp__supabase__apply_migration` in agent-land)
3. Regenerate types: `npx supabase gen types typescript --linked > lib/db.types.ts`

### Add a new desktop page

Live under `app/p/[projectId]/(desktop)/<name>/page.tsx`. Use `getProjectForUser(projectId)` to gate access. The desktop top bar + left/right rails come from `app/p/[projectId]/(desktop)/layout.tsx` (currently a thin pass-through — most shell chrome is composed inside each page via `MapShell` for the map page).

### Add a new email

Add a template in `lib/email.ts` next to `sendInviteEmail`. Read `notification_prefs` for the recipient and skip if their opt-out is set. Use the `wrap()` HTML wrapper for consistent branding.

### Run the test suite

```bash
npm test           # vitest unit tests
npm run typecheck  # tsc --noEmit
npx playwright test  # E2E
```

## When things go wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Import returns 500 with "INTERNAL_API_SECRET not configured" | Env var missing in Vercel | `vercel env add INTERNAL_API_SECRET production` |
| Mobile shows survey-response data | Scope violation — somebody imported response code under `app/p/*/(mobile)/**` or `components/mobile/**` | Remove the import, see `project_fieldsurvey_mobile_scope.md` |
| Match counts (M1/F1/R1) are all zero after import | Python matcher not running. Either INTERNAL_API_SECRET missing, or vercel.json forgot to register `api/py/*.py` (it shouldn't — Vercel auto-detects) | Hit `/api/match?project_id=X` directly as admin; if 500, check Vercel function logs |
| Pin rings missing on desktop | The point's `status_id` doesn't resolve to label="Completed" (case-insensitive), so the view returns `match_status=null`. RLS hides response data → page can't compute matched. | Verify `project_statuses` has a row labelled "Completed" |
| Offline outbox stuck | Open the More tab → Sync queue, check `last_error`. If it's a 5xx, the request retries on backoff. If it's a 4xx, tap Discard. | Photo upload 413 = file too large; cap is 10 MB at the bucket level |

## Memory files

Agentic contributors store project facts in `~/.claude/projects/.../memory/`. The key files are:

- `project_fieldsurvey_match_status.md` — M1/F1/R1 semantics (locked in 2026-05-23)
- `project_fieldsurvey_matching_algorithm.md` — Census geocode + parcel-center snap + 30m
- `project_fieldsurvey_mobile_scope.md` — Mobile = field-collection only, never responses
- `project_fieldsurvey_desktop_layout.md` — 3-column shell, tabs in right rail
- `feedback_email_gmail_smtp.md` — Use Gmail SMTP via nodemailer, NEVER Resend

If you're contributing as a human, just read these as reference docs.
