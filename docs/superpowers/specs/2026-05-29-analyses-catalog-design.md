# FieldSurvey Analyses Catalog — Design Spec
**Status:** draft v1
**Author:** Goshtasb (with deep-research synthesis)
**Date:** 2026-05-29
**Supersedes:** the "do not add new Analyze-tab charts in M4–M6" hold (memory: project_fieldsurvey_analytics_future_brainstorm)

---

## 0. TL;DR
Build a curated, admin-curatable analytics catalog of **53 analyses across 10 sections**, fronted by:
1. a **cornerstone in-map "Question colorizer" (A0)** that lets any viewer repaint the map by any survey response column — auto-detecting continuous vs categorical vs Likert and styling accordingly;
2. an extended **right-rail Analyze tab** that renders cards from the currently active **Saved View** (admin-built, viewer-picked);
3. a **Catalog drawer** (admin-only) where admins toggle which cards belong to each Saved View;
4. a **central typed registry** (`lib/analyses/registry.ts`) as the single source of truth for every card's metadata, compute strategy, n_min, role-gate, trust signals, and viz component.

**Capability tier: D (full).** AAPOR rates + ACS/SVI overlays + PostGIS spatial-stats (Gi*/LISA/KDE) + multi-signal curbstoning composite + raking + small-area estimation primer.

**Phasing.** M7 ships the cornerstone (A0) + the default-10 pack + 14 highest-leverage opt-ins (~25 cards live). Remaining 28 register as visible "Coming" stubs in the Catalog with upvote-style signal so the roadmap is transparent. M8/M9 fill the rest.

---

## 1. Goals & non-goals

### Goals
- Any FieldSurvey project — from an academic lab to a public-health canvass — gets an honest, trust-chrome-decorated dashboard out of the box.
- A non-statistician admin can curate Saved Views by toggling pre-validated cards from a Catalog, not by configuring SQL or chart builders.
- The cornerstone interaction "show the survey responses on the map" works without any setup beyond importing data.
- Add survey-methodology rigor (AAPOR, MOE, n_min suppression, design-effect) so the product can be defended in front of an IRB or a city council.
- Surface spatial-statistics power-tools (Gi*, LISA, KDE) with the guard rails that academic spatial-epi expects (FDR, MAUP warnings, suppress n<5).
- Reuse existing infrastructure: cache layer (M6), saved-views (left rail), PostGIS parcels (M6), universe (M5), match-status (M1/F1/R1).

### Non-goals
- Ad-hoc chart builder. Not Tableau. Not Metabase. We ship a gallery of opinionated, validated cards.
- Mobile analytics. Mobile PWA stays field-collection only (per existing rule: response data + match status are desktop-only).
- LLM-assisted analytics ("GeoChatBot") — deferred per memory.
- Custom dashboarding / drag-and-drop layout. Saved Views define the card *set*; render order is registry-defined.
- Multi-project / cross-project rollups. M7 stays within a single project.

---

## 2. The cornerstone — A0 Question colorizer (NEW)

The single most-used interaction on the FieldSurvey map will be: "show me what people answered." A0 is built into the map shell, available to every viewer (not behind a Catalog toggle), and ON by default for every project.

### Behavior
- The map shell exposes a new top-of-rail dropdown: **"Color points by ▾"**.
- Default selection: **`Match status` (M1/F1/R1)** — preserves today's behavior.
- Choosing any other column from `survey_responses.raw_data` repaints every M1 + R1 point on the map according to that column's value. F1 points (field-only, no response) remain styled as today (yellow + scanline glyph) so the match-status semantics are never destroyed.

### Auto-type detection (`lib/colorize/auto-classify.ts`)
For each top-level key in `raw_data` we compute on import (and cache as `survey_imports.column_profiles jsonb`):

| Inferred type | Heuristic | Renderer |
|---|---|---|
| `categorical` | ≤12 distinct non-empty values, finite vocab | ColorBrewer CB-safe palette, one color per class, legend with counts |
| `likert` | 5 or 7 ordered values; labels match a Likert vocab table (Strongly agree…Strongly disagree, etc.) | Diverging red-white-blue ramp anchored at neutral; legend with arrows |
| `numeric_continuous` | parses as Number; ≥10 distinct values; skewness < 2 | Viridis (default) graduated ramp; min/max in legend; user-togglable classification method |
| `numeric_skewed` | parses as Number; skewness ≥ 2 | Viridis quintile classes; "skew detected — quintile" badge in legend |
| `date` | parses as ISO date; ≥10 distinct | Sequential viridis chronological ramp |
| `text_open` | average length > 50 chars or ≥40% unique | "Open text — choose a different column" notice (default off) |
| `boolean` | exactly 2 distinct values | 2-color CB-safe binary palette |
| `missing` | per-row null/empty | Gray "?" glyph; legend shows "% missing" chip |

