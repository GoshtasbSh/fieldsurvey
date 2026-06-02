# M7 — Mobile Dashboards Implementation Plan

Spec: `docs/superpowers/specs/2026-06-02-mobile-dashboards-m7-design.md`
Date: 2026-06-02
Driver: auto-mode, no per-step approval gates

## Execution policy

- Sections run in order 1 → 9.
- After EACH section: tests pass → `npm run lint` clean → `npm run typecheck` clean → review pass (code-review + click-path-audit on changed files) → Playwright screenshots captured → commit on `main` with `feat(m7-N): <section>` message.
- If a section fails verification, fix in place; do not advance until green.
- Final commit consolidates the screenshot index.

## Section 1 — Device routing fix

**Files:**
- `lib/device.ts` (PATCH) — cookie expiry + Path + SameSite; export `MOBILE_SURFACE_MAP` + `DESKTOP_SURFACE_MAP`.
- `middleware.ts` (PATCH) — before CSP, detect device; rewrite/redirect mismatched device + path.
- `app/p/[projectId]/(desktop)/layout.tsx` (PATCH) — belt-and-suspenders guard.
- `app/use-mobile/route.ts` (PATCH) — also sets `fs_device_pref=mobile` for stickiness.
- `app/use-desktop/route.ts` (NEW) — symmetric escape hatch.
- `app/home/page.tsx` (PATCH) — device-aware, picks `<HomeBodyDesktop>` vs `<HomeBodyMobile>`.
- `lib/queries/guest.ts` (NEW or PATCH) — `getGuestProjectId(): string | null` reads `fs_guest`.
- `app/home/page.tsx` (PATCH) — guest device=mobile → redirect to `/p/<id>/m/map`.
- `lib/device.test.ts` (PATCH) — cookie attribute tests + matcher tests.
- `tests/middleware-routing.test.ts` (NEW) — table-driven: (path, device, role) → expected redirect.

**Verify:**
- `npm test -- device middleware`
- Playwright: visit `/p/X/map` with mobile UA → lands on `/p/X/m/map`. Visit `/p/X/m/map` with desktop UA → lands on `/p/X/map`. Guest → `/p/X/m/map`.
- Take screenshots: `m7/s1/desktop-redirected.png`, `m7/s1/mobile-redirected.png`.

## Section 2 — Mobile shell components

**Files:**
- `app/p/[projectId]/(mobile)/layout.tsx` (NEW) — top bar + tab bar + drawer wrapper + meta tags + sw registration + role gate + theme + safe-area.
- `app/p/[projectId]/(mobile)/shell.css` (NEW) — mobile-only tokens.
- `components/mobile/shell/mobile-shell.tsx` (NEW) — outer wrapper.
- `components/mobile/shell/mobile-topbar.tsx` (NEW)
- `components/mobile/shell/mobile-tabbar.tsx` (NEW) — role-aware tab list.
- `components/mobile/shell/mobile-drawer.tsx` (NEW) — hamburger drawer.
- `components/mobile/shell/mobile-fab.tsx` (NEW) — KeyStone "＋".
- `components/mobile/icons/icons.tsx` (NEW) — Map / Pin / Survey / Chat / More / Report / Plus / Locate / Compass / Menu / Bell / Settings.
- `lib/mobile/role-gate.ts` (NEW) — `getProjectRole(projectId)`.
- `lib/mobile/tabs.ts` (NEW) — `TABS_BY_ROLE`, `SURFACES_BY_ROLE`, `surfaceLabels`.
- `tests/mobile/role-gate.test.ts` (NEW)
- `tests/mobile/tabs.test.ts` (NEW)

**Verify:** unit tests, snapshot the bare shell with no inner content.

## Section 3 — `/home` mobile picker + guest auto-route

**Files:**
- `components/home/home-body-mobile.tsx` (NEW) — vertical card list (uses existing `home-thumb.tsx`).
- `app/home/page.tsx` (PATCH) — branch on device; guest → redirect to project.
- `components/mobile/home-card.tsx` (NEW) — mobile project card with thumb + status pill + tap-target.

**Verify:** Playwright sign in as admin (mobile UA) → land on `/home`, see mobile picker, tap card → land on `/p/X/m/map`. Sign in as guest → straight to map.

## Section 4 — Map tab

**Files:**
- `app/p/[projectId]/(mobile)/map/page.tsx` (NEW) — server component, fetches points + match-counts + boundaries.
- `components/mobile/map/mobile-map.tsx` (NEW) — MapLibre wrapper, reuses `lib/map/`.
- `components/mobile/map/stat-strip.tsx` (NEW) — collapsible stats above tab bar.
- `components/mobile/map/filter-sheet.tsx` (NEW) — swipe-up bottom sheet with status chips.
- `components/mobile/map/basemap-sheet.tsx` (NEW) — basemap picker bottom sheet.
- `components/mobile/map/place-mode-banner.tsx` (NEW) — "Tap the map to place" hint.
- `app/p/[projectId]/(mobile)/add/page.tsx` (NEW) — full-screen add form pushed from FAB long-press.
- `app/p/[projectId]/(mobile)/field/` (DELETE) — replaced by `/m/map/`.
- Back-compat: `/field` → `/m/map` 308 redirect.

