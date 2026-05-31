# Spatial-Survey Analyses (Question-Driven) Design

> **Status:** Spec — pending user approval before implementation plan.
> **Companion to:** [2026-05-29-analyses-catalog-design.md](./2026-05-29-analyses-catalog-design.md).
> **Replaces in registry:** A0 stub (currently `stub: true`, `MapColorizer` never built).

## Why this spec exists

The existing M7 catalog (53 cards) covers the collection process — AAPOR rates, productivity, coverage, GPS QC, freshness. It does not answer the question every survey admin actually asks: **"pick a question, show me what people said, on the map."**

Of the 53 cards, only A0 (Question Colorizer) was specced to take a question as input — and it shipped as a stub. The other 52 cards are about *points*, not *answers*.

This spec adds the missing layer: **one cornerstone (A0) + 8 spatial analyses (S1–S8)** that each answer a question that has no non-spatial equivalent. Each card takes `(question_key, project_id)` and works for any questionnaire regardless of topic.

The card set is the canonical core of exploratory spatial data analysis (ESDA) as practiced in PySAL `esda`, ArcGIS Pro Spatial Statistics, GeoDa, and R `spdep`. Validated against the literature (Anselin 1995 LISA, Getis-Ord 1992, Kulldorff 1997 spatial scan, Lee 2001 bivariate Lee's L, FDR-corrected local statistics).

## Relationship to the existing catalog

This spec is **additive** to the 53-card M7 catalog. Concretely:

- **A0 Question Colorizer**: replaces the existing `A0_colorizer` stub entry (`stub: true`, `MapColorizer` never registered in viz-registry). Same card id, same registry slot, real implementation.
- **S2 Hot/Cold Spot (Gi\*) per question**: distinct from the existing `A8_gi_star` (which runs Gi\* on **point density**, not on a chosen question's answer). S2 takes `questionKey`; A8 does not. Both coexist; the catalog already has A8 in §2 Spatial.
- **S3 LISA per question**: distinct from the existing `A9_lisa` stub (which is also points-density). S3 takes `questionKey`. A9 stays in the catalog but is question-agnostic.
- **S6 Coverage × Response bivariate**: a generalization of `A15_svi_cross` (which is bivariate of coverage × SVI). S6 makes the second axis = answer composition for a chosen question, not SVI.
- **All other cards (S1, S4, S5, S7, S8)**: new card ids; no overlap with existing catalog entries.

## Non-goals

- Replacing the existing 53 cards. AAPOR rates, productivity, freshness all remain — this spec is **additive**.
- Geographically Weighted Regression (GWR). Deferred to v2: bandwidth cross-validation is O(n²)–O(n³), not a tile-friendly compute.
- Emerging Hot-Spot Analysis (spatio-temporal Gi*). Deferred: requires longitudinal panels; most surveys are one-shot.
- Segregation indices (dissimilarity / isolation). Deferred: vertical-leaning.
- Kriging surface. Deferred: interpolation, not inference; misleading for categorical answers.
- Open-text / NLP / topic models. Out of scope.

---

## §1 Architecture & data flow

### 1.1 The question pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│   Admin opens map → picks "Active question" in top selector     │
└────────────────────────────┬────────────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            │                                 │
            ▼                                 ▼
   ┌──────────────────┐              ┌──────────────────┐
   │  A0 Colorizer    │              │  S1–S8 cards     │
   │  (map points)    │              │  (Analyze panel) │
   └──────────────────┘              └──────────────────┘
            │                                 │
            ▼                                 ▼
   GET /api/projects/{p}/colorize/{q}    GET /api/projects/{p}/analyses/{cardId}?q={q}
            │                                 │
   ┌────────┴──────────┐         ┌────────────┴────────────┐
   │  type-inference   │         │  Postgres dispatcher    │
   │  + classification │         │  ── routes by card ──   │
   │  (client-side)    │         │  ──    .computeStrategy │
   └───────────────────┘         └────────────┬────────────┘
                                              │
                          ┌───────────────────┼──────────────┐
                          ▼                   ▼              ▼
                  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐
                  │ Postgres RPC │  │ Python sidecar │  │ SaTScan CLI  │
                  │ (A0, S6)     │  │ (S1,S2,S3,S5,  │  │  (S4)        │
                  │              │  │   S7,S8)       │  │              │
                  └──────────────┘  └────────────────┘  └──────────────┘
                          │                   │              │
                          ▼                   ▼              ▼
                  ┌─────────────────────────────────────────────────┐
                  │  dashboard_cache (envelope: { data, computedAt })│
                  └─────────────────────────────────────────────────┘
```

### 1.2 Global "Active question" selector

Top of Analyze tab. Persisted to `user_view_state.active_question_key`. Cards inherit unless they declare a per-card override (S5 needs a POI in addition; S8 needs Q1 and Q2; S6 needs an answer-option, not just a question).

### 1.3 Spatial weights — materialized once per project

PySAL's `esda` statistics (Moran's I, Geary's C, Gi*, Local Moran, Local Geary, Lee's L) all need a spatial weights matrix. Recomputing per request is wasteful. Materialize once per project to PostGIS, hash it into cache keys.

New table:

```sql
create table project_spatial_weights (
  project_id   uuid primary key references projects(id) on delete cascade,
  weights_type text not null check (weights_type in ('knn8','dband_500m','queen')),
  matrix       bytea not null,                  -- compressed sparse row, scipy-format
  matrix_hash  text  not null,                  -- sha256 over matrix bytes
  point_ids    uuid[] not null,                 -- ordered, matches matrix rows
  computed_at  timestamptz not null default now()
);
```

- **Default**: k-NN with k=8 (PySAL recommendation for irregular point samples).
- **Trigger**: re-materialize when point count changes by >5% or admin clicks "rebuild weights."
- **Storage**: scipy CSR serialized via `joblib.dump` → bytes → `pgcrypto`-decrypted bytea. Round-trip in <50 ms for n ≤ 50 000.

### 1.4 Cache key contract

Every spatial RPC and sidecar handler computes the cache key as:

```
sha256(
  card_id || project_id || question_key ||
  weights_matrix_hash || fdr_alpha || n_permutations ||
  filter_chip_json
)
```

This guarantees: re-coding a question, rebuilding weights, changing α, or applying a filter all invalidate the cache atomically. Restored views never show stale clusters.

### 1.5 Sidecar split

| Card | Compute strategy | Why |
|------|------------------|-----|
| A0 | Client + Postgres view | Type inference + Jenks/quantile pure JS; weights not needed. |
| S1 | Sidecar | PySAL `esda.Moran` + `Geary` with 999 permutations. |
| S2 | Sidecar | PySAL `esda.G_Local` + `esda.fdr`. |
| S3 | Sidecar | PySAL `esda.Moran_Local` with FDR. |
| S4 | Sidecar (shell out to SaTScan) | SaTScan binary; Bernoulli or Poisson model. |
| S5 | Sidecar | 999 permutation-POI envelope; cheap per permutation. |
| S6 | Postgres view | Pure SQL aggregation per block group. |
| S7 | Sidecar | PySAL `esda.Geary_Local` with FDR. |
| S8 | Sidecar | PySAL `esda.Moran_Local_BV` or Lee's L. |

### 1.6 Performance budget

- A0: < 200 ms (no network round-trip; client-only after data load).
- S1: < 500 ms (lightweight; 999 permutations on Moran's I + Geary's C ≈ 200 ms on 5k points).
- S2, S3, S7, S8: < 2 s (999 permutations × per-cell statistic; cached after first compute).
- S4: < 10 s (SaTScan CLI shell-out; cached aggressively).
- S5: < 1 s (cheap permutation distance-decay; 999 reps).
- S6: < 300 ms (pure SQL group-by).

Hard cap: `n_points > 50 000` → return a "compute on a 10 k sample" toggle. Hard ceiling > 50 k errors out.

### 1.7 Permutation modes

- **Interactive** (default): 999 permutations. Used in `dashboard_cache` reads.
- **Publish** (button-gated): 9 999 permutations. Marked in legend "(publish-grade, 9 999 reps)". Re-cached.

---

## §2 A0 — Question Colorizer (cornerstone)

### 2.1 Spatial question answered

> "Pick a survey question. Color every map point by that respondent's answer."

This is the foundation. Every other card (S1–S8) inherits its question from A0's selector unless overridden.

### 2.2 Inputs

- `survey_responses.raw_data` — JSONB, wide-format. Question key = JSONB key.
- `survey_responses.geocoded_lat / geocoded_lon` — never use raw response lat/lon (per [memory: matching algorithm](../../.claude/projects/.../project_fieldsurvey_matching_algorithm.md)).

### 2.3 Type inference

Already implemented in [`lib/colorize/auto-classify.ts`](../../lib/colorize/auto-classify.ts:48). Confirmed sufficient:

- `missing` — all null/empty.
- `boolean` — distinct == 2, normalizes to {true, false, yes, no, 0, 1, y, n}.
- `numeric_continuous` — all parseable numbers, distinct ≥ 10, |skewness| < 2.
- `numeric_skewed` — same as above but |skewness| ≥ 2 (default to log-transform or quantile).
- `date` — ISO-like format, distinct ≥ 10.
- `likert` — 3–7 distinct values matching one of 7 hardcoded vocabularies.
- `categorical` — 3–12 distinct discrete values.
- `text_open` — avg length > 50 OR distinct/n > 0.4. Renders as "open-text — pick a different question to colorize."

### 2.4 Classification methods

- `quantile` (default) — equal-count classes.
- `equal_interval` — equal-width bins.
- `natural_breaks` (Jenks Fisher-Jenks) — minimizes within-class variance.
- `manual` — admin types break values.

Default class count: 5 (Likert → matches the vocab length).

### 2.5 Color palettes

Already in [`lib/colorize/palettes.ts`](../../lib/colorize/palettes.ts).

- `numeric_continuous` → Viridis (perceptually uniform, default).
- `numeric_skewed` → Viridis on log-bins.
- `likert` → diverging palette anchored at the middle category (`agree`/`neutral`/`disagree`).
- `categorical` → Tableau 10 (default categorical, max 12 classes).
- `boolean` → 2-color (orange/blue, colorblind-safe).
- `missing` → grey (#9CA3AF).

### 2.6 Edge case: categorical > 7 levels collapse

Forces the admin to either pick a top-k (default top-7 by frequency, "Other" bucket for the rest) or admit the question is too high-cardinality. Surfaces a warning chip "12 categories — only top-7 colored, see legend."

### 2.7 MapLibre integration

A single `circle-color` Mapbox-style expression interpolated from the breakpoints + ramp. Wire into `components/map/maplibre-map.tsx`'s response-points layer.

```ts
// generated by lib/colorize/derive-feature-colors.ts
const colorExpr = [
  "case",
  ["==", ["get", questionKey], null], MISSING_COLOR,
  ["interpolate", ["linear"], ["to-number", ["get", questionKey]],
    break1, ramp[0], break2, ramp[1], break3, ramp[2], break4, ramp[3], ramp[4]],
];
```

### 2.8 Filter chip

Admin can type `Q1=X` (or pick from a dropdown). Filter is applied to the MapLibre layer AND propagated to all S1–S8 card queries as a SQL `WHERE raw_data->>'Q1' = 'X'` clause. Single source of truth: `user_view_state.filter_chip`.

### 2.9 Trust signals

- `n_non_null` — number of points actually colored.
- `pct_missing` — % blanked due to missing/null/text-open.
- `classification_method` — which method (quantile / equal-interval / Jenks).
- `class_count`.

### 2.10 N-min

`nMin = 10`. Below that, A0 renders an `AwaitingDataPanel` with reason `"no-data"`.

---

## §3 Spatial cards S1–S8

### S1 — Spatial Autocorrelation header

**Spatial question.** "Is this answer spatially clustered at all, or is it random?"

**Why first.** Methodological prerequisite. If both Moran's I and Geary's C return non-significant p-values, none of S2–S8 mean anything for this question; the spatial pattern is noise. The card explicitly says "spatial analysis not warranted — clusters below are likely artifacts."

**Method.** PySAL `esda.Moran` + `esda.Geary` with 999 permutation null. Both statistics shown, with their Z-scores and p-values. **Diagnostic.** If they disagree (Moran's I significant, Geary's C not, or vice versa), the legend flags "non-stationary field — global statistic may be misleading; consult local maps (S2, S3, S7)."

**Inputs.** `points` (geocoded), `weights matrix`, `question_key`.

**Viz component.** `SpatialAutocorrTile` — 2 KPI tiles (Moran's I, Geary's C) side-by-side with Z, p, and a colored verdict chip ("clustered" / "dispersed" / "random" / "non-stationary").

**N-min.** 30 (PySAL's permutation test floor).

**Trust signals.** `n_permutations`, `weights_type`, `p_value_method` ("two-sided permutation").

**Edge case.** Stationarity. Moran's I assumes a stationary field; on a city-vs-suburb mixed sample, it averages to ~0 and hides everything. The card always pairs the global statistic with a recommendation to view S2/S3/S7.

**Source.** PySAL `esda.Moran` / `esda.Geary` docs.

---

### S2 — Hot/Cold Spot map (Getis-Ord Gi*)

**Spatial question.** "Where are statistically significant pockets of high vs low values?"

**Method.** PySAL `esda.G_Local` (the local Gi* statistic, with `i` self-included). 999 permutations. **FDR cutoff via `esda.fdr`** — replaces raw α=0.05 to control the false discovery rate across `n` simultaneous tests. The legend shows the FDR cutoff, not per-cell adjusted p-values.

**Inputs.** `points`, `weights matrix`, `question_key`, `fdr_alpha` (default 0.05).

**Viz component.** `GiStarChoropleth` — points colored on a diverging scale (hot = red, cold = blue, NS = grey). Optional H3 grid mode for large n.

**N-min.** 30.

**Trust signals.** `n_units`, `weights_type`, `fdr_corrected: true`, `fdr_cutoff`, `n_significant_hot`, `n_significant_cold`.

**Edge case.** Without FDR, Gi* over-flags at the α·n rate (5% of zones if α=0.05). FDR wiring is non-negotiable.

**Source.** Getis-Ord 1992; PySAL `esda.G_Local`; `esda.fdr`.

---

### S3 — LISA cluster + outlier map

**Spatial question.** "Where do neighborhoods agree, and where is a single block an outlier from its neighbors?"

**Method.** PySAL `esda.Moran_Local` (Anselin's local Moran's I). HH, LL, HL, LH categorization with permutation-based p. FDR-corrected.

**Distinction from S2.** Gi* uses value at `i` in its own local mean → finds hot/cold *pockets*. Local Moran *excludes* `i` → additionally finds *outliers* (HL = high surrounded by low; LH = low surrounded by high). Surveys care about outliers — "one cold address in a hot zone" is a story.

**Inputs.** `points`, `weights matrix`, `question_key`, `fdr_alpha`.

**Viz component.** `LisaMap` — categorical palette: HH = dark red, LL = dark blue, HL = pink, LH = light blue, NS = grey.

**N-min.** 30.

**Trust signals.** `n_HH`, `n_LL`, `n_HL`, `n_LH`, `fdr_cutoff`.

**Edge case.** Legend says "cluster **cores**" not "clusters" — significant cells mark cores, not full extents. Misreading is the #1 LISA pitfall.

**Source.** Anselin 1995; PySAL `esda.Moran_Local`.

---

### S4 — Spatial Scan (Kulldorff)

**Spatial question.** "Where is the biggest geographic excess of a response, ignoring admin boundaries?"

**Method.** Kulldorff's spatial scan statistic. Two model variants:

- **Bernoulli** — for binary answers ("% chose option X" = 1/0). Cases = X, controls = non-X.
- **Poisson** — for "responses per universe unit" when a denominator exists. Expected counts derived from the universe.

Implementation: shell out from the Python sidecar to the official **SaTScan CLI** (license-permitted for research). Cap max window at 25–50% of population (SaTScan default — avoids inflating to half the study area on sparse data).

**Inputs.** `points`, `question_key`, `answer_option` (for Bernoulli), `universe` (for Poisson).

**Viz component.** `KulldorffClusterMap` — primary cluster outlined in red with `p`, `RR` (relative risk), `LLR` (log-likelihood ratio); secondary clusters outlined in orange.

**N-min.** 100 (Kulldorff needs enough cases to converge).

**Trust signals.** `model_used`, `max_window_pct`, `n_permutations`, `n_clusters`, `relative_risks`.

**Edge case.** "Window at 50%" is essential. Without it, the MLE circle inflates to half the study area on sparse data and the map looks like one giant red blob.

**Source.** Kulldorff 1997; SaTScan official binary.

---

### S5 — Distance-Decay vs POI

**Spatial question.** "Does the answer depend on distance from a chosen point of interest?"

**Method.** Admin drops a POI on the map (proposed site, hazard, facility). For each respondent, compute haversine distance to POI. Bin into **fixed log-spaced bins** (0.25, 0.5, 1, 2, 4 km) to avoid bucket-edge gaming. Plot mean answer ± SE per bin. **Overlay the observed curve with a 999-permutation envelope of POI locations** (sampled within the project boundary). Without that envelope, even random data looks like a trend.

**Inputs.** `points`, `question_key`, `poi_lon`, `poi_lat`, `boundary` (for permutation sampling).

**Viz component.** `DistanceDecayChart` + `DistanceBandedMap` (small).

**N-min.** 50.

**Trust signals.** `n_permutations`, `bin_edges_km`, `envelope_method`.

**Edge case.** Bucket edges. Fixed log-spaced bins documented in the chrome.

**Source.** Public-comment / NIMBY survey practice; standard distance-decay analysis from spatial epidemiology.

---

### S6 — Coverage × Response bivariate

**Spatial question.** "Where did we BOTH cover the universe AND get a representative answer composition?"

**Why universal.** The #1 survey failure mode: high coverage but biased composition. "We knocked 80% of doors but the people who answered were all the same kind." A non-spatial version of this question doesn't exist.

**Method.** Per **block group** (default; admin can switch to tract or H3):
- X axis: % universe touched (responses / universe addresses in zone). Tertiled.
- Y axis: % responders picking option X (for chosen question + answer). Tertiled.

3×3 bivariate palette → 9 categories from "low coverage + low share" (dark grey) to "high coverage + high share" (deep purple).

**Inputs.** `points`, `universe`, `parcels` or `block_groups`, `question_key`, `answer_option`.

**Viz component.** `BivariateChoropleth` (already in catalog as `A15_svi_cross` — generalize).

**N-min.** 10 respondents per zone. Zones below threshold are blanked and counted in a "n suppressed zones" chip.

**Trust signals.** `zone_unit`, `n_suppressed_zones`, `denominator_definition`.

**Edge case.** Zone size — too fine = many suppressed; too coarse = invisible patterns. Default block group is the empirical sweet spot for urban; admin overrides for rural.

**Source.** AAPOR survey nonresponse subcommittee; CDC PLACES bivariate methodology.

---

### S7 — Local Geary heterogeneity map

**Spatial question.** "Where does this respondent agree with their geographic neighbors, and where do they disagree?"

**Method.** PySAL `esda.Geary_Local` with 999 permutations + FDR. Local Geary `c_i` is a per-point sum of squared differences to neighbors — small `c_i` = positive autocorrelation (you and neighbors agree), large = negative (you differ from neighbors).

**Distinction from S2/S3.** Gi*/Local Moran are correlation-based (test against the *mean*). Local Geary is variance-based (test against *neighbor differences*). Surfaces local heterogeneity invisible to choropleths — "this block has individually-strong opinions but they don't cluster spatially."

**Inputs.** `points`, `weights matrix`, `question_key`, `fdr_alpha`. **Winsorize continuous answers** at the 2nd/98th percentile before computing (Local Geary is sensitive to outliers in the value).

**Viz component.** `LocalGearyMap` — diverging palette (purple = positive autocorrelation, green = negative, grey = NS).

**N-min.** 30.

**Trust signals.** `n_pos_autocorr`, `n_neg_autocorr`, `winsorize_pct`, `fdr_cutoff`.

**Edge case.** Outlier sensitivity. Winsorize unless admin opts out.

**Source.** Anselin 1995; PySAL `esda.Geary_Local`.

---

### S8 — Bivariate co-cluster map (Lee's L preferred)

**Spatial question.** "Do answers to Q1 and Q2 co-cluster spatially?"

**Why universal.** Surveys are inherently multi-question, and this is the only canonical method for two-question spatial co-patterning. No non-spatial method gives this — Pearson correlation tells you they're related; Lee's L tells you they're related *and* spatially co-located.

**Method.** Two options:

- **Lee's L** (preferred). Splits the global statistic into a Pearson-style covariance term and a spatial-smoothing term; reports both. Avoids conflating "Q1 and Q2 are correlated" with "Q1 and Q2 co-cluster spatially."
- **Bivariate Local Moran** (PySAL `Moran_Local_BV`) — fallback if Lee's L unavailable for the given weights.

Compute both Pearson r (over all points) AND Lee's L (spatially-weighted). Disagreement is informative: high r + low Lee's L = "correlated but not co-clustered."

**Inputs.** `points`, `weights matrix`, `question_key_x`, `question_key_y`, `fdr_alpha`.

**Viz component.** `BivariateClusterMap` — HH (both high), LL (both low), HL, LH on a 4-color palette + KPI tile showing global Lee's L and Pearson r.

**N-min.** 50.

**Trust signals.** `lee_L`, `pearson_r`, `disagreement_flag`, `n_significant`.

**Edge case.** The Pearson vs Lee's L disagreement is the whole point — surface it loudly in the trust chrome.

**Source.** Lee 2001; ArcGIS Pro Bivariate Spatial Association docs; PySAL `Moran_Local_BV`; R `spdep::moran_bv`.

---

## §4 Universal chrome (applied to every spatial card)

These are *not* standalone cards — they overlay on top of A0/S1–S8.

### 4.1 Sample-sufficiency overlay

Per zone (or per point, for A0), if `n < cardDescriptor.nMin`, the geometry is rendered with 30% opacity and a diagonal hatch. A legend item explains "n < min — visual only."

### 4.2 Small-cell suppression chrome

Per zone, if `n < K` (default K=5, configurable per project), the zone is blanked. Privacy guard. Counted in a "X zones suppressed" chip.

### 4.3 FDR cutoff display

For S2, S3, S7, S8, the legend shows the FDR cutoff α value, not per-cell adjusted p-values. Prevents the map from "looking noisy" — keeps the visual at the cutoff level.

### 4.4 Awaiting-data fallback

Already implemented in [`components/analyses/awaiting-data-panel.tsx`](../../components/analyses/awaiting-data-panel.tsx). Extend with new `reason` values:

- `"needs-weights"` — project_spatial_weights row missing; admin clicks "rebuild weights."
- `"needs-poi"` — S5 has no POI dropped yet.
- `"needs-second-question"` — S8 has only one question selected.
- `"non-stationary"` — S1 returned a non-significant result; S2/S3/S7 disabled by default.
- `"sample-too-large"` — n > 50 000; offer "compute on a 10 k sample" toggle.

---

## §5 Database changes

### Migration 020 — spatial weights cache

```sql
create table public.project_spatial_weights (
  project_id    uuid primary key references public.projects(id) on delete cascade,
  weights_type  text not null check (weights_type in ('knn8','dband_500m','queen')),
  matrix        bytea not null,
  matrix_hash   text  not null,
  point_ids     uuid[] not null,
  computed_at   timestamptz not null default now(),
  computed_by   uuid references public.profiles(id) on delete set null
);

create index idx_psw_hash on public.project_spatial_weights(matrix_hash);

alter table public.project_spatial_weights enable row level security;

create policy "weights_read_member"
  on public.project_spatial_weights for select to authenticated
  using (public.project_role(project_id) in ('owner','admin','member'));

create policy "weights_write_admin"
  on public.project_spatial_weights for all to authenticated
  using (public.project_role(project_id) in ('owner','admin'))
  with check (public.project_role(project_id) in ('owner','admin'));
```

### Migration 021 — active question + per-card overrides

```sql
alter table public.user_view_state
  add column if not exists active_question_key text,
  add column if not exists filter_chip jsonb default '{}'::jsonb,
  add column if not exists card_question_overrides jsonb default '{}'::jsonb;

comment on column public.user_view_state.card_question_overrides is
'Per-card question override. Shape: { card_id: question_key }. If absent, card inherits active_question_key.';
```

### Migration 022 — extend dashboard_cache CHECK for new cards

```sql
alter table public.dashboard_cache
  drop constraint if exists dashboard_cache_card_id_check;

alter table public.dashboard_cache
  add constraint dashboard_cache_card_id_check
  check (card_id in (
    'A0_colorizer','match_donut',
    'A16_rr','A17_coop_ref','A18_con','A19_universe_map','A20_undersampled',
    'A21_finish','A22_refusal_pattern','A23_hour_local','A24_dow','A25_velocity',
    'A28_productivity','A29_gps_outlier','A33_off_boundary',
    'A40_sample_vs_acs','A51_topk','A52_f1_queue',
    'A11_kde','A8_gi_star','A13_cov_heatmap',
    -- new spatial cards
    'S1_autocorr','S2_gi_star_q','S3_lisa_q','S4_satscan','S5_distance_decay',
    'S6_coverage_response','S7_local_geary','S8_bivariate'
  ));
```

### Migration 023 — RPCs for A0 + S6 (Postgres-side)

```sql
create function public.get_question_colorize_data(
  p_project_id uuid, p_question_key text, p_filter jsonb default '{}'
) returns jsonb
  security invoker stable
  language sql
as $$
  select jsonb_build_object(
    'points', jsonb_agg(jsonb_build_object(
      'id', r.id, 'lat', r.geocoded_lat, 'lon', r.geocoded_lon,
      'value', r.raw_data -> p_question_key
    )),
    'n_non_null', count(*) filter (where r.raw_data ? p_question_key
                                     and r.raw_data ->> p_question_key <> ''),
    'pct_missing', 1 - (count(*) filter (where r.raw_data ? p_question_key)::float
                        / nullif(count(*),0))
  )
  from public.survey_responses r
  where r.project_id = p_project_id
    and r.geocoded_lat is not null
    and r.geocoded_lon is not null
    and (p_filter = '{}'::jsonb or r.raw_data @> p_filter);
$$;

create function public.get_coverage_response_bivariate(
  p_project_id uuid, p_question_key text, p_answer_option text,
  p_zone_unit text default 'block_group',  -- 'block_group' | 'tract' | 'h3_8'
  p_min_n int default 10
) returns jsonb
  security invoker stable
  language plpgsql
as $$ ... $$;
-- Full body in implementation plan.
```

---

## §6 API contracts

### Dispatcher route

`GET /api/projects/{projectId}/analyses/{cardId}?q={questionKey}&q2={secondKey}&opt={answerOption}&poi_lon={x}&poi_lat={y}&zone={unit}&alpha={fdr_alpha}`

Returns envelope: `{ data: <CardResult>, computedAt: string }` (same shape as existing dispatcher).

### Per-card result shapes

```ts
// S1
type AutocorrResult = {
  moran: { I: number; z: number; p: number };
  geary: { C: number; z: number; p: number };
  verdict: "clustered" | "dispersed" | "random" | "non_stationary";
  nPermutations: number;
  weightsType: "knn8" | "dband_500m" | "queen";
};

// S2
type GiStarResult = {
  cells: Array<{ pointId: string; gi: number; zScore: number; sig: -1 | 0 | 1 }>;
  fdrCutoff: number;
  nSigHot: number;
  nSigCold: number;
};

// S3
type LisaResult = {
  cells: Array<{ pointId: string; quadrant: "HH"|"LL"|"HL"|"LH"|"NS"; p: number }>;
  fdrCutoff: number;
  counts: { HH: number; LL: number; HL: number; LH: number; NS: number };
};

// S4
type SatscanResult = {
  primary: { lat: number; lon: number; radius_m: number; rr: number; llr: number; p: number };
  secondary: Array<{ lat: number; lon: number; radius_m: number; rr: number; llr: number; p: number }>;
  model: "bernoulli" | "poisson";
  maxWindowPct: number;
};

// S5
type DistanceDecayResult = {
  observed: Array<{ binKm: number; mean: number; se: number; n: number }>;
  envelope: Array<{ binKm: number; pct025: number; pct975: number }>;
  binEdgesKm: number[];
  nPermutations: number;
};

// S6
type CoverageResponseResult = {
  zones: Array<{
    zoneId: string; geom: GeoJSON; xTertile: 1|2|3; yTertile: 1|2|3;
    pctTouched: number; pctPicked: number; n: number;
  }>;
  suppressedCount: number;
  zoneUnit: "block_group" | "tract" | "h3_8";
};

// S7
type LocalGearyResult = {
  cells: Array<{ pointId: string; c: number; sig: -1 | 0 | 1; p: number }>;
  fdrCutoff: number;
  winsorizePct: number;
  nPosAutocorr: number;
  nNegAutocorr: number;
};

// S8
type BivariateResult = {
  cells: Array<{ pointId: string; quadrant: "HH"|"LL"|"HL"|"LH"|"NS"; p: number }>;
  leeL: number;
  pearsonR: number;
  disagreementFlag: boolean;
  questionX: string;
  questionY: string;
};
```

---

## §7 Testing strategy

### 7.1 Fixture surveys

Pre-built CSV fixtures in `tests/fixtures/spatial/` covering known-pattern data so we can validate every spatial card against ground truth:

- `uniform-random.csv` — uniformly random answers in a square. S1 must return p > 0.05 ("random"). S2/S3/S7 must return ≈ 5% × FDR-cutoff significant cells (Type I rate).
- `bullseye-cluster.csv` — high values in a central disc, low elsewhere. S2 must return a hot spot at the center; S4 (Kulldorff Bernoulli) must return one primary cluster covering the disc.
- `gradient.csv` — value increases monotonically by longitude. S5 with POI on the western edge must show monotonic distance-decay.
- `bimodal.csv` — half points all 1, half all 0, randomly mixed. S1 must return clustered Moran's I ≈ 0 but high Geary's C → disagreement → "non-stationary" verdict.
- `chess-board.csv` — alternating 0/1 in a grid. S3 must return many HL/LH outliers.
- `bivariate-aligned.csv` — Q1 and Q2 co-vary spatially in the same direction. S8 Lee's L must be large positive.
- `bivariate-anti.csv` — Q1 high where Q2 low. S8 Lee's L must be large negative.

### 7.2 Reference-implementation regression tests

For each sidecar card (S1, S2, S3, S5, S7, S8), the Python implementation must match PySAL `esda` reference output to 6 decimal places on fixture data. Test via direct call into `esda` and `tests/sidecar/test_spatial_reference.py`.

### 7.3 Cache-key correctness tests

Re-coding a question must produce a different cache key. Rebuilding weights must produce a different cache key. Applying a filter must produce a different cache key. Tests: `tests/cache/test_spatial_cache_keys.test.ts`.

### 7.4 Awaiting-data state tests

Each card must render `AwaitingDataPanel` with the correct reason when:
- `n < cardDescriptor.nMin` (no-data)
- weights not built (needs-weights)
- S5 has no POI (needs-poi)
- S8 has only one question (needs-second-question)
- S1 verdict was non-stationary AND admin enabled "skip-when-non-stationary" mode (non-stationary)
- n > 50 000 with no sample-toggle (sample-too-large)

Tests: `tests/analyses/test_spatial_awaiting_data.test.tsx`.

### 7.5 E2E smoke tests (Playwright)

- Admin picks a question in A0 → map points re-color within 1 s.
- Admin opens Analyze tab → S1 header renders Moran's I + Geary's C tiles.
- Admin drops a POI for S5 → distance-decay chart renders with envelope band.
- Admin selects Q2 in S8 picker → bivariate map renders with Lee's L + Pearson r.

---

## §8 Performance budget

| Card | Target p95 latency | Cache TTL |
|------|--------------------|-----------|
| A0 | 200 ms (client-only after `survey_responses` load) | n/a |
| S1 | 500 ms | 15 min |
| S2 | 2 s (first compute), 50 ms (cached) | 15 min |
| S3 | 2 s | 15 min |
| S4 | 10 s (first compute), 50 ms (cached) | 1 h |
| S5 | 1 s | 15 min |
| S6 | 300 ms | 15 min |
| S7 | 2 s | 15 min |
| S8 | 2 s | 15 min |

**Hard cap.** All sidecar cards refuse `n > 50 000` and return `{ data: null, reason: "sample-too-large", offerSample: true }`. The Awaiting-data panel offers a "Compute on a 10 k stratified sample" button.

---

## §9 Deferred to v2

With rationale per the deep-research validation:

- **Geographically Weighted Regression (GWR).** Bandwidth cross-validation is O(n²)–O(n³); not a tile compute. If it ever ships, it's a background job, not a card.
- **Emerging Hot-Spot Analysis (spatio-temporal Gi*).** Needs longitudinal panels; most surveys are one-shot.
- **Segregation indices (dissimilarity / isolation).** Vertical-leaning; not universally applicable.
- **Kriging surface.** Interpolation, not inference; misleading for categorical answers.
- **Joint Count / Local Join Count.** Redundant with Bernoulli Kulldorff (S4) in v1.

---

## §10 Implementation milestone breakdown

Reserved for the implementation plan (next skill: `writing-plans`). Sketch:

- **M7.2 wave 1** (this spec) — A0 (real, not stub) + universal chrome + S6 (Postgres-only, no sidecar dependency). Ships first.
- **M7.2 wave 2** — Sidecar deploy + S1 + S2 + S3.
- **M7.2 wave 3** — S5, S7, S8.
- **M7.2 wave 4** — S4 (SaTScan wiring — slowest, depends on SaTScan CLI binary being deployed to Fluid Compute).

---

## §11 Open questions for the user (none blocking)

None — all design decisions locked. Spec ready for review.