### Classification options (user-togglable in the colorizer popover)
- **Quantile** (default for skewed numeric) — equal counts per class
- **Equal interval** — equal value range per class
- **Natural breaks (Jenks)** — minimizes within-class variance
- **Manual breaks** — user types breakpoints

Class count picker: 3 / 5 / 7 / 9 (default 5 — Tufte sweet spot).

### Color ramp picker
- Continuous default: **viridis**
- Diverging Likert default: **RdBu_r**
- Categorical: **ColorBrewer Set2** (≤8 classes) or **Set3** (≤12 classes)
- All ramps CB-safe; user can swap to **inferno** / **plasma** / **cividis** / **magma** via popover.

### Edge cases
- If the chosen column has fewer than `n_min = 10` non-null values, the colorizer refuses with a clear panel: "Need 10 responses for this column to colorize the map. You have N."
- If the column is `boolean` and one class is empty, fall back to a single solid color + count.
- If the column contains both numbers and strings (dirty data), it's classified as `categorical` with a warning chip.

### Where A0 lives in code
- Map shell: `components/map/maplibre-map.tsx` consumes a `colorize: ColorizeSpec | null` prop and runs a paint-property update on the points layer.
- New control: `components/map/colorizer-control.tsx` — popover with column picker + classification + ramp + class-count.
- New lib: `lib/colorize/auto-classify.ts` — pure functions for type inference, breakpoint generation, palette resolution.
- Server: `lib/queries/columns.ts` returns `{ key, inferred_type, n_non_null, distinct, skewness, sample_values, min, max }` per column for the active project, joined to import metadata.

### Saved with the view
The colorizer's last setting per (user, project) persists in `user_view_state.colorize_spec jsonb`. A Saved View can also pin a default colorize spec (admin: "for the Health-equity view, default to colorize-by `IAQ_concern_level`").

---

## 3. Surface architecture

### 3.1 Analyze tab (extended)
- Tab content scrolls a list of cards in fixed section order (§1 → §10).
- Cards rendered = the union of `default_pack` cards + cards in the active Saved View.
- Top-of-tab: view selector chip (echoes left rail) + `[+ Catalog]` button (admin-only; member sees a tooltip "Ask admin to add cards").
- Each card always renders trust chrome: `n=…` · `as of HH:MM` · `method ↗` link.
- Suppression: if a card's `n_min` is unmet, the card body is replaced by a clean placeholder: "Need N more responses for this analysis to be reliable. You have M." with a progress bar (`M / n_min`).

### 3.2 Saved Views (extends existing left-rail saved-views infra)
- Database: `project_saved_views` table (see §5).
- Row per saved view: name, role gate, ordered card list, is_default flag.
- Five admin-built starter views shipped with every new project:

| View | Role gate | Card set (M7 wave-1) | Why |
|---|---|---|---|
| **Default** | member | A0 + Match donut + A23 + A24 + A16+A17+A18 + A25 + A21 + A28 + A39 + A47 + A48 + A51 | The research-backed 10 + supporting chrome |
| **Coverage** | member | A0 + A19 + A20 + A21 + A22 + A13 + A51 + A16+A17+A18 + A39 | Action-oriented for project leads |
| **QC** | admin | A28 + A29 + A30 + A31 + A32 + A33 + A34 + A39 | Hidden from members |
| **Health-equity** | member | A0 + A40 + A41 + A42 + A15 + A8 + A11 + A13 + A39 | Civic / public-health users |
| **Velocity** | member | A23 + A24 + A25 + A26 + A27 + A21 + A39 | "How are we doing this week?" |

- "My picks": each viewer can additionally toggle individual cards on/off for their session; persists in `user_view_state.card_overrides jsonb`. Overrides never escape the user; admin's view definition is canonical.

