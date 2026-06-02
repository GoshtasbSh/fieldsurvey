# M7 — Mobile Dashboards (FieldSurvey)

**Date:** 2026-06-02
**Branch:** `main`
**Author:** brainstorming session, auto-mode
**Status:** Locked, ready for implementation

## 0. Problem

Mobile users currently see the desktop dashboard because:

1. `(desktop)/layout.tsx` has no UA guard (comment trusts the parent, but the parent only runs for the bare `/p/[id]` URL — every sub-path bypasses it).
2. `middleware.ts` only handles Supabase session + CSP — no device routing.
3. `/home` is desktop-only with no mobile branch.
4. The `fs_device_pref` cookie can silently override UA detection (no expiry, no recovery from home).
5. No mobile dashboard surfaces exist except the single `(mobile)/field/` map page.

Goal: a complete, role-aware mobile shell that mirrors KeyStone's field PWA UX, adds a project picker home, surfaces a mini analytics dashboard for admins, and installs cleanly as a PWA on iOS + Android.

## 1. Locked decisions

| Decision | Value |
|---|---|
| Scope per role | Admin = full mirror, Member = field + view, Guest = minimum |
| Home routing | Guest auto-routes to project. Admin/Member always see picker (even with 1 project) |
| Navigation shell | Bottom-tab bar (KeyStone-style line icons + KeyStone "＋" FAB) |
| Theme | KeyStone parity — dark default, light toggle, same `#0d1117/#38bdf8` palette |
| Admin analysis | Mini dashboard — 3 KPI cards + 1 chart (daily activity sparkline) |
| Guest report form | Title + body + photo + auto-location |
| PWA install | Quiet — link in More menu only, no auto-prompt |

## 2. Role × Tab matrix

| Tab | Admin | Member | Guest |
|---|---|---|---|
| Map (default) | ✓ | ✓ | ✓ |
| Add Point (FAB) | ✓ | ✓ | ✓ |
| Points list | ✓ | ✓ | — |
| Survey responses | ✓ (edit) | ✓ (read-only) | — |
| Chat | ✓ | ✓ | ✓ |
| Report (form → admins) | — | — | ✓ |
| More (sheet) | ✓ | — | — |
| → Members | ✓ | — | — |
| → Settings | ✓ | — | — |
| → Import | ✓ | — | — |
| → Analysis (mini) | ✓ | — | — |
| → Reports (recipients) | ✓ | — | — |
| → PWA install instructions | ✓ | ✓ (via ham) | — |
| → Switch project | ✓ | ✓ (via ham) | — |
| → Sign out | ✓ | ✓ (via ham) | ✓ (via ham, ends session) |

Total tabs visible:
- Admin: 5 (Map · Points · Survey · Chat · More)
- Member: 4 (Map · Points · Survey · Chat) + ham menu for Switch project / PWA / Theme / Sign out
- Guest: 3 (Map · Chat · Report) + ham menu for End session / Sign out

## 3. Routes

```
app/
├── home/page.tsx                  # device-aware: mobile picker vs desktop bento
├── p/[projectId]/
│   ├── page.tsx                   # device-aware redirector (already exists, fixed)
│   ├── (desktop)/                 # unchanged
│   │   └── layout.tsx             # PATCH: add UA guard, redirect mobile → ../m/<surface>
│   └── (mobile)/
│       ├── layout.tsx             # NEW — tab-bar shell, role gate, topbar
│       ├── map/page.tsx           # NEW — was field/page.tsx
│       ├── add/page.tsx           # NEW — full-screen point form (push from FAB)
│       ├── points/page.tsx        # NEW — admin + member
│       ├── survey/page.tsx        # NEW — responses, role-aware
│       ├── chat/page.tsx          # NEW — all roles
│       ├── report/page.tsx        # NEW — guest only
│       ├── more/page.tsx          # NEW — admin only sheet of links
│       ├── analysis/page.tsx      # NEW — admin mini dashboard
│       ├── members/page.tsx       # NEW — admin
│       ├── settings/page.tsx      # NEW — admin
│       ├── import/page.tsx        # NEW — admin
│       └── reports/page.tsx       # NEW — admin
├── use-mobile/route.ts            # PATCH: also clear fs_device_pref on visit
├── use-desktop/route.ts           # NEW — sets fs_device_pref=desktop
└── api/
    └── reports/guest/route.ts     # NEW — guest report submission

middleware.ts                       # PATCH: add device-enforcement step
public/manifest.json                # NEW — PWA
public/sw.js                        # NEW — offline shell + tiles
public/icon-{192,512}.png           # ALREADY in repo root (move to /public)
```

