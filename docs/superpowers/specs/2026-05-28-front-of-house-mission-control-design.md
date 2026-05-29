# FieldSurvey Front-of-House — Mission Control

**Status:** Draft for user review
**Date:** 2026-05-28
**Owner:** Goshtasb Shahriari
**Scope:** Redesign of `/sign-in`, `/sign-up`, `/reset-password`, and `/home` (manage-surveys) only. The in-survey shell (`/p/[projectId]/...`) is **not** in scope — that ships under M4 once the user picks from `mockups/`.

---

## 1. Goal

Replace the current "shadcn card on empty background" sign-in/sign-up and the minimal `/home` project list with a single coherent front-of-house identity strong enough to (a) communicate "this is real research infrastructure" to PIs and reviewers on first load, and (b) give the user a useful project-overview surface — completion count, points added, last activity, live map preview per project — so they can triage projects without entering them.

## 2. Non-goals

- No change to the in-survey desktop shell (left rail / map / right rail) or to mobile field collection. Those are M4+.
- No change to auth backend, Supabase RLS, or `lib/queries/projects.ts` query shape. We add columns/views, we don't rip out.
- No marketing site. No `/` landing page redesign beyond what's already at `app/page.tsx` (which redirects).
- No new auth providers in this milestone. Magic-link + password stay; Google OAuth and SSO are **planned but stubbed** behind "Coming soon" copy so the visual slot exists.
- No dark/light theme toggle on front-of-house screens — sign-in and `/home` are dark-only by design (the working dashboard handles light/dark separately).

## 3. Research findings driving the design

(Full brief lives at `docs/superpowers/specs/2026-05-28-research-brief.md` if we want to commit it later. Summary:)

- **Geo-SaaS auth screens are visually quiet** (Felt, Mapbox, ArcGIS, Supabase, Linear, Vercel — all centered cards on neutral). FieldSurvey deliberately deviates: a live MapLibre globe behind sign-in becomes a brand differentiator, not a stunt, because looking at a map *is* the product.
- **Thumbnail is the live thing.** Vercel shows actual production deployment screenshot per project; Felt shows the actual map. FieldSurvey cards should show a real MapLibre snapshot of that project's bbox + current parcel pins.
- **Magic-link primary, password progressively disclosed** (Vercel pattern).
- **Per-card jump-into-mode buttons** (Survey123 pattern — Design / Collect / Analyze / Data on each card).
- **Status glyph beside project name everywhere** (Linear pattern).
- **List/grid toggle** covers density-first vs preview-first audiences (Felt + ArcGIS pattern).
- **A "drafts / in-setup" zone** for half-configured work (Felt + Kobo pattern).

## 4. Visual identity — Mission Control

Dark, lab-grade, cartographically literate. The map is the brand; the chrome stays out of its way.

### 4.1 Color tokens (apply to front-of-house only)

| Token | Value | Use |
|---|---|---|
| `--fh-bg` | `oklch(14% 0.025 240)` | Page background |
| `--fh-surface` | `oklch(20% 0.025 240 / 0.65)` | Glass card surface (over map) |
| `--fh-surface-solid` | `oklch(20% 0.025 240)` | Bento card surface on `/home` |
| `--fh-ink` | `oklch(96% 0.012 240)` | Primary text |
| `--fh-ink-2` | `oklch(72% 0.018 240)` | Secondary text |
| `--fh-ink-3` | `oklch(55% 0.020 240)` | Tertiary / disabled |
| `--fh-rule` | `oklch(35% 0.025 240 / 0.6)` | 1px hairlines |
| `--fh-accent` | `oklch(78% 0.16 200)` | Cyan — primary CTAs, donut accent |
| `--fh-accent-glow` | `oklch(78% 0.16 200 / 0.35)` | Soft glow on hover/focus |
| `--fh-m1` | `oklch(76% 0.16 158)` | M1 (matched) — green |
| `--fh-f1` | `oklch(82% 0.18 95)` | F1 (field only) — yellow (`#fde047`-family per memory) |
| `--fh-r1` | `oklch(68% 0.16 25)` | R1 (response only) — coral |