### 3.3 Catalog drawer (new, admin-only)
- Slides in from the right edge over the Analyze tab. Sheet primitive (Radix) — we already have it.
- Header: search input + filter chips: `All • Default pack • M7 wave-1 • Coming soon • Admin-only`.
- Body: 10 collapsible sections (§1 Response, §2 Spatial, … §10 Actions). Each section pre-collapsed except the one that contains the most-recently-toggled card.
- Per-card row:
  - `[✓ / ✗]` toggle (persists to active view)
  - thumbnail (96×64 sample-data preview rendered server-side at build time or on-demand)
  - name (e.g., "A16 · AAPOR RR3 / COOP1 / REF1 / CON1 panel")
  - badges: `n_min: 30` · `admin-only` (when role-gated) · `Coming` (when stub) · `Wave-1` (when M7)
  - "Why this card" expandable: one paragraph + method link
- Footer: `Save to view: [view selector ▾]` — toggles persist to the chosen view.
- Stubs render as `disabled + Coming` rows with a small upvote chip; we record clicks to `catalog_card_votes(card_id, project_id, voter_id, voted_at)` to prioritize future waves.

---

## 4. Card registry pattern

A single TypeScript module is the contract:

```ts
// lib/analyses/registry.ts
import type { CardDescriptor } from "./types";

export const ANALYSES_REGISTRY: CardDescriptor[] = [
  {
    id: "A0_colorizer",
    section: "cornerstone",
    name: "Question colorizer",
    short: "Color the map by any survey response column.",
    requiredInputs: ["survey_responses.raw_data"],
    nMin: 10,
    roleGate: "member",
    mobileVisible: false,
    computeStrategy: "client",   // pure client-side from cached payload
    vizComponent: "MapColorizer",
    defaultPack: true,
    m7Wave1: true,
    stub: false,
    trustSignals: ["n_non_null", "pct_missing", "method_link", "classification_method"],
    pitfalls: ["Color ramps mislead non-CB-safe users", "Skewed numerics in equal-interval class breaks hide variation"],
    sourceInspiration: "Mapbox/Felt graduated symbol patterns",
    cardOrder: 0,
  },
  // ... 52 more entries
];
```

Field meanings:
- `section`: one of `"cornerstone" | "response" | "spatial" | "coverage" | "temporal" | "qc" | "quality" | "bias" | "compare" | "inference" | "actions"`.
- `requiredInputs`: schema dependencies. Catalog drawer disables cards whose inputs are missing (e.g., A40 requires `project_demographics_schema`).
- `nMin`: per-card sample-size suppression threshold (default 30).
- `roleGate`: `"admin" | "member" | "guest" | "surveyor"` — minimum required role.
- `mobileVisible`: always `false` for Analyze cards (mobile is field-only).
- `computeStrategy`: `"postgres" | "python_sidecar" | "client"`.
- `vizComponent`: string reference to a React component registered in a `vizRegistry` map (lazy-loaded).
- `defaultPack` / `m7Wave1` / `stub`: phasing flags.
- `trustSignals`: keys the card must render in its chrome.
- `pitfalls`: rendered in "Why this card" expandable.

The Catalog drawer, the Analyze tab, the spec doc, and the writing-plans output are all generated from this single registry. Adding a card later = adding a row.

---

## 5. Schema additions (migration 015)