Note: the existing `(mobile)/field/page.tsx` is renamed/replaced by `(mobile)/map/page.tsx`. A back-compat redirect from `/field` to `/m/map` is added in the parent layout so old bookmarks don't 404.

## 4. Device detection & routing (fixes the bug)

### 4.1 `lib/device.ts`

- Keep current priority: cookie → client-hint → UA.
- Add `expires: 30 days`, `Path=/`, `SameSite=Lax` on cookie writes.
- Export a helper `mobileSurfaceMap` that maps `(desktop)` paths → `(mobile)` paths:

```
'/p/[id]/map'        → '/p/[id]/m/map'
'/p/[id]/points'     → '/p/[id]/m/points'
'/p/[id]/responses'  → '/p/[id]/m/survey'
'/p/[id]/members'    → '/p/[id]/m/members'
'/p/[id]/settings'   → '/p/[id]/m/settings'
'/p/[id]/import'     → '/p/[id]/m/import'
```

### 4.2 `middleware.ts`

After the Supabase session refresh, before CSP headers:

```ts
const url = request.nextUrl
const m = url.pathname.match(/^\/p\/([^/]+)\/(map|points|responses|members|settings|import)\/?$/)
if (m && device === 'mobile') {
  const [, pid, surface] = m
  return NextResponse.redirect(new URL(`/p/${pid}/m/${MOBILE_SURFACE[surface]}`, request.url))
}
// reverse: /p/[id]/m/* on desktop → redirect to desktop
const m2 = url.pathname.match(/^\/p\/([^/]+)\/m\/(map|points|survey|chat|more|analysis|members|settings|import|reports|report)\/?$/)
if (m2 && device === 'desktop' && surface in DESKTOP_SURFACE_MAP) {
  return NextResponse.redirect(...)
}
```

Mobile-only surfaces (`/chat`, `/report`, `/more`, `/analysis`) on a desktop UA fall through to the mobile route (desktop is permitted to render mobile pages; we just never *force* it).

### 4.3 `app/p/[projectId]/(desktop)/layout.tsx`

Belt-and-suspenders: also call `detectDeviceServer()` and `redirect()` to the mobile equivalent if `device === 'mobile'`. The middleware catches it first; this catches CSR-only navigations that skip middleware (rare but cheap insurance).

### 4.4 Guest auto-route

Guest sign-in already writes `fs_guest` HMAC cookie with `project_id`. On `/home` for guest device=mobile: redirect immediately to `/p/{project_id}/m/map`. Admin/member always see picker.

## 5. UI shell

### 5.1 Tokens (mobile-specific, in `app/p/[projectId]/(mobile)/shell.css`)

```
--m-bg, --m-card, --m-line, --m-ink, --m-ink-2, --m-ink-3
--m-accent: #38bdf8           (dark) / #1877F2 (light, KeyStone parity)
--m-tabbar-h: 72px            (with safe-area inset added)
--m-topbar-h: 56px
--m-fab-size: 60px
--m-touch-min: 44px           (Apple HIG)
```

Safe-area: `env(safe-area-inset-bottom)` added to tab-bar padding so the home-indicator on iPhone doesn't overlap. `viewport-fit=cover` set in layout's `<head>`.

### 5.2 Components (in `components/mobile/`)

```
components/mobile/
├── shell/
│   ├── mobile-shell.tsx       # outer wrapper, applies theme + safe-area
│   ├── mobile-topbar.tsx      # ham + project name + role tag + live + avatar
│   ├── mobile-tabbar.tsx      # bottom tabs, role-aware
│   ├── mobile-drawer.tsx      # hamburger left drawer (sign out, switch project, theme, install)
│   └── mobile-fab.tsx         # KeyStone-style "＋" with offline-queue badge
├── icons/
│   └── icons.tsx              # SVG icons (KeyStone-style line)
├── map/
│   ├── mobile-map.tsx         # MapLibre map (reuses existing map lib)
│   ├── stat-strip.tsx         # collapsible stats row above tabs
│   └── filter-sheet.tsx       # status filter bottom sheet (chip grid)
├── points/
│   └── points-list.tsx        # virtualized, with status chip + address
├── survey/
│   ├── survey-list.tsx        # responses list
│   └── survey-detail.tsx      # response detail, edit form (admin) / read-only (member)
├── chat/
│   └── chat-thread.tsx        # reuses existing chat queries; mobile sticky composer
├── report/
│   └── report-form.tsx        # title, body, photo, auto-location (guest)
├── more/
│   └── more-sheet.tsx         # admin: 6 grid items linking to surfaces
├── analysis/
│   ├── kpi-cards.tsx          # 3 KPI cards
│   └── daily-sparkline.tsx    # 1 chart
├── members/
│   └── members-list.tsx
├── settings/
│   └── settings-form.tsx
├── import/
│   └── import-wizard.tsx       # reuse existing wizard, mobile-tuned
├── reports/
│   └── reports-list.tsx
└── install/
    └── install-instructions.tsx  # iOS + Android instructions per OS detection
```

