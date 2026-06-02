# M7 Section 5 — Points + Survey tabs · screenshot index

| # | File | What it proves |
|---|------|----------------|
| 01 | `01-signin-after-s5.png` | Dev server compiles cleanly after S5 lands. |

## Verification

- **Tests:** 51 pass.
- **Typecheck:** clean.
- **Lint:** clean.

## Components shipped

- `components/mobile/points/points-list.tsx` — search + status-filter chip strip + scrollable list with status dot + address + relative time + collector name.
- `components/mobile/survey/survey-list.tsx` — search + matched/all toggle + matched/unmatched dot + respondent preview + relative time + admin "Edit ›" affordance.
- `app/p/[projectId]/m/points/page.tsx` — fetches `listProjectPoints` + batches collector profile lookups (single query, no N+1).
- `app/p/[projectId]/m/survey/page.tsx` — reads `survey_responses` and extracts {status, respondent, date} fields heuristically from raw_data.

## Role behavior

- Admin: both tabs available; survey rows show "Edit ›".
- Member: both tabs available; survey rows are read-only.
- Guest: `assertSurfaceAllowed` returns 404 for both tabs.
