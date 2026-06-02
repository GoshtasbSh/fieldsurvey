# M7 Section 3 — /home mobile picker + guest auto-route · screenshot index

S3 makes `/home` device-aware and lets guests skip the project picker.

| # | File | What it proves |
|---|------|----------------|
| 01 | `01-home-redirects-to-signin.png` | `/home` redirects unauthenticated visitors to `/sign-in` (auth gate unchanged). Compiled cleanly at 390×844. |

## Verification

- **Tests:** 51 pass (no new tests added — the picker is a server-side branch in a render, not a logic unit; existing surface-map + tabs tests cover the routing).
- **Typecheck:** clean.
- **Lint:** clean.
- **Code review:** deferred to the consolidated M7 review at the end (S3 is a thin patch; the heavy review happens at S4 when MapLibre + real data land).

## Why no real screenshot of the picker

The mobile picker requires a signed-in admin/member with at least one
project. Without a seeded test user in this environment, every `/home`
load redirects to `/sign-in`. The first real picker screenshot lands in
S4 once a logged-in flow is exercised end-to-end (sign-in → mobile home
picker → tap project → land on `/m/map`).

## Components shipped

- `components/home/mobile-project-row.tsx` — full-width thumb + name + stats per row.
- `components/home/home-body-mobile.tsx` — vertical sectioned list (Drafts / Owned / Shared).
- `app/home/page.tsx` — guest auto-route + device-aware body switch.
- `lib/mobile/role-gate.ts` — moved `assertSurfaceAllowed` here (Next.js rejects helper exports from `layout.tsx` files).

## Guest auto-route

```ts
// app/home/page.tsx
const guest = await readGuestSession();
if (guest?.projectId) {
  redirect(`/p/${guest.projectId}/m/map`);
}
```

A valid `fs_guest` HMAC cookie with `projectId` short-circuits the entire
picker (admin/member auth, profile fetch, listHomeCards). Per spec §4.4
guests don't see a project list — they always go straight to their one
project. This runs BEFORE the Supabase auth check so a guest in a browser
that also has a stale Supabase session doesn't fall through to the admin
home accidentally.