### 5.3 Role gate (in `(mobile)/layout.tsx`)

```ts
const role = await getProjectRole(projectId)            // 'admin' | 'member' | 'guest'
const tabs = TABS_BY_ROLE[role]                          // see §2 matrix
const allowedSurfaces = SURFACES_BY_ROLE[role]
if (!allowedSurfaces.has(currentSurface)) notFound()    // 404 instead of leaking
```

`getProjectRole` returns `'guest'` if the request bears a valid `fs_guest` cookie matching the project; otherwise reads `project_members.role`. Member roles other than admin/member are coerced to `'member'`.

### 5.4 Theme

- `data-theme="dark"|"light"` on `<html>` (matches existing FieldSurvey convention).
- Toggle stored in `fs_theme` cookie + reflected in profile (`profiles.theme`) for cross-device.
- First visit: read cookie; if absent, fall back to `prefers-color-scheme` once, then write the cookie.

## 6. Per-surface specs

### 6.1 Map (`/m/map`)

- MapLibre full-screen. Reuses `lib/map/` from desktop.
- Top: existing top bar (project name, role, live badge, avatar).
- Bottom: collapsible stat strip (4 stats for admin, 3 for member, hidden for guest) + tab bar.
- Right: compass, locate-me, basemap stack (bottom-sheet on tap, not popup).
- FAB: KeyStone "＋" with offline-queue count badge. Tapping enters Place mode (long-press for instant drop).
- Pins: same status palette as desktop; guest's own points yellow-ringed.
- Filter chips: bottom sheet via swipe-up gesture on stat strip.
- Realtime presence: reuses `RealtimeWatcher`.

### 6.2 Points (`/m/points`)

- Virtualized list, 100 visible at a time, infinite scroll.
- Each row: status dot + address + age + surveyor + match-status glyph.
- Top: search input + status filter chip strip.
- Tap → response detail (if linked) or point detail with edit (admin) / view (member).
- Empty state if no points.

### 6.3 Survey (`/m/survey`)

- Admin: list of responses with edit button on each.
- Member: same list, read-only (no edit affordance).
- Detail page: scroll-stacked form fields. Save button sticky at bottom (admin only).
- Search by respondent + filter by status.

### 6.4 Chat (`/m/chat`)

- Reuses `listChatMessages` query.
- Bubble list with sender avatar + name + time.
- Sticky composer at bottom with `@mention` support (reuses existing chat lib).
- Pull-to-refresh.
- Unread badge on the tab.

### 6.5 Report (`/m/report`) — guest only

- Single screen, no list.
- Form fields:
  - Title (text, required, max 80)
  - Body (textarea, required, max 1000)
  - Photo (camera/library, optional, single, max 5MB, client-resized to 1600px JPEG)
  - Auto-location (lat/lng captured on form mount via `navigator.geolocation`; user can opt out)
- Submit → `POST /api/reports/guest` → inserts into `reports` table → in-app + email notifications to all project admins.
- Success state: "Report sent. The admin team has been notified."

### 6.6 More (`/m/more`) — admin only

- Bento-grid of 6 links: Members · Settings · Import · Analysis · Reports · Install app.
- Below: Theme toggle row + Switch project + Sign out.
- Each tile: large icon + label + 1-line description.

### 6.7 Analysis (`/m/analysis`) — admin only

- 3 KPI cards stacked vertically: Total points, Today, Coverage %.
- 1 chart: 14-day daily activity sparkline (reuses `getDailyActivity` query).
- Empty state if no data.

### 6.8 Members (`/m/members`) — admin only

- List of project members with role + last-active.
- Invite button (sheet) — same RPC as desktop.
- Tap member → role swap + remove (admin self-protection: cannot demote sole admin).