```sql
-- supabase/migrations/015_analyses_catalog.sql

-- 5.1 Saved views — admin-curated card sets per project
create table if not exists public.project_saved_views (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null,
  role_gate    text not null default 'member'
               check (role_gate in ('admin','member','guest','surveyor')),
  cards        jsonb not null default '[]'::jsonb,   -- ordered array of card_id strings
  is_default   boolean not null default false,
  is_system    boolean not null default false,       -- shipped views, can be reset
  colorize_spec jsonb,                                -- optional A0 default
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index ux_views_project_name on public.project_saved_views(project_id, name);
create index idx_views_project on public.project_saved_views(project_id);

-- 5.2 Per-user overrides ("My picks") — session-scoped card on/off
create table if not exists public.user_view_state (
  user_id        uuid not null references public.profiles(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  active_view_id uuid references public.project_saved_views(id) on delete set null,
  card_overrides jsonb not null default '{}'::jsonb, -- { card_id: bool }
  colorize_spec  jsonb,
  updated_at     timestamptz not null default now(),
  primary key (user_id, project_id)
);

-- 5.3 AAPOR outcome mapping — admin maps project statuses to AAPOR outcome codes
create table if not exists public.project_aapor_mapping (
  project_id     uuid not null references public.projects(id) on delete cascade,
  status_id      uuid not null references public.project_statuses(id) on delete cascade,
  aapor_outcome  text not null check (aapor_outcome in ('I','P','R','NC','O','UH','UO')),
  primary key (project_id, status_id)
);
-- I=interview, P=partial, R=refusal, NC=non-contact, O=other, UH=unknown household, UO=unknown other

-- 5.4 Demographics schema declaration — what stratifier columns exist on responses
create table if not exists public.project_demographics_schema (
  project_id       uuid not null references public.projects(id) on delete cascade,
  raw_data_key     text not null,                    -- the key in survey_responses.raw_data
  stratifier_type  text not null check (stratifier_type in
                    ('age','race','sex','income','tenure','education','language','other')),
  value_mapping    jsonb,                            -- optional: maps response values to ACS categories
  acs_join_method  text not null default 'tract'
                   check (acs_join_method in ('tract','block_group','none')),
  primary key (project_id, raw_data_key)
);

-- 5.5 Column profiles — pre-computed type inference per column per import
alter table public.survey_imports
  add column if not exists column_profiles jsonb not null default '{}'::jsonb;

-- 5.6 ACS / SVI / PLACES baked-in lookups (Florida tract level for M7)
create table if not exists public.acs_tract_profile (
  tract_geoid    text primary key,
  year           int not null default 2023,
  total_pop      int,
  pct_white      numeric, pct_black numeric, pct_hispanic numeric, pct_asian numeric, pct_other numeric,
  pct_age_under18 numeric, pct_age_18_64 numeric, pct_age_65_plus numeric,
  median_hh_income numeric, pct_below_poverty numeric,
  pct_owner_occupied numeric, pct_renter numeric, pct_vacant numeric,
  pct_english_only numeric, pct_other_language numeric,
  moe_jsonb      jsonb                                -- ACS margin-of-error per field
);

create table if not exists public.cdc_svi_tract (
  tract_geoid   text primary key,
  year          int not null default 2022,
  rpl_theme1    numeric, rpl_theme2 numeric, rpl_theme3 numeric, rpl_theme4 numeric,
  rpl_themes    numeric,                             -- overall SVI percentile
  flag_count    int
);

create table if not exists public.cdc_places_tract (
  tract_geoid   text not null,
  year          int not null default 2022,
  indicator     text not null,                       -- e.g. 'CASTHMA','BPHIGH','CHD','OBESITY'
  value         numeric,
  ci_low        numeric,
  ci_high       numeric,
  primary key (tract_geoid, year, indicator)
);

-- 5.7 Catalog upvotes — record stub-card interest for prioritization
create table if not exists public.catalog_card_votes (
  card_id    text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  voter_id   uuid references public.profiles(id) on delete set null,
  voted_at   timestamptz not null default now(),
  primary key (card_id, project_id, voter_id)
);

-- 5.8 RLS: viewers read views, admin writes
alter table public.project_saved_views enable row level security;
alter table public.user_view_state enable row level security;
alter table public.project_aapor_mapping enable row level security;
alter table public.project_demographics_schema enable row level security;
alter table public.catalog_card_votes enable row level security;
-- (Policies follow existing per-project membership pattern; see migration 003.)
```

ACS / SVI / PLACES data are static loads. M7 ships Florida (state coverage); other states added via the same pipeline.

---

## 6. Compute infrastructure

| Strategy | Used for | Notes |
|---|---|---|
| **`postgres`** (Supabase RPC) | aggregations, AAPOR rates, coverage, velocity, freshness, F1 queue, off-boundary, accuracy-outlier, ZIP-vs-coord, geocode-confidence-vs-match | Plain SQL or `plpgsql` RPC; sub-100ms; cached via M6 |
| **`python_sidecar`** | Gi*, LISA, global Moran's I, KDE, change-point detection (ruptures), Monte Carlo forecast (numpy), raking (anesrake-style), MRP/small-area (statsmodels), curbstoning composite, topic modeling (BERTopic), Wilson interval bands | New FastAPI app at `/sidecar/` on Vercel Fluid Compute (Python 3.13). Stateless. Calls Supabase service-role for inputs. Response cached for 15 min via M6 cache. Async; cards show "computing…" skeleton if not yet cached. |
| **`client`** | A0 colorizer (paint-property update only), donut/bar/histogram render, n_min gating, trust chrome | Pure React; reads cached payload |

The Python sidecar is the **only new infra**. M7 wave-1 keeps sidecar use to a single high-leverage card initially (A21 Monte Carlo + A25 change-points + A11 KDE + A8 Gi*), so we validate the infra path before opening the floodgates.

---

## 7. The 53-card catalog

