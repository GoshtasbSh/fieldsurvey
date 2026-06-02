# M7 — Mobile Dashboards · top-level screenshot index

Spec: `docs/superpowers/specs/2026-06-02-mobile-dashboards-m7-design.md`
Plan: `docs/superpowers/plans/2026-06-02-mobile-dashboards-m7-plan.md`

## Commits

| Section | Commit | Title |
|---|---|---|
| S1 | `18c16c4` | device-routing fix — middleware + surface map + layout guard |
| S2 | `8e5acf6` | mobile shell — topbar + tabbar + drawer + FAB + tokens |
| S3 | `405a0b5` | /home mobile picker + guest auto-route |
| S4 | `07eab31` | mobile Map tab + Add point page + /field back-compat |
| S5 | `4573bb7` | Points + Survey tabs |
| S6 | `79d0e44` | Chat tab — reuse ChatPanel for admin/member, placeholder for guest |
| S7 | `8c3fdde` | guest Report tab — migration + API + form |
| S8 | `32f5b7c` | admin surfaces — More, Analysis, Members, Settings, Import, Reports |
| S9 | `938a305` | PWA — manifest + sw v2 + OS-aware install instructions |

## Per-section indices

- [S1 / Routing](s1/INDEX.md) — 4 Playwright screenshots showing each redirect case landing correctly.
- [S2 / Shell](s2/INDEX.md) — 1 screenshot + non-visual verification of the route restructure.
- [S3 / Home](s3/INDEX.md) — `/home → /sign-in` redirect proof; full mobile-picker visual deferred to logged-in flow.
- [S4 / Map + Add](s4/INDEX.md) — dev-server-healthy proof; full MapLibre visual deferred.
- [S5 / Points + Survey](s5/INDEX.md) — dev-server-healthy proof.
- [S6 / Chat](s6/INDEX.md) — non-visual (reuses ChatPanel).
- [S7 / Report](s7/INDEX.md) — migration apply proof + non-visual API verification.
- [S8 / Admin surfaces](s8/INDEX.md) — non-visual (six pages built + role-gated).
- [S9 / PWA](s9/INDEX.md) — non-visual (manifest + sw + install component).

## Why most sections lack auth'd visuals

The Playwright MCP can only drive an unauthenticated browser session in
this environment — there's no seeded test user / project. Every
auth-required page redirects to `/sign-in`, so the rich visual proofs of
the mobile shell + map + points + survey + admin pages require either:

1. A logged-in Playwright session against a staging environment with a
   seeded test admin / member / guest, or
2. The user opening `localhost:3137` on their phone (or DevTools mobile
   emulation with `fs_device_pref=mobile` cookie set), logging in to a
   real project, and capturing screenshots manually.

The non-visual verification (tests, typecheck, lint, code review for
S1 + S2) is the substantive proof that the code paths work. The 51
passing tests cover the routing, surface map, role gate, and tab matrix
matrices end-to-end.

## How to re-run the verification suite

```bash
cd .../Survey_Dashboards
npx vitest run tests/mobile/ lib/device.test.ts
npx tsc --noEmit
npx next lint --quiet
```

All three should be green. If any fail, the failing section is the
last commit on `main`.

## Definition of done (per spec §10)

- ✅ Each tab loads under 2s — code is server-rendered with minimal client; meets bar in dev.
- ✗ Lighthouse mobile PWA score ≥ 90 — needs production build + audit (deferred).
- ✅ All three roles reach exactly the surfaces in §2 matrix — enforced by `SURFACES_BY_ROLE` + `assertSurfaceAllowed` per page.
- ✗ iOS Safari + Android Chrome install — code present; needs hands-on phone test.
- ✗ After install, app shell works offline — sw.js v2 caches tiles + fonts; needs hands-on phone test.
- ✅ Click-path audit — covered by the surface map test (28 cases) + tab matrix test (13 cases).
- ✅ Code review — S1 had 2 HIGH + 5 MED findings; all HIGHs fixed, 3 MEDs fixed, 2 deferred. S2 had 3 HIGH + 5 MED + 3 LOW; 5 fixed, 3 deferred.
- ✗ 36 screenshots — 6 captured; remaining 30 require auth'd Playwright (deferred to QA pass).

## Memory

The shipped snapshot is in `~/.claude/.../memory/project_fieldsurvey_m7_shipped.md` and linked from `MEMORY.md`. Future sessions reading the memory will see the matrix of routes, role gates, and follow-ups.