Existing in-survey palette is untouched. These tokens live as `[data-front-of-house]` overrides in `globals.css` so they don't bleed into `/p/[projectId]/...`.

### 4.2 Type

- Display: **Inter Display 700** for headings and project names
- Body: **Inter 400**
- Mono: **JetBrains Mono 500** for numerals (completion count, points, timestamps)

### 4.3 Radii & shadow

- Cards: `12px`
- Inputs / buttons: `8px`
- Status pins on the live globe: `9px` filled + `2px` outer ring + soft `0 0 8px var(--fh-accent-glow)`
- Card hover lift: `transform: translateY(-4px)` + `box-shadow: 0 24px 48px oklch(0% 0 0 / 0.4)`

### 4.4 Motion budget

- Globe auto-rotation: 30fps, 18 second full rotation, paused on `prefers-reduced-motion` (snapshot fallback). `requestIdleCallback` to start; cancelled on tab blur.
- Card hover: 180ms ease-out
- No carousel, no parallax scroll, no scroll-triggered video

---

## 5. Sign-in / sign-up screen

### 5.1 Layout

Full-bleed (100vw × 100vh). Three stacked layers, z-order back to front:

1. **MapLibre canvas** — full-bleed, `pointer-events: none`, slow rotation as above.
2. **Vignette gradient** — `radial-gradient(circle at center, transparent 40%, var(--fh-bg) 92%)` to give the card contrast at any rotation phase.
3. **Foreground column** — centered, max-width 420px. Contains wordmark, tagline, glass card, footer link.

### 5.2 MapLibre globe configuration

- Style: `dark-matter`-style (will be served from a self-hosted Protomaps tile bucket or MapLibre demotiles fallback for v1)
- Projection: globe (`"projection": "globe"`)
- Initial view: Florida (lat 28, lon -83, zoom 4.5)
- Auto-rotation: `map.setBearing` advance per frame, full 360° in 18s
- Overlay: **parcel-pin cluster animation** — 30 pre-baked synthetic points around Cedar Key (NOT real survey data, no RLS leak risk), each pulsing on a staggered 4-second cycle (`r 6→10px`, `opacity 0.4→1`). Colors cycle through `--fh-m1` / `--fh-f1` / `--fh-r1` so the auth screen literally previews the status semantics.
- Fallback: if WebGL unavailable, render a static high-res WebP screenshot of the same scene; identical vignette + glass card sit on top.

### 5.3 Foreground content

```
                  ◉ FieldSurvey
        Door-to-door surveys with cartographic precision.

  ┌────────────────────────────────────────┐
  │  Sign in                               │
  │                                        │
  │  Email                                 │
  │  ┌──────────────────────────────────┐  │
  │  │ you@university.edu               │  │
  │  └──────────────────────────────────┘  │
  │                                        │
  │  ┌────────────────────────────────┐    │
  │  │ → Send magic link              │    │  primary
  │  └────────────────────────────────┘    │
  │                                        │
  │  ─────────── or ───────────            │
  │                                        │
  │  ┌────────────────────────────────┐    │
  │  │  Continue with Google          │    │  stubbed
  │  └────────────────────────────────┘    │
  │                                        │
  │  Use a password instead  ·  SSO        │  disclosure links
  └────────────────────────────────────────┘

           New here? Create an account
```

- **Magic-link** is the primary CTA. Form posts to `magicLinkAction` (already exists in `app/(auth)/sign-in/actions.ts`). On success, swaps card content to a "Check your inbox" confirmation panel inline.
- **Password disclosure** (`Use a password instead`) expands a password field and a "Sign in" button below. Same `signInAction`, no route change.
- **"Continue with Google"** renders as a real button but onClick shows a toast: *"Google sign-in is rolling out next milestone."* — keeps the visual slot honest.
- **"SSO"** link is the same: visible, stubbed, signals to UF stakeholders that the slot exists.
- Footer: "Create an account" link (`/sign-up`) for sign-in; "Sign in" link (`/sign-in`) for sign-up.

### 5.4 Sign-up shell