> Legend: ★ default pack · ◆ M7 wave-1 opt-in · ○ stub (Coming) · 🔒 admin-only

### §1 Response analytics
| ID | Card | Status | Required input | n_min | Compute | Viz | What it answers |
|---|---|---|---|---|---|---|---|
| A1 | Univariate distribution | ◆ | `raw_data[key]` (cat/Likert) | 30 | client | DivergingBar / Bar | Per question, % breakdown of each answer |
| A2 | Numeric summary | ◆ | `raw_data[key]` (numeric) | 30 | client | Histogram + Boxplot | Median / IQR / spread |
| A3 | Multi-select expansion | ◆ | `raw_data[key]` (multi) | 100 | client | UpSet | Option frequencies + co-occurrence |
| A4 | Cross-tab χ²/Fisher | ○ | 2× `raw_data` keys | 100 + 5/cell | postgres | Heatmap + Stat | Does Q1 differ by group G? |
| A5 | Response drift over time | ○ | timestamp + key | 100 | client | StackedArea / LineCI | Did answers shift over field period? |
| A6 | Open-text n-grams (+ topic model) | ○ | text key | 50 | sidecar | RankedBars + TopicGrid | Dominant words / themes |
| A7 | Weighted vs unweighted | ○ | demographics + ACS | 200 | sidecar | DeltaBars | Estimate change when matched to ACS |

### §2 Spatial analytics
| ID | Card | Status | Required input | n_min | Compute | Viz | What it answers |
|---|---|---|---|---|---|---|---|
| A8 | Getis-Ord Gi* hot/cold spots | ◆ | points or value + parcel/block agg | 30 units | sidecar | SignificanceChoropleth | Where are clusters of high (or low) values? |
| A9 | LISA cluster + outlier | ◆ | same as A8 | 30 units | sidecar | LisaMap + MoranScatter | HH / LL / HL / LH spatial categories |
| A10 | Global Moran's I tile | ○ | same as A8 | 30 units | sidecar | KpiTile | Overall clustered / dispersed / random? |
| A11 | KDE heatmap | ◆ | points | 200 | sidecar | RasterOverlay | Where is field activity densest? |
| A12 | Choropleth aggregation | ○ | points + parcel/BG/tract join | 100 | postgres | Choropleth | Rate map per geographic unit |
| A13 | Coverage-vs-universe heatmap | ◆ | universe + points | universe ≥ 50 | postgres | RateChoropleth | % universe touched per block |
| A14 | Dot-density overlay | ○ | points | 200 | client | DotDensity | Where without aggregation distortion |
| A15 | SVI cross-map | ○ | points + cdc_svi_tract | 30 tracts | postgres | BivariateChoropleth | Coverage × CDC SVI bivariate |

### §3 Coverage & completion (AAPOR)
| ID | Card | Status | Required input | n_min | Compute | Viz | What it answers |
|---|---|---|---|---|---|---|---|
| A16 | AAPOR RR1/RR3/RR5 | ★ | universe + AAPOR mapping | universe ≥ 50 | postgres | KpiTriple + Sparkline | Three rigorous response-rate definitions |
| A17 | COOP1 + REF1 | ★ | same | same | postgres | KpiPair | Cooperation + refusal rates |
| A18 | CON1 contact rate | ★ | same | same | postgres | Kpi + Choropleth | % universe households actually reached |
| A19 | Universe penetration map | ★ | universe + points | universe ≥ 50 | postgres | UniverseMap | Touched / not-touched / multi-touched |
| A20 | Under-sampled tracts | ◆ | universe + points + target | 5 tracts | postgres | RankedBullet | Largest gap target-vs-achieved |
| A21 | Predicted finish date | ★ | velocity ≥ 14 days + target | 14 days | sidecar | MonteCarloFan | 50/75/90% completion-date bands |
| A22 | Refusal & not-home pattern | ◆ | statuses | 100 | postgres | SmallMultiplesMap | Where refusals concentrate (3-panel) |

### §4 Temporal
| ID | Card | Status | Required input | n_min | Compute | Viz | What it answers |
|---|---|---|---|---|---|---|---|
| A23 | Hour-of-day (LOCAL tz) | ★ | timestamps + project tz | 30 | client | HistogramOverlay | When are doors knocked? (Fix UTC bug) |
| A24 | Day-of-week heatmap | ★ | timestamps | 7 days | client | DowHourHeatmap | Are weekends covered? |
| A25 | Velocity + change-points | ★ | 21 days of timestamps | 21 days | sidecar | LineCI + Breaks | Accelerating, stable, or falling? |
| A26 | Response decay | ○ | project_start + timestamps | 30 days | client | DecayCurve | Survival-style cumulative |
| A27 | Week-over-week trend | ○ | timestamps | 4 weeks | client | BarsCI | WoW with bootstrap CI |

