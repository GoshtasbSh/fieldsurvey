# M7 Section 4 — Map tab + Add point · screenshot index

S4 lands the real interactive Map tab. MapLibre full-bleed inside the
MobileShell, role-aware overlays, KeyStone "+" FAB linking to a new
full-screen Add page, and a 308 redirect for the legacy `/field` URL.

| # | File | What it proves |
|---|------|----------------|
| 01 | `01-signin-after-s4.png` | Dev server compiles cleanly after S4 lands. /sign-in still loads at 390×844. |

## Verification (non-visual)

- **Tests:** 51 pass.
- **Typecheck:** clean.
- **Lint:** clean.
- **Route conflict check:** none — `(desktop)/map/page.tsx` and `m/map/page.tsx` resolve to different URLs (`/p/[id]/map` vs `/p/[id]/m/map`).

## Components shipped

- `components/mobile/map/mobile-map-view.tsx` — full-bleed MapLibre + locate / basemap utility column + filter chip strip + collapsible stat strip + FAB. Role-aware (guest hides stat strip + admin/member shows total+today+done+mine).
- `components/mobile/map/add-point-page.tsx` — full-screen add point page. Auto-captures GPS on mount, falls back to manual entry on denial.
- `app/p/[projectId]/m/map/page.tsx` — replaces the S2 placeholder. Fetches statuses + features + boundaries + per-user stats and per-project today delta.
- `app/p/[projectId]/m/add/page.tsx` — server entry to the add-point page.
- `app/p/[projectId]/field/page.tsx` — `permanentRedirect` to `/m/map` (308).
- `app/p/[projectId]/(mobile)/` — deleted. The route group is no longer used.
- `app/(auth)/sign-in/_components/guest-tab.tsx` — guest post-signin redirect updated `/field` → `/m/map`.

## Why no auth'd map screenshot

Capturing a real map render requires a seeded test project + auth flow.
The visual map proof lands in the final M7 consolidation pass when an
end-to-end Playwright login is wired.

## What's deferred to a follow-up

- Place mode on the map itself (tap-to-place). Currently the FAB navigates
  to a dedicated `/m/add` page that uses geolocation; the tap-to-place
  flow from KeyStone is not yet wired into MaplibreMap's `placingMode`.
- Custom map icons for the locate-me / basemap buttons (currently text
  placeholders "S/M/L" for satellite/streets/light).
- Bottom sheet for status filter — currently a horizontal chip strip; a
  tap-to-expand sheet was in the spec but is non-blocking for S4.