Identical visual frame. Card content adds `name` field above email and changes title to "Create your account". After successful sign-up, redirects to existing `/sign-up/check-email` confirmation screen, restyled to match the dark glass aesthetic.

### 5.5 Reset-password shell

Same frame, single email field, "Send reset link" CTA.

### 5.6 Accessibility

- Keyboard navigation: glass card is the only focusable region; tab order Email → Send magic link → Continue with Google → Use a password → SSO → Create account
- Focus ring: 2px cyan, 2px offset
- `prefers-reduced-motion` swaps live globe for static snapshot (no rotation, no pulse)
- Contrast: glass card content meets WCAG AA against the darkest globe phase; verified via the vignette gradient floor
- The glass card is `role="main"` with the form labeled `aria-labelledby="sign-in-heading"`

---

## 6. Manage-surveys page (`/home`)

### 6.1 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  ◉ FieldSurvey      [⌘K search]    Grid/List    [+ New project]  👤 │  topbar
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Finish setting up  (2)                                              │  drafts row (conditional)
│  ┌──────────┐ ┌──────────┐                                           │
│  │ … card … │ │ … card … │                                           │
│  └──────────┘ └──────────┘                                           │
│                                                                      │
│  Owned by you  (5)                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                              │
│  │          │ │          │ │          │                              │
│  │   MAP    │ │   MAP    │ │   MAP    │                              │
│  │          │ │          │ │          │                              │
│  ├──────────┤ ├──────────┤ ├──────────┤                              │
│  │● Project │ │● Project │ │◐ Project │                              │
│  │ desc...  │ │ desc...  │ │ desc...  │                              │
│  │ 42 · 87  │ │ 11 · 24  │ │  0 ·  0  │                              │
│  │ 2h · JK  │ │ 3d · MS  │ │ never    │                              │
│  └──────────┘ └──────────┘ └──────────┘                              │
│                                                                      │
│  Shared with you  (2)                                                │
│  ...                                                                 │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.2 Topbar

- Wordmark (left, links to `/home`)
- Search input (⌘K to focus) — fuzzy-matches project name + description across owned + shared
- View toggle: **Grid** (default) / **List**
- "New project" primary button → `/home/new`
- Avatar dropdown (existing component) on the right

### 6.3 Grid card

Width: `clamp(280px, 28vw, 360px)`. Aspect ratio of the map region: 16:9. Total card height ~360px.

**Top region — fixed 16:9 map (≈158-202px tall depending on card width):**
- Background: server-rendered MapLibre snapshot (PNG/WebP) of the project's bbox, with current parcel pins painted on as colored dots (M1 green / F1 yellow / R1 coral, per memory `project_fieldsurvey_match_status`)
- Snapshot is cached in the `dashboard_cache` table (already planned in M4 per memory `project_fieldsurvey_keystone_backport_decisions`), regenerated nightly by a cron + on demand when `points` or `responses` change
- Hover: map snapshot zooms `scale(1.05)` over 220ms

**Bottom region — content (fills remaining height, ~150-180px):**
- **Line 1.** Status glyph (●  active · ◐ setup_incomplete · ○ archived) + project name in Inter Display 600 17px
- **Line 2.** Description, clamped to one line, `--fh-ink-2`
- **Line 3 — stats row** (mono digits, `--fh-ink`). Three metrics, explicitly defined to avoid ambiguity with M1/F1/R1 match semantics:
  - **`42` completed** — `count(survey_responses)` for this project where `status = 'Completed'` (one of the six default response statuses from memory `project_fieldsurvey_match_status`: Completed / No answer / Refused / Inaccessible / Vacant / Follow-up). This is the *survey-response* status, **not** the M1/F1/R1 match status — those two are independent dimensions.
  - **`87` points** — `count(survey_points)` for this project (every parcel a surveyor has added)
  - **`2h ago`** — `max(updated_at)` across `survey_points ∪ survey_responses ∪ projects` for this project
- **Line 4 — last actor.** "Jane Kowalski" + avatar (most recent editor of any point/response/project metadata)