### §5 Surveyor / team QC
| ID | Card | Status | Required input | n_min | Compute | Viz | What it answers |
|---|---|---|---|---|---|---|---|
| A28 | Productivity bullet | ★🔒 | points + shifts | 3 shifts | postgres | BulletPerSurveyor | Per-surveyor vs team median |
| A29 | GPS-accuracy outliers | ◆🔒 | points.accuracy_m | 30 | postgres | BoxByLane + MapDots | >50 m flagged |
| A30 | Time-per-stop ridgeline | ○🔒 | consecutive timestamps | 30 | sidecar | Ridgeline | Per-surveyor distribution |
| A31 | Curbstoning composite | ○🔒 | multi-signal | 50 per surveyor | sidecar | Radar6 + ReviewQueue | Multi-signal risk indicator |
| A32 | Photo-skip rate | ○🔒 | points + photo bool | 30 | postgres | BulletPerSurveyor | Skipping the photo step |
| A33 | Stops outside boundary | ◆🔒 | boundary + points | 1 | postgres | MapFlags + List | Off-boundary (30 m buffer) |

### §6 Data quality
| ID | Card | Status | Required input | n_min | Compute | Viz | What it answers |
|---|---|---|---|---|---|---|---|
| A34 | Missing-data heatmap | ○🔒 | raw_data matrix | 30 | client | QuestionSurveyorHeat | Holes by question & surveyor |
| A35 | Straight-lining detector | ○🔒 | matrix question grid | 30 | sidecar | FlagListWithIndex | Identical responses across items |
| A36 | Duplicate / near-duplicate | ○🔒 | raw_data fingerprint | 30 | sidecar | ClusterList | MinHash similarity |
| A37 | ZIP-vs-coord mismatch | ○ | address + GPS | 30 | postgres | MapFlags + List | Cross-check |
| A38 | Geocode confidence × match | ○ | geocoder_confidence | 100 | postgres | BinnedBars | Confidence buckets vs match-rate |
| A39 | Freshness chrome | ★ | cache last_updated | 0 | client | TopbarChip | "as of HH:MM" green/yellow/red |

### §7 Representativeness
| ID | Card | Status | Required input | n_min | Compute | Viz | What it answers |
|---|---|---|---|---|---|---|---|
| A40 | Sample-vs-ACS composition | ◆ | demographics + ACS | 100 | postgres | SxSStackBars | Sample mix vs ACS profile |
| A41 | Who's-missing analysis | ○ | demographics + ACS | 100 | postgres | RankedDeficitBars | Most under-rep subgroups |
| A42 | Coverage equity (Lorenz/Gini) | ○ | points per block + universe | 30 blocks | sidecar | LorenzCurve + Kpi | Distribution of canvas effort |
| A43 | Raking weights diagnostic | ○ | A7 weights | 200 | sidecar | WeightsHist + Cv | Weight extremity, DEFF |

### §8 Comparison / segmentation
| ID | Card | Status | Required input | n_min | Compute | Viz | What it answers |
|---|---|---|---|---|---|---|---|
| A44 | Small-multiples KPI grid | ○ | per-surveyor KPIs | 3/surveyor | client | TufteGrid | KPI mosaic per surveyor |
| A45 | Sparklines per block | ○ | time × block | 14 days | client | SparklineGrid | Velocity micro-pattern by sub-area |
| A46 | Auto-detected segment differences | ○ | segment + outcome | 100 | sidecar | RankedGaps + FdrPanel | Biggest FDR-corrected gaps |

### §9 Inference & uncertainty
| ID | Card | Status | Required input | n_min | Compute | Viz | What it answers |
|---|---|---|---|---|---|---|---|
| A47 | Margin-of-error chrome | ★ | any proportion | 30 | client | InlineBracket | ± on every proportion bar |
| A48 | Sample-size insufficient panel | ★ | any card | per-card | client | PlaceholderPanel | "N more responses needed" |
| A49 | DEFF-adjusted CI on map | ○ | cluster + values | 30 units | sidecar | HatchedChoropleth | Hatched where CI too wide |
| A50 | Small-area estimation (MRP) | ○ | demographics + outcome | 200 | sidecar | ModeledChoropleth | Borrows strength from neighbors |