**Verify:** screenshots admin/member/guest × dark/light = 6 screenshots. Click-path: tap FAB → place mode → tap map → form opens → submit → returns to map with new pin.

## Section 5 — Points + Survey tabs

**Files:**
- `app/p/[projectId]/(mobile)/points/page.tsx` (NEW)
- `components/mobile/points/points-list.tsx` (NEW) — virtualized list.
- `components/mobile/points/point-row.tsx` (NEW)
- `app/p/[projectId]/(mobile)/survey/page.tsx` (NEW)
- `components/mobile/survey/survey-list.tsx` (NEW)
- `components/mobile/survey/survey-detail.tsx` (NEW) — edit (admin) / read-only (member).
- Role gate: guest visiting these → notFound().

**Verify:** screenshots × 3 roles × 2 themes. Click-path: filter + search + tap row + edit response + save.

## Section 6 — Chat tab

**Files:**
- `app/p/[projectId]/(mobile)/chat/page.tsx` (NEW)
- `components/mobile/chat/chat-thread.tsx` (NEW)
- `components/mobile/chat/chat-composer.tsx` (NEW)
- Reuse `lib/queries/chat.ts` + realtime subscription.

**Verify:** screenshots × 3 roles. Click-path: send message → it appears → pull-to-refresh works.

## Section 7 — Report tab (guest)

**Files:**
- `app/p/[projectId]/(mobile)/report/page.tsx` (NEW) — guest-only role gate.
- `components/mobile/report/report-form.tsx` (NEW)
- `app/api/reports/guest/route.ts` (NEW) — POST handler, HMAC-verifies `fs_guest`, validates, uploads photo to storage, inserts row, dispatches notifications.
- `supabase/migrations/028_guest_reports.sql` (NEW) — `guest_reports` table + RLS + storage bucket `guest-reports`.
- `lib/notifications/admin-report.ts` (NEW) — in-app row + email via nodemailer Gmail SMTP (per memory: NEVER Resend).
- `tests/api/guest-report.test.ts` (NEW)

**Verify:** screenshot of empty + filled + success state. Click-path: open report → fill → submit → admin gets email. RLS test: non-guest can't POST.

## Section 8 — More + Analysis + Members + Settings + Import + Reports

**Files (all NEW):**
- `app/p/[projectId]/(mobile)/more/page.tsx` + `components/mobile/more/more-sheet.tsx`
- `app/p/[projectId]/(mobile)/analysis/page.tsx` + `components/mobile/analysis/kpi-cards.tsx` + `daily-sparkline.tsx`
- `app/p/[projectId]/(mobile)/members/page.tsx` + `components/mobile/members/members-list.tsx`
- `app/p/[projectId]/(mobile)/settings/page.tsx` + `components/mobile/settings/settings-form.tsx`
- `app/p/[projectId]/(mobile)/import/page.tsx` + `components/mobile/import/import-wizard.tsx`
- `app/p/[projectId]/(mobile)/reports/page.tsx` + `components/mobile/reports/reports-list.tsx`

**Verify:** admin screenshots for each surface × 2 themes. Member visiting any of these → notFound() (test). Guest visiting → notFound() (test).

## Section 9 — PWA

**Files:**
- `public/manifest.json` (NEW) — see spec §7.1.
- `public/sw.js` (NEW) — lifted from KeyStone with paths adjusted.
- `public/icon-192.png`, `public/icon-512.png` — move from repo root (already exist in untracked).
- `components/mobile/install/install-instructions.tsx` (NEW) — OS-aware.
- `lib/pwa/install-prompt.ts` (NEW) — `beforeinstallprompt` capture for Android.
- `(mobile)/layout.tsx` (PATCH) — register sw + meta tags + theme-color.
- `middleware.ts` (PATCH) — exclude `/manifest.json`, `/sw.js`, `/icon-*.png` from CSP rewrites if needed.

**Verify:** Lighthouse mobile PWA score ≥ 90. iOS Safari install instructions render correctly. Android beforeinstallprompt fires. Screenshots of install instructions for iOS + Android.

## Section 10 — Final consolidation

- Update `MEMORY.md` with new memory: `project_fieldsurvey_m7_shipped.md`.
- Update `CLAUDE.md` mobile-scope section if anything diverged.
- Update `graphify-out` via the hook.
- Capture screenshot index `docs/superpowers/screenshots/m7/INDEX.md` linking each.
- Final commit: `feat(m7): mobile dashboards complete — admin/member/guest shells, PWA install`.

## Definition of done

- All 36 screenshots committed.
- All tests pass.
- All reviews pass.
- All three roles round-trip through every allowed surface.
- PWA installs on iOS Safari + Android Chrome.
- Mobile users no longer see the desktop dashboard ever.
