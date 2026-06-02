# M7 Section 7 — Report tab (guest) + API + storage · screenshot index

| # | File | What it proves |
|---|------|----------------|
| - | (no new screenshot) | Form requires guest cookie; full visual proof in final consolidation. |

## What shipped

- **Migration 028_guest_reports.sql** — applied to prod (`fieldSurvey_prod`). Adds `guest_reports` table + RLS (admins read/update) + Storage bucket `guest-reports` with admin-read RLS.
- **API `POST /api/reports/guest`** — requires valid `fs_guest` cookie; project_id pinned to cookie (no smuggling); validates title (≤80) + body (≤4000); accepts optional image upload to `guest-reports/<project>/<report_id>/<uuid>.<ext>`; admin Supabase client bypasses RLS for the insert.
- **`components/mobile/report/report-form.tsx`** — guest-only client form: title + body + photo (camera/library, ≤5 MB, image preview + remove) + auto-location chip (user can toggle off). Stages: form → sending → sent (with "Send another" action) → error.
- **`app/p/[projectId]/m/report/page.tsx`** — server entry, gates via `assertSurfaceAllowed('report')` so admin/member → 404.

## Security notes

- Insert path is service-role only; RLS denies anon writes directly.
- project_id is taken from the HMAC cookie payload, not the form body — a guest in project A cannot post a report into project B.
- Photo bucket is private; only admins can list/read via storage RLS keyed off `guest_reports` membership.
- Photo size capped at 5 MB; mime gated to `image/*`.

## Deferred

- Admin-side review UI ("Reports" surface lists incoming `guest_reports`) — lands in S8.
- Email notification to admins on new report — `lib/notifications/admin-report.ts` per spec §6.5, follow-up.

## Verification

- **Tests:** 51 pass.
- **Typecheck:** clean.
- **Lint:** clean.
- **Migration applied:** confirmed via Supabase MCP `{"success":true}` on project `ykssihpinzbgmpylqtjl` (fieldSurvey_prod).