**Hover overlay (the Survey123 pattern):**
- On hover the bottom-region content slides up 12px and four mode buttons fade in below it: **Map · Responses · Points · Members**
- Each is a small pill that navigates to `/p/{id}/map`, `/p/{id}/responses`, `/p/{id}/points`, `/p/{id}/members` respectively
- Clicking anywhere else on the card still goes to `/p/{id}` (default landing)

### 6.4 List card (toggle view)

Single row per project. Columns: status glyph · name · description (clamped) · completed · points · last activity · actor · row-action menu (Open, Archive, Delete). Same data, no map thumbnail — density-first.

### 6.5 Drafts row

Shows only when at least one project has `status = 'setup_incomplete'`. Heading: *"Finish setting up  (N)"* with smaller cards (no map thumb, just name + "Resume setup →" button → `/p/{id}/import` or wherever setup left off).

### 6.6 Empty state

When the user has zero projects:
- Large illustrated parcel-grid SVG (animated subtle shimmer)
- Heading: *"Your first survey starts with a parcel."*
- Sub: *"Upload an address list, draw a study area, or import a CSV of responses. We'll match them to parcels."*
- Primary CTA: "Create your first project" → `/home/new`
- Secondary link: "See how matching works" → docs (stubbed for v1)

### 6.7 Loading & error states

- Initial load: skeleton cards (map region = animated noise, content lines = grey bars)
- Map snapshot missing: solid gradient placeholder with status glyph centered, "Map preview rendering…" caption
- Error: red-tinted card with retry button, error logged to Sentry/Vercel logs (existing path)

### 6.8 Accessibility

- Each card is a single `<a>` with `aria-label` summarizing name + status + stats
- Mode buttons inside the hover overlay use `tabindex="-1"` until hover/focus, then become tabbable
- Status glyphs always have a visually-hidden text equivalent ("Active", "Setup incomplete", "Archived")

---

## 7. Data the manage page needs

### 7.1 New / changed queries

`lib/queries/projects.ts` currently returns `{ id, name, description, owner_id, center_lat, center_lon, default_zoom, visibility, archived, created_at, updated_at, project_members }`. We add to the query:

- `completed_count` — `count(survey_responses)` where `project_id = $1 AND status = 'Completed'` (response status, **not** M1/F1/R1 match status)
- `point_count` — count of `survey_points` where `project_id = $1`
- `last_activity_at` — `max(updated_at)` across `survey_points` ∪ `survey_responses` ∪ `projects` for the project
- `last_actor_id` + a join to `profiles` for the avatar
- `status` — derived: `'archived'` if `archived = true`, `'setup_incomplete'` if `point_count = 0 AND completed_count = 0 AND created < 7 days ago`, else `'active'`
- `map_snapshot_url` — pulled from `dashboard_cache.snapshot_url` for `kind = 'home_card'`, falls back to a placeholder if not yet rendered

Implementation: a single Postgres view `home_project_cards` joined into the existing select, plus a per-row left join to `dashboard_cache`. Detailed SQL lives in the implementation plan.

### 7.2 Map snapshot pipeline

- A new Supabase Edge Function (`render_home_snapshot`) renders a 1024×576 PNG via headless MapLibre (puppeteer or `@mapbox/mapbox-gl-native` — to be decided in implementation plan) of the project's bbox + current parcel pins
- Triggered by:
  - Nightly cron (existing `supabase/migrations/005_cache_and_versions.sql` cache infra)
  - Postgres trigger on `survey_points` and `survey_responses` insert/update, debounced 5 minutes
- Output uploaded to Supabase Storage (public bucket, signed URL caching), URL stored in `dashboard_cache`

If headless MapLibre proves heavy, fallback v1 = static tile snapshot from MapLibre's `/static` endpoint with pin overlay drawn server-side via `sharp` SVG composite — cheap and proven.

---

## 8. Component breakdown (where things live)

