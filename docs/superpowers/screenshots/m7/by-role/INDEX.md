# M7 — Per-role visual verification

Captured via Playwright (390×844 viewport, iPhone 14 Pro proportions) against
the running dev server with mobile cookie `fs_device_pref=mobile` set. Project
used: `QA Verification` (`3559f818-f8d7-417e-8a0f-4e19e23eb49b`) in
`fieldSurvey_prod` (`ykssihpinzbgmpylqtjl.supabase.co`).

Two temp users were seeded for the pass and **deleted at the end** (rows
verified at 0 across `auth.users`, `auth.identities`, `public.profiles`,
`public.project_members`, `public.guest_sessions`).

## Admin (11 screens) — `m7-admin@fs-test.dev`

| Surface | File |
|---|---|
| `/home` (mobile picker) | `admin/00-home-picker.png` |
| `/m/map` | `admin/01-map.png` |
| `/m/points` | `admin/02-points.png` |
| `/m/survey` | `admin/03-survey.png` |
| `/m/chat` | `admin/04-chat.png` |
| `/m/more` (bento) | `admin/05-more.png` |
| `/m/analysis` | `admin/06-analysis.png` |
| `/m/members` | `admin/07-members.png` |
| `/m/settings` | `admin/08-settings.png` |
| `/m/import` | `admin/09-import.png` |
| `/m/reports` (guest_reports inbox) | `admin/10-reports.png` |

## Member (4 screens + 2 role-gate proofs) — `m7-member@fs-test.dev` (DB role: `surveyor`)

| Surface | File |
|---|---|
| `/home` (mobile picker) | `member/00-home-picker.png` |
| `/m/map` | `member/01-map.png` |
| `/m/points` | `member/02-points.png` |
| `/m/survey` (no Edit affordance) | `member/03-survey.png` |
| `/m/chat` | `member/04-chat.png` |
| `/m/more` → **404** | `member/99-more-blocked-404.png` |
| `/m/analysis` → **404** (verified via URL, see snapshot) | n/a |

The 404 on `/m/more` proves `assertSurfaceAllowed('more')` correctly gates the
admin-only surface. The same gate fires for `/m/analysis`, `/m/members`,
`/m/settings`, `/m/import`, `/m/reports` (covered by `tests/mobile/tabs.test.ts`
matrix).

## Guest — BLOCKED in this environment

Guest sign-in calls `POST /api/guest/start` which requires
`SUPABASE_SERVICE_ROLE_KEY` to HMAC-sign the `fs_guest` cookie. The local
`.env.local` only has the **variable name** with no value (likely never
pulled from Vercel's env store).

```
% grep SUPABASE_SERVICE_ROLE_KEY .env.local
SUPABASE_SERVICE_ROLE_KEY=
```

Result: `/api/guest/start` returns `500 supabaseKey is required` (logged in
`/tmp/fs-dev-guest.log`). Guest visual verification has to be done either:

1. After `vercel env pull --environment=development` (which populates the
   key), or
2. From the deployed Vercel URL where the env var is set, or
3. By running the Vercel dev command (`vercel dev`) which pulls env from the
   Vercel project.

**Code-side guarantees that ship in M7 anyway:**

- `app/api/reports/guest/route.ts` — guest report endpoint behind HMAC + DB rate-limit (S7 + post-review fixes)
- `app/p/[projectId]/m/report/page.tsx` — `assertSurfaceAllowed('report')` so admin/member 404
- `app/p/[projectId]/m/chat/page.tsx` — renders the friendly `GuestChatPlaceholder` for guest role (manually inspected, lines 26–28)
- `lib/auth/guest-session.ts` — HMAC verifier reviewed and confirmed solid in the security pass

## Cleanup confirmation

```
auth_users_left   = 0
profiles_left     = 0
memberships_left  = 0
guest_codes_left  = 0
```

Net change in prod: zero rows.
