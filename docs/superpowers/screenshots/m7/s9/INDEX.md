# M7 Section 9 — PWA · screenshot index

| # | File | What it proves |
|---|------|----------------|
| - | (no new screenshot) | Manifest + sw.js + meta tags; install instructions render OS-aware (iOS / Android / other). |

## What shipped

- **public/manifest.json** — full PWA manifest: name, short_name, description, start_url=/home, display=standalone, theme/background #0d1117, both 192 + 512 icons with `any maskable` purpose, categories.
- **public/sw.js** — promoted to v2. Network-only for `*.supabase.co` and `/api/*` (no user-scoped caching). Stale-while-revalidate for tile CDNs (OSM, Esri ArcGIS, Carto, OpenTopoMap) and Google Fonts. Cache trim at 800 tile entries / 100 font entries. Opaque (no-cors) responses cached too so the offline pre-cache works.
- **`components/mobile/install/install-instructions.tsx`** — OS-aware:
  - iOS Safari → written "Share → Add to Home Screen" steps
  - Android Chrome → captures `beforeinstallprompt`, shows "Install" button when fired; falls back to written ⋮ menu steps
  - other → generic instructions
  - if already in standalone mode → shows "Already installed" confirmation
- **`app/p/[projectId]/m/layout.tsx`** — Next.js 15 `viewport` + `metadata` exports drop the right meta tags: `viewport-fit=cover` (safe-area), `theme-color=#0d1117`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style=black-translucent`, `manifest=/manifest.json`.
- **`components/mobile/more/more-grid.tsx`** — Install section appended below the bento grid (admin More tab). Same component is reachable for member via the hamburger drawer's "Install app" link from S2.
- **Service worker registration** — already wired in S2's `MobileShellWrapper` (`navigator.serviceWorker.register('/sw.js')`). The SW only registers when a mobile shell mounts, never on desktop.

## Verification

- **Tests:** 51 pass.
- **Typecheck:** clean.
- **Lint:** clean.

## What's deferred

- Lighthouse PWA score audit (requires production-mode dev server + admin auth). Add to QA checklist.
- iOS install banner shown automatically on first /home visit (per spec §7.4 we deliberately chose "quiet — More menu only", so this is intentional, not a gap).
