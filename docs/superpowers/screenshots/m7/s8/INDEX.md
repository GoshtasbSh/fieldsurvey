# M7 Section 8 — Admin surfaces · screenshot index

| # | File | What it proves |
|---|------|----------------|
| - | (no new screenshot) | All six pages exist + role-gated; visual proof in final consolidation. |

## What shipped

Six admin-only surfaces gated via `assertSurfaceAllowed`:

- **/m/more** — `components/mobile/more/more-grid.tsx`. 2×3 bento of admin tile-links.
- **/m/analysis** — `components/mobile/analysis/mini-dashboard.tsx`. 4 KPI cards (Total / Today / Match rate / Median accuracy) + 14-day daily-activity sparkline rendered as inline SVG.
- **/m/members** — Inline server-rendered roster pulled from `project_members` joined to `profiles`. Role pill (admin teal / member green). Invite + role swap deferred to follow-up.
- **/m/settings** — Read-only snapshot of project metadata (name, description, center coords, default zoom) + "Edit on desktop" link.
- **/m/import** — Empty-state explaining the CSV wizard needs desktop, with a deeplink.
- **/m/reports** — Lists `guest_reports` (S7 source) with status pill (new / reviewed / resolved), preview, location, photo indicator.

## Role behavior

- Admin: all six load.
- Member: all six 404 via `SURFACES_BY_ROLE`.
- Guest: all six 404 via `SURFACES_BY_ROLE`.

## Verification

- **Tests:** 51 pass.
- **Typecheck:** clean.
- **Lint:** clean.