### §10 Action-oriented
| ID | Card | Status | Required input | n_min | Compute | Viz | What it answers |
|---|---|---|---|---|---|---|---|
| A51 | Top-K blocks to revisit | ★ | A19 + A22 + last-visit | universe ≥ 50 | postgres | RankedListMap | Where should the team go tomorrow? |
| A52 | Follow-ups due (F1 queue) | ◆ | match status F1 | 1 | postgres | SortableMapList | Field points needing response |
| A53 | Anomalies needing review | ○🔒 | rolling baselines | 14 days | sidecar | AlertList + Severity | Today vs baseline anomalies |

**Counts.**
- **Catalog (A1–A53):** 53 entries.
- **Default Saved View — 10 catalog cards (★):** A16, A17, A18, A21, A23, A24, A25, A28, A39, A51 (plus the cornerstone A0 and the existing Match-status donut → 12 surfaces total in Default view; A28 is admin-only via role gate).
- **Universal chrome (not toggle-able):** A47 (MoE bracket on every proportion) + A48 (n_min suppression panel) apply to every card globally.
- **M7 wave-1 opt-in (◆):** 14 additional catalog cards — A1, A2, A3, A8, A9, A11, A13, A19, A20, A22, A29, A33, A40, A52.
- **Stubs (○):** 27 catalog cards rendered as "Coming" placeholders in the Catalog drawer.
- **M7 built surfaces total:** 10 default + 14 wave-1 + 2 chrome + A0 + Match donut = **28**.

---

## 8. Trust UX patterns

Every card MUST satisfy the **15-property trustworthiness checklist** (research-grounded):

1. shows `n` prominently
2. shows last-updated timestamp
3. links to method explainer
4. shows uncertainty (CI / MoE / fan)
5. suppresses small n with PlaceholderPanel
6. shows denominator for any rate
7. distinguishes structural vs item missingness
8. cites data source (universe / ACS year / SVI year)
9. marks modeled values with badge
10. is reproducible (registry-defined SQL/aggregation)
11. honors freshness; degrades when stale
12. CVD-safe color ramps
13. tooltip with exact number
14. "why this matters" expandable
15. logs a view event (Plausible / posthog)

CI handle for non-experts: prefer **frequency framing** ("19 of 20 simulations…"), **bracketed range labels**, and the Monte Carlo **fan chart**. Avoid error bars on KPIs.

### Anti-patterns enforced by the registry
- No word clouds for open text (A6 ships ranked bars instead)
- No raw counts in tracts with denominator <5 — auto-suppressed
- No 3-D pies, anywhere
- No means of Likert
- No auto-flagged-public curbstoning (always human-in-loop)
- No cross-tab without FDR correction (A46 uses Benjamini-Hochberg by default)
- No trend lines on <7 points

---

## 9. Curbstoning UX (A31) — sensitive

Per Murphy/Biemer/AAPOR Task Force / 2024 JSSAM literature: never single-signal, never auto-public.

- Visibility: **admin-only**. Member view doesn't render this card; admin-only "QC" Saved View carries it.
- Computation: composite of six signals (Z-score normalized vs team baseline):
  1. mean time-per-stop (faster than team)
  2. spatial DBSCAN clustering of stops (tighter clusters than team)
  3. straight-lining rate on matrix questions
  4. duplicate-fingerprint rate of text fields
  5. refusal-rate Z (deviates from team)
  6. photo-skip rate Z
- Display: 6-axis radar chart per flagged surveyor + ranked list with composite Z + per-signal breakdown.
- Required action: **Human review queue.** Clicking a flagged surveyor opens a panel with their points on a map + sample responses + "Mark reviewed / Open re-contact ticket" actions. No automated flags ever surface to non-admins; nothing is written to the surveyor's profile.
- Audit log: every view of the curbstoning card is logged (`curbstoning_audit(viewer, project, surveyor, viewed_at)`) to prevent silent surveillance.
- Trust chrome carries: signal counts, baseline window, "indicator — NOT determination" disclaimer.

---

## 10. Role gates + mobile rule

| Role | Sees Analyze tab? | Sees Catalog button? | Sees admin-only cards? |
|---|---|---|---|
| admin | yes | yes | yes |
| member | yes | no (tooltip "ask admin") | no |
| guest | yes (read-only) | no | no |
| surveyor | **no** (mobile-only role) | n/a | n/a |

