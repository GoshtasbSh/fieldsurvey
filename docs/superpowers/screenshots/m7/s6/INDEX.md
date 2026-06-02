# M7 Section 6 — Chat tab · screenshot index

| # | File | What it proves |
|---|------|----------------|
| - | (no new screenshot) | Reuses existing ChatPanel; dev server was healthy at end of S5. |

## Verification

- **Tests:** 51 pass.
- **Typecheck:** clean.
- **Lint:** clean.

## What shipped

- `app/p/[projectId]/m/chat/page.tsx` — gates by role:
  - admin / member → wraps the existing `ChatPanel` (read/write).
  - guest → renders a friendly placeholder pointing them to the Report tab.

## Why guest sees a placeholder, not chat

The existing `ChatPanel` requires `currentUserId: string` (Supabase user id).
Guests don't have a Supabase user — they ride a HMAC-signed `fs_guest`
cookie. Wiring guest read-only chat needs either a separate API route
that auths via the cookie or a refactor of `ChatPanel` to accept a guest
session id. Both are out of scope for S6's "thin reuse" approach. The
placeholder is honest about it and points guests at the report tab.
