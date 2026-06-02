# M7 Section 2 — Mobile shell · screenshot index

S2 ships the shell chrome only — topbar, tab bar, drawer, FAB, and the
placeholder Map page. The interactive surfaces (map, points, survey, chat)
that actually exercise the shell visually land in S4–S8.

| # | File | What it proves |
|---|------|----------------|
| 01 | `01-signin-mobile-clean.png` | Dev server compiles cleanly after the route-group restructure (no `/p/[id]/(desktop)/map` ↔ `/p/[id]/(mobile)/map` conflict). /sign-in renders at 390×844 in 79ms. |

## Verification done in this section (non-visual)

- **Tests:** 51 pass (added 13 for `lib/mobile/tabs.ts` covering TABS_BY_ROLE and SURFACES_BY_ROLE matrices for admin / member / guest).
- **Typecheck:** clean.
- **Lint:** clean.
- **Code review (everything-claude-code:code-reviewer):** 3 HIGH + 5 MED + 3 LOW findings, of which 5 (2 HIGH + 3 MED) were fixed in this commit:
  - HIGH: `mobile-fab.tsx` `React.CSSProperties` without React import → fixed with `CSSProperties` type import.
  - HIGH: Drawer had no focus trap — added focus-into-drawer + Tab/Shift+Tab cycling within the drawer's tabbable nodes.
  - MED: Topbar didn't absorb `safe-area-inset-top` — fixed so iPhone notch / Dynamic Island no longer clips the hamburger.
  - MED: Guest countdown was a hydration-mismatch risk — moved into a mount-effect that ticks every minute.
  - MED: Theme cookie missing `Secure` on HTTPS — fixed to conditionally append it based on `location.protocol`.
- **Deferred:**
  - HIGH: `(mobile)/field/page.tsx` bypasses `assertSurfaceAllowed`. That file is the OLD mobile shell (pre-M7), still routed at `/p/[id]/field` and kept working for back-compat until S4 deletes it and adds the `/field → /m/map` 308 redirect.
  - MED: role + Supabase client are fetched twice per request (once in layout, once in `assertSurfaceAllowed`). Refactor in S4 perf pass.
  - LOW: theme-data drift if MobileShellWrapper remounts after a user toggle.

## Route restructure

Original plan put pages under the `(mobile)` route group at the same URL
depth as `(desktop)`. Next.js 15 rejects that — two parallel pages from
different route groups can't resolve to the same URL. Moved the mobile
pages out of the route group entirely:

```
Before:                                After:
app/p/[projectId]/                     app/p/[projectId]/
├── (desktop)/                         ├── (desktop)/
│   └── map/page.tsx  ─┐               │   └── map/page.tsx  → /p/[id]/map
└── (mobile)/         ├─ conflict      ├── (mobile)/
    └── map/page.tsx  ─┘               │   └── field/page.tsx → /p/[id]/field  (legacy)
                                       └── m/                                   ← new
                                           ├── layout.tsx
                                           └── map/page.tsx  → /p/[id]/m/map
```

The `m/` prefix in the URL is now intentional — middleware (S1) uses it as
the device boundary and `lib/mobile/surface-map.ts` builds URLs accordingly.