Mobile PWA renders neither Analyze tab nor Catalog drawer — full stop, per existing rule (memory: project_fieldsurvey_mobile_scope).

---

## 11. Phasing roadmap

### M7 (this build)
- Schema migration 015
- Card registry (full 53 entries; stubs marked)
- Catalog drawer scaffold
- Saved Views extension (5 starter views, edit UI)
- Per-user override store
- A0 colorizer (client-only, map shell + control popover + auto-classify lib)
- Cornerstone always-on: A0 colorizer + existing Match-status donut.
- Default Saved View — 10 catalog cards: A16, A17, A18 (one AAPOR panel UI), A21 (Monte Carlo), A23 (LOCAL tz fix), A24 (DOW heatmap), A25 (velocity + change-points), A28 (admin role-gate), A39 (freshness promote), A51 (Top-K blocks).
- Universal trust chrome (applied to every card, not toggle-able): A47 MoE + A48 n_min suppression.
- Wave-1 opt-in cards (14, available in Catalog drawer): A1, A2, A3, A8, A9, A11, A13, A19, A20, A22, A29, A33, A40, A52.
- **Total M7 surfaces: 28.**
- Python sidecar bootstrapped with A21 / A25 / A11 / A8 only (validate infra)
- Catalog upvote endpoint for stubs

### M8 (next quarter)
- Sidecar coverage: A9 (LISA), A35–A36 (straight-line + dedup), A42 (Lorenz), A43 (raking), A30 (ridgeline), A31 (curbstoning — admin only)
- Schema: full demographics-schema UX, ACS join wizard
- A4, A5, A6, A10, A12, A14, A26, A27, A32, A34, A37, A38, A41

### M9 (later)
- A7 weighted, A15 SVI cross-map, A44–A46 segmentation, A49–A50 inference, A53 anomalies
- Cross-project rollup primitives (out-of-scope for now but informed by the registry)

---

## 12. Risks & open questions

| Risk | Mitigation |
|---|---|
| Python sidecar adds ops surface | Restrict to 4 cards in M7; document deploy + monitoring; rollback to pure-postgres baseline if sidecar 95p > 2s. |
| ACS / SVI static loads stale | Annual refresh pipeline; show year in card chrome; consider on-demand Census API + cache as M9 fallback. |
| Saved Views explosion | UI cap at 12 views per project; admin-only delete. |
| Curbstoning misuse | Hard role gate + audit log + disclaimer; off by default for new projects. |
| n_min suppression frustrates new projects | Replace with progress bar + ETA so users see "you're 40% of the way to enable this card." |
| 53 cards = too many to design test for | Snapshot-test each viz component; integration-test only the registry resolver + default-pack. |
| Vercel Fluid Compute Python cold start | Use Fluid keep-warm; pre-warm via cron `/sidecar/healthz` every 5 min. |
| GPS / privacy in the curbstoning radar | Surveyor opt-in disclosure at hire; data retention ≤ 90 days for raw GPS. |

### Open questions for user
1. Sidecar host: Vercel Fluid Compute Python or a separate Render/Fly box? (Default: Vercel.)
2. ACS year: latest 5-year (2019–2023)? (Default: yes.)
3. SVI year: 2022 (most recent published)? (Default: yes.)
4. PLACES indicators to pre-load: asthma, hypertension, heart disease, obesity, depression, mental-health-not-good, physical-health-not-good — or a custom list?
5. Should the "Coming" stubs accept anonymous upvotes from member-role viewers, or admin-only?

---

## 13. Out-of-scope (delegate to writing-plans)

- Per-card React component implementation (viz library choice: prefer custom SVG + Tailwind to stay consistent with the existing donut/bar pattern; no `recharts`/`d3` dependency)
- Sidecar deployment topology and CI integration
- Per-card SQL functions (each gets a small `supabase/rpc/<card_id>.sql` file)
- Static ACS / SVI / PLACES ingestion scripts
- E2E test coverage matrix

---

## 14. Acceptance criteria for the brainstorm

This spec is "approved" when:
- Catalog of 53 cards is locked (no additions in writing-plans without spec amendment).
- A0 colorizer behavior is unambiguous (auto-classify thresholds, ramps, edge cases).
- Saved Views model + role gates are clear.
- Schema migration 015 is a literal SQL block, ready to copy into a migration file.
- Phasing matches user expectation (M7 = 26 cards + scaffolding).
- Open questions in §12 are answered or accepted as defaults.

If all 6 hold, we transition to the **writing-plans** skill to author the M7 implementation plan.