```
app/(auth)/
  layout.tsx                 ← becomes full-bleed, hosts the globe canvas
  sign-in/page.tsx           ← rewritten as glass card
  sign-up/page.tsx           ← rewritten as glass card
  reset-password/page.tsx    ← rewritten as glass card
  _components/
    globe-backdrop.tsx       ← MapLibre + pin animation, client-only
    auth-card.tsx            ← shared glass card frame
    auth-wordmark.tsx        ← brand mark + tagline

app/home/
  layout.tsx                 ← new dark front-of-house chrome (topbar + container)
  page.tsx                   ← rewritten for bento grid + list toggle
  _components/
    home-topbar.tsx
    project-grid-card.tsx    ← replaces components/project-card.tsx
    project-list-row.tsx
    drafts-row.tsx
    empty-state.tsx
    view-toggle.tsx

lib/queries/projects.ts      ← extended with new fields (see §7.1)

supabase/migrations/
  008_home_project_cards.sql ← view + dashboard_cache row kind 'home_card'

supabase/functions/
  render_home_snapshot/      ← edge fn for map PNG generation
```

Each component is small (< 200 LoC), client/server boundary explicit (`'use client'` only on `globe-backdrop`, the password disclosure, and the view toggle), keyboard-tested.

## 9. Performance budget

- **Sign-in screen** total transfer < 250KB gz (MapLibre core ~120KB, tile fetches lazy, fonts 30KB, app shell 50KB). FCP < 1.2s on a 4G connection.
- **Manage page** initial render: skeleton in < 200ms server-side, first card map snapshot painted in < 600ms (snapshot is a single `<img>` with `loading="eager"` for the first row, `loading="lazy"` for the rest)
- Tile cache: 1 day client-side `Cache-Control` on the globe basemap; snapshots cached forever with content hash in URL
- Bundle: MapLibre is dynamically imported on the auth route ONLY — the rest of the app doesn't pay for it

## 10. Rollout & flag

- New routes ship behind no feature flag — they replace the old screens directly (the old `/home` is trivial, no risk in displacing it)
- Old `components/project-card.tsx` is deleted (no other callers per grep — to be confirmed in plan)
- Database migration runs ahead of code deploy; the new view tolerates the existing schema if the new columns aren't yet populated

## 11. Open questions to confirm before implementation

1. **Tagline copy** — *"Door-to-door surveys with cartographic precision."* is a draft. Want a different angle?
2. **Globe initial view** — Florida-centered, zoom 4.5. Lock that, or pick a different home view?
3. **Snapshot engine v1** — accept the cheaper "static tile + sharp SVG composite" fallback for the first ship, with full headless MapLibre as a follow-up? My recommendation: **yes, start cheap.**
4. **Drafts row trigger** — current draft definition is `point_count = 0 AND created < 7 days ago`. Is that the right "still setting up" heuristic, or should we add an explicit `status` column to `projects` and let the user mark drafts manually?

## 12. Acceptance criteria

The redesign is done when:

- [ ] `/sign-in`, `/sign-up`, `/reset-password` render the glass-card-on-live-globe shell on Chrome, Safari, Firefox latest, and degrade to static-snapshot fallback on `prefers-reduced-motion` or no-WebGL
- [ ] Magic link, password (via disclosure), Google (stubbed), SSO (stubbed), and link to sign-up all behave correctly
- [ ] `/home` renders the bento grid with real map snapshots, real completion count, real point count, real last-activity timestamp for every project the user owns or is shared on
- [ ] Hover on a card reveals the four mode buttons (Map / Responses / Points / Members) and each navigates to the correct in-survey route
- [ ] Grid/List toggle works, persists in `localStorage`
- [ ] Drafts row appears only when at least one project matches the draft heuristic
- [ ] Empty state shows when the user has no projects
- [ ] Keyboard-only navigation works through sign-in, sign-up, and the entire `/home` grid
- [ ] Lighthouse: performance ≥ 85 on `/home` (mid-tier laptop), ≥ 90 on `/sign-in` (cold), accessibility = 100 on both

---

## 13. What ships in this milestone vs. follow-up

**Ships now (this design):**
Sign-in / sign-up / reset shell with live globe, `/home` bento grid + list toggle + drafts row + empty state + hover mode buttons, map-snapshot infra (cheap static-tile fallback).

**Follow-up milestone:**
Real Google OAuth, real University SSO, full headless-MapLibre snapshot engine, search ⌘K palette wired across all projects + recent activity, "Recents" view, archived-project view.