### 6.9 Settings (`/m/settings`) — admin only

- Form: project name, description, default basemap, status-question label, daily report toggle.
- Save button sticky.

### 6.10 Import (`/m/import`) — admin only

- Mobile-tuned import wizard (steps stack vertically, file picker uses native chooser).
- Reuses existing column-matching logic; bigger touch targets.

### 6.11 Reports (`/m/reports`) — admin only

- Two sections: Recipients (CRUD) + Send-now button.
- Reuses existing reports lib.

## 7. PWA

### 7.1 `public/manifest.json`

```json
{
  "name": "FieldSurvey",
  "short_name": "FieldSurvey",
  "description": "Community field survey collection",
  "start_url": "/home",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#0d1117",
  "theme_color": "#0d1117",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ],
  "categories": ["productivity", "utilities"],
  "scope": "/"
}
```

### 7.2 `public/sw.js`

Lifted from KeyStone (proven):
- Network-only for `/api/*` and `*.supabase.co` (user-scoped, never cache).
- Cache-first for fonts, tile CDNs, app shell.
- Cache opaque tile responses (no-cors).

### 7.3 Layout meta tags

In `(mobile)/layout.tsx` head:

```html
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0d1117">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icon-192.png">
```

### 7.4 Install instructions component

OS detection from `lib/device.ts::detectOS`:
- **iOS**: "Tap Share → Add to Home Screen → Add" with screenshots.
- **Android**: Native `beforeinstallprompt` handler; falls back to "Tap menu (⋮) → Add to Home Screen".
- **Other**: same Android instructions.

Lives in the More menu (admin) or hamburger drawer (member). Never auto-prompts.

### 7.5 Service worker registration

In `(mobile)/layout.tsx`:

```ts
useEffect(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }
}, []);
```

Only registered in `(mobile)` shell so desktop users aren't service-workered.

## 8. Security

### 8.1 Role enforcement

- Layout role gate (§5.3) is UX-only — surfaces also enforce via Supabase RLS.
- Audit on existing RLS: `project_members`, `points`, `responses`, `chat_messages`, `reports`, `project_settings` all read by role.
- Guest token: `getProjectRole` calls `verify_guest_session` RPC (existing), returns null on expired sessions → 401.

### 8.2 Guest report endpoint

- Validates `fs_guest` HMAC cookie.
- Rate-limited via existing IP-based throttle.
- Photo upload to Supabase storage bucket `guest-reports` (RLS: read by admins, write by valid guest).
- Body size limit: 1KB text + 5MB image → JSON payload 7MB max.

### 8.3 CSP

Existing CSP in middleware already allows tile CDNs + Supabase. Add `media-src 'self' blob:` if photo capture uses blob URLs (already present).

## 9. Out of scope (M7)

- Offline-first point sync (already shipped in earlier milestone via IndexedDB queue — mobile inherits it; no new work).
- Push notifications.
- Native iOS/Android apps (PWA only).
- New analytics charts beyond the single sparkline.
- New roles beyond admin/member/guest.
- Realtime chat indicators beyond what desktop already has.

## 10. Acceptance

- Each tab loads under 2s on a throttled "Slow 4G" Playwright run.
- Lighthouse mobile PWA: 90+ on installable + best practices.
- All three roles reach exactly the surfaces in §2 matrix — no leaks.
- iOS Safari and Android Chrome both install as PWA and launch into `/home`.
- After install, app shell works offline (map + last cached tiles).
- Click-path audit passes for every tab × every role.
- Code review (typescript-reviewer, security-reviewer) returns no high-severity findings.
- Playwright screenshots captured per surface per role per theme: 6 × 3 × 2 = 36 screenshots committed under `docs/superpowers/screenshots/m7/`.

## 11. Implementation order (becomes the plan)

1. Device routing fix (middleware + layouts + cookie hygiene)
2. Mobile shell components (topbar + tabbar + drawer + FAB + tokens)
3. `/home` mobile picker + guest auto-route
4. Map tab (largest surface, reuses existing map lib)
5. Points + Survey tabs
6. Chat tab
7. Report tab (guest) + API endpoint + storage bucket
8. More + Analysis + Members + Settings + Import + Reports (admin extras)
9. PWA manifest + sw.js + install component + service worker registration

After each section: `/review`, `everything-claude-code:code-review`, `click-path-audit`, Playwright screenshots, then commit + move to next.
