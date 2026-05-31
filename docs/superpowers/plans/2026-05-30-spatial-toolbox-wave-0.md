# Spatial Analysis Toolbox — Wave 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "Add spatial analysis" modal, ArcGIS-style toolbox-organized card library, schema-driven settings drawer, and analyses list — so admins can browse + add the 9 spatial analyses (A0 + S1–S8) with rich previews. All cards render `AwaitingDataPanel` until compute lands in Waves 1–4.

**Architecture:** Pure UI scaffolding over existing M7 catalog patterns. New JSONB column on `user_view_state` persists the user's added-analyses list. Schema-driven settings drawer renders 6 input types from `card.settingsSchema`. Preview images: 5 Wikimedia Commons (rehosted with attribution) + 4 hand-authored custom SVGs.

**Tech Stack:** Next.js 15.5 App Router, React 19, TypeScript strict, Tailwind, Radix UI (Dialog/Tabs/Select), react-hook-form, Supabase (Postgres 17 + RLS), Vitest + @testing-library/react, Playwright.

**Out of scope (deferred to later waves):**
- Drag-reorder (use chronological order; add `@dnd-kit/core` in Wave 1).
- ⌘K quick-add palette (Wave 1, with `cmdk`).
- Saved Views bundling default analyses (Wave 1).
- All actual compute backends (A0 colorize is Wave 1, S1–S3 are Wave 2, S5/S7/S8 are Wave 3, S4 is Wave 4).

**Companion spec:** [docs/superpowers/specs/2026-05-30-spatial-survey-analyses-design.md](../specs/2026-05-30-spatial-survey-analyses-design.md)

---

## File Structure

| File | Responsibility | New / Modify |
|------|----------------|--------------|
| `supabase/migrations/020_project_spatial_weights.sql` | Cache materialized spatial weights matrix per project | New |
| `supabase/migrations/021_user_view_state_added_analyses.sql` | Add `active_question_key`, `filter_chip`, `card_question_overrides`, `added_analyses` columns | New |
| `supabase/migrations/022_dashboard_cache_spatial_cards.sql` | Extend `dashboard_cache.card_id` CHECK constraint for `S1`–`S8` | New |
| `lib/analyses/types.ts` | Add `SpatialCardCatalogEntry`, `SettingSchema`, `ToolboxSlug`, `PreviewImage`, `AnalysisListItem` | Modify |
| `lib/analyses/toolboxes.ts` | Toolbox metadata (slug, label, icon, description, sort order) | New |
| `lib/analyses/registry.ts` | Append A0 (replaces stub) + S1–S8 + v2 placeholders | Modify |
| `lib/analyses/viz-registry.ts` | Register lazy components for A0 + S1–S8 (all wrap `AwaitingDataPanel` for Wave 0) | Modify |
| `components/analyses/cards/s1-s8-placeholders.tsx` | Wave-0 placeholder components (one export per spatial card; renders `AwaitingDataPanel`) | New |
| `components/analyses/cards/a0-colorizer-placeholder.tsx` | Wave-0 A0 placeholder (renders `AwaitingDataPanel` with `needs-data` reason) | New |
| `components/analyses/awaiting-data-panel.tsx` | Add new `reason` values | Modify |
| `components/analyses/add-analysis-modal.tsx` | Modal shell using Radix Dialog | New |
| `components/analyses/toolbox-left-rail.tsx` | Left rail with 5 v1 + 3 v2 (greyed) toolboxes | New |
| `components/analyses/analysis-card-preview.tsx` | Single card preview tile (image + content + Add button) | New |
| `components/analyses/settings-drawer.tsx` | Schema-driven drawer router | New |
| `components/analyses/inputs/question-picker.tsx` | Question picker input (inherits global / override) | New |
| `components/analyses/inputs/answer-picker.tsx` | Answer-value picker (cascades from question) | New |
| `components/analyses/inputs/poi-picker.tsx` | POI lat/lon input | New |
| `components/analyses/inputs/setting-slider.tsx` | Numeric slider for FDR α etc. | New |
| `components/analyses/inputs/setting-select.tsx` | Dropdown for fixed options | New |
| `components/analyses/inputs/setting-toggle.tsx` | Boolean toggle | New |
| `components/analyses/analyses-list.tsx` | Container list rendering added analyses + empty state | New |
| `components/analyses/analyses-list-item.tsx` | Single row (status badge, settings cog, remove) | New |
| `components/desktop/right-rail.tsx` | Replace Analyze tab body with new `AnalysesList` + `+ Add` button | Modify |
| `hooks/use-added-analyses.ts` | React hook fetching + mutating `added_analyses` | New |
| `app/api/projects/[projectId]/added-analyses/route.ts` | GET/POST/DELETE/PATCH for the added-analyses list | New |
| `app/api/projects/[projectId]/active-question/route.ts` | PATCH the active question on `user_view_state` | New |
| `scripts/build-analysis-previews.ts` | Download Wikimedia images at build time, write CREDITS.json | New |
| `assets/analyses-previews/S4_satscan.svg` | Custom Kulldorff scan preview | New |
| `assets/analyses-previews/S5_distance_decay.svg` | Custom distance-decay preview | New |
| `assets/analyses-previews/S7_local_geary.svg` | Custom Local Geary hex mosaic | New |
| `assets/analyses-previews/S8_bivariate.svg` | Custom Lee's L hex mosaic | New |
| `public/analyses-previews/CREDITS.json` | License + attribution registry | New (generated) |
| `tests/analyses/add-analysis-modal.test.tsx` | Vitest unit test | New |
| `tests/analyses/settings-drawer.test.tsx` | Vitest unit test | New |
| `tests/analyses/analyses-list.test.tsx` | Vitest unit test | New |
| `e2e/spatial-toolbox.spec.ts` | Playwright smoke test (open modal → add card → see in list → open settings) | New |

---

## Tasks

### Task 1: Migration 020 — project_spatial_weights table

Wave 0 doesn't use this table yet — but per spec §10 the schema goes in now so Wave 2 sidecar code can land without DDL churn.

**Files:**
- Create: `supabase/migrations/020_project_spatial_weights.sql`

- [ ] **Step 1: Author the migration**

```sql
-- 020_project_spatial_weights.sql
-- M7.2 Wave 0 — materialized k-NN / distance-band spatial weights cache.
-- Used by Waves 2–4 sidecar (PySAL esda). Schema lands now to avoid Wave-2 DDL churn.

set search_path = public, extensions;

create table if not exists public.project_spatial_weights (
  project_id   uuid primary key references public.projects(id) on delete cascade,
  weights_type text not null check (weights_type in ('knn8','dband_500m','queen')),
  matrix       bytea not null,
  matrix_hash  text  not null,
  point_ids    uuid[] not null,
  computed_at  timestamptz not null default now(),
  computed_by  uuid references public.profiles(id) on delete set null
);

create index if not exists idx_psw_hash
  on public.project_spatial_weights(matrix_hash);

alter table public.project_spatial_weights enable row level security;

create policy "weights_read_member"
  on public.project_spatial_weights for select to authenticated
  using (public.project_role(project_id) in ('owner','admin','member'));

create policy "weights_write_admin"
  on public.project_spatial_weights for all to authenticated
  using (public.project_role(project_id) in ('owner','admin'))
  with check (public.project_role(project_id) in ('owner','admin'));

comment on table public.project_spatial_weights is
  'Cached scipy.sparse CSR spatial-weights matrix for PySAL esda. Recomputed when point count drifts >5%.';
```

- [ ] **Step 2: Lint-check SQL**

Run: `grep -c "create policy" supabase/migrations/020_project_spatial_weights.sql`
Expected: `2`

- [ ] **Step 3: Commit (do NOT apply to prod yet — apply is a separate authorized step)**

```bash
git add supabase/migrations/020_project_spatial_weights.sql
git commit -m "feat(db): add project_spatial_weights cache table (M7.2 W0)"
```

---

### Task 2: Migration 021 — user_view_state additions

**Files:**
- Create: `supabase/migrations/021_user_view_state_added_analyses.sql`

- [ ] **Step 1: Author the migration**

```sql
-- 021_user_view_state_added_analyses.sql
-- M7.2 Wave 0 — persist the user's added spatial analyses, the global active
-- question, the filter chip, and per-card question overrides on user_view_state.

set search_path = public, extensions;

alter table public.user_view_state
  add column if not exists active_question_key      text,
  add column if not exists filter_chip              jsonb not null default '{}'::jsonb,
  add column if not exists card_question_overrides  jsonb not null default '{}'::jsonb,
  add column if not exists added_analyses           jsonb not null default '[]'::jsonb;

comment on column public.user_view_state.active_question_key is
  'Global active question for the Analyze tab. Spatial cards inherit unless overridden.';
comment on column public.user_view_state.filter_chip is
  'Active filter chip applied to A0 colorizer + all spatial cards. Shape: { questionKey, op, value }.';
comment on column public.user_view_state.card_question_overrides is
  'Per-card question override. Shape: { card_id: question_key }.';
comment on column public.user_view_state.added_analyses is
  'Ordered array of {cardId, settings} added to the Analyze tab. Wave-0 ordering is insert-order.';

-- Lightweight validation: added_analyses must be a JSONB array.
alter table public.user_view_state
  add constraint user_view_state_added_analyses_is_array
  check (jsonb_typeof(added_analyses) = 'array');
```

- [ ] **Step 2: Lint-check**

Run: `grep -c "add column if not exists" supabase/migrations/021_user_view_state_added_analyses.sql`
Expected: `4`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/021_user_view_state_added_analyses.sql
git commit -m "feat(db): user_view_state added_analyses + active_question (M7.2 W0)"
```

---

### Task 3: Migration 022 — dashboard_cache CHECK extension

**Files:**
- Create: `supabase/migrations/022_dashboard_cache_spatial_cards.sql`

- [ ] **Step 1: Author the migration**

```sql
-- 022_dashboard_cache_spatial_cards.sql
-- M7.2 Wave 0 — extend dashboard_cache.card_id CHECK to allow S1-S8 keys.
-- Wave-0 doesn't compute these, but the new cards' descriptors register the IDs
-- and the dispatcher's allow-list must include them before Wave 1.

set search_path = public, extensions;

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
    'S1_autocorr','S2_gi_star_q','S3_lisa_q','S4_satscan','S5_distance_decay',
    'S6_coverage_response','S7_local_geary','S8_bivariate'
  ));

-- Mirror the same update on the analysis_versions audit table.
alter table public.analysis_versions
  drop constraint if exists analysis_versions_card_id_check;

alter table public.analysis_versions
  add constraint analysis_versions_card_id_check
  check (card_id in (
    'A0_colorizer','match_donut',
    'A16_rr','A17_coop_ref','A18_con','A19_universe_map','A20_undersampled',
    'A21_finish','A22_refusal_pattern','A23_hour_local','A24_dow','A25_velocity',
    'A28_productivity','A29_gps_outlier','A33_off_boundary',
    'A40_sample_vs_acs','A51_topk','A52_f1_queue',
    'A11_kde','A8_gi_star','A13_cov_heatmap',
    'S1_autocorr','S2_gi_star_q','S3_lisa_q','S4_satscan','S5_distance_decay',
    'S6_coverage_response','S7_local_geary','S8_bivariate',
    'add_analysis','remove_analysis','reorder_analyses'
  ));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/022_dashboard_cache_spatial_cards.sql
git commit -m "feat(db): dashboard_cache CHECK accepts S1-S8 keys (M7.2 W0)"
```

---

### Task 4: Extend `lib/analyses/types.ts`

Add the toolbox + settings-schema types so every other task can import them.

**Files:**
- Modify: `lib/analyses/types.ts` (append; do not rewrite existing exports)
- Test: `tests/analyses/types-compile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/analyses/types-compile.test.ts
import { describe, it, expect } from "vitest";
import type {
  SpatialCardCatalogEntry,
  SettingSchema,
  ToolboxSlug,
  PreviewImage,
  AnalysisListItem,
} from "@/lib/analyses/types";

describe("types contract", () => {
  it("SpatialCardCatalogEntry shape compiles", () => {
    const entry: SpatialCardCatalogEntry = {
      id: "S2_gi_star_q",
      section: "spatial",
      name: "Hot/Cold Spot (Gi*)",
      short: "Where are statistically significant clusters?",
      requiredInputs: ["points", "raw_data_key_numeric"],
      nMin: 30,
      roleGate: "member",
      mobileVisible: false,
      computeStrategy: "python_sidecar",
      vizComponent: "GiStarPlaceholder",
      defaultPack: false,
      m7Wave1: false,
      stub: true,
      trustSignals: ["n_units", "fdr_cutoff"],
      pitfalls: ["Without FDR, Gi* over-flags."],
      sourceInspiration: "Getis-Ord 1992; PySAL esda",
      cardOrder: 200,
      toolbox: "mapping_clusters",
      previewImage: {
        src: "/analyses-previews/S2_gi_star_q.jpg",
        alt: "USA unemployment Gi*",
        sourceUrl: "https://commons.wikimedia.org",
        sourceTitle: "Wikimedia Commons",
        license: "CC-BY-4.0",
      },
      questionsAnswered: ["Where are the hot spots?"],
      whatItDoes: "Runs Getis-Ord Gi* with FDR-corrected significance.",
      inputRequirements: ["1 numeric question"],
      settingsSchema: [
        { key: "fdrAlpha", type: "slider", min: 0.01, max: 0.10, step: 0.01, defaultValue: 0.05, label: "FDR alpha" },
      ],
    };
    expect(entry.toolbox).toBe("mapping_clusters");
  });

  it("AnalysisListItem shape compiles", () => {
    const item: AnalysisListItem = {
      cardId: "S2_gi_star_q",
      settings: { fdrAlpha: 0.05 },
      addedAt: "2026-05-30T12:00:00Z",
    };
    expect(item.cardId).toBe("S2_gi_star_q");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyses/types-compile.test.ts`
Expected: FAIL with "has no exported member 'SpatialCardCatalogEntry'"

- [ ] **Step 3: Implement — append to `lib/analyses/types.ts`**

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Spatial Analysis Toolbox (Wave 0)
// ─────────────────────────────────────────────────────────────────────────────

export type ToolboxSlug =
  // v1
  | "symbology"
  | "analyzing_patterns"
  | "mapping_clusters"
  | "spatial_relationships"
  | "coverage_equity"
  // v2 placeholders
  | "space_time"
  | "spatial_regression"
  | "sampling_equity";

export type PreviewImage = {
  /** Absolute path under public/, e.g. "/analyses-previews/S2_gi_star_q.jpg". */
  src: string;
  /** Screen-reader description. */
  alt: string;
  /** Attribution link. */
  sourceUrl: string;
  /** Human-readable source name. */
  sourceTitle: string;
  /** SPDX-ish license string, e.g. "CC-BY-4.0", "Public Domain". */
  license: string;
};

export type SettingSchema =
  | { key: string; type: "question_picker"; label: string; defaultValue?: "inherit_global" | string }
  | { key: string; type: "answer_picker"; label: string; questionKeyRef: string; defaultValue?: string }
  | { key: string; type: "poi_picker"; label: string; defaultValue?: { lat: number; lon: number } | null }
  | { key: string; type: "slider"; label: string; min: number; max: number; step: number; defaultValue: number }
  | { key: string; type: "select"; label: string; options: Array<{ value: string | number; label: string }>; defaultValue: string | number }
  | { key: string; type: "toggle"; label: string; defaultValue: boolean };

export type SpatialCardCatalogEntry = CardDescriptor & {
  toolbox: ToolboxSlug;
  previewImage: PreviewImage;
  questionsAnswered: string[];
  whatItDoes: string;
  inputRequirements: string[];
  settingsSchema: SettingSchema[];
};

export type AnalysisListItem = {
  cardId: string;
  settings: Record<string, unknown>;
  addedAt: string; // ISO timestamp
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analyses/types-compile.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add lib/analyses/types.ts tests/analyses/types-compile.test.ts
git commit -m "feat(analyses): toolbox + settings-schema + list-item types (M7.2 W0)"
```

---

### Task 5: Toolbox metadata

**Files:**
- Create: `lib/analyses/toolboxes.ts`
- Test: `tests/analyses/toolboxes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/analyses/toolboxes.test.ts
import { describe, it, expect } from "vitest";
import { TOOLBOXES, v1Toolboxes, v2Toolboxes } from "@/lib/analyses/toolboxes";

describe("toolboxes", () => {
  it("ships 5 v1 toolboxes in spec order", () => {
    expect(v1Toolboxes().map(t => t.slug)).toEqual([
      "symbology", "analyzing_patterns", "mapping_clusters",
      "spatial_relationships", "coverage_equity",
    ]);
  });

  it("ships 3 v2 placeholder toolboxes", () => {
    expect(v2Toolboxes().map(t => t.slug)).toEqual([
      "space_time", "spatial_regression", "sampling_equity",
    ]);
  });

  it("every toolbox has an icon + non-empty description", () => {
    for (const t of TOOLBOXES) {
      expect(t.icon.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(10);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyses/toolboxes.test.ts`
Expected: FAIL with "Cannot find module '@/lib/analyses/toolboxes'"

- [ ] **Step 3: Implement `lib/analyses/toolboxes.ts`**

```ts
// FieldSurvey spatial-analysis toolbox metadata.
// Drives the left rail of the Add-Analysis modal (see components/analyses/toolbox-left-rail.tsx).

import type { ToolboxSlug } from "./types";

export type Toolbox = {
  slug: ToolboxSlug;
  label: string;
  icon: string;         // emoji or single-glyph; rendered in left rail
  description: string;  // shown under the cards-grid header when toolbox is selected
  isV2: boolean;
  sortOrder: number;
};

export const TOOLBOXES: Toolbox[] = [
  {
    slug: "symbology",
    label: "Symbology & Visualization",
    icon: "🎨",
    description: "Color your map points by any survey response.",
    isV2: false,
    sortOrder: 10,
  },
  {
    slug: "analyzing_patterns",
    label: "Analyzing Patterns",
    icon: "📊",
    description: "Global statistics — is the answer spatially clustered at all?",
    isV2: false,
    sortOrder: 20,
  },
  {
    slug: "mapping_clusters",
    label: "Mapping Clusters",
    icon: "🔥",
    description: "Local statistics — where are the clusters, outliers, and hot/cold spots?",
    isV2: false,
    sortOrder: 30,
  },
  {
    slug: "spatial_relationships",
    label: "Modeling Spatial Relationships",
    icon: "📐",
    description: "Distance, proximity, and multi-question spatial patterns.",
    isV2: false,
    sortOrder: 40,
  },
  {
    slug: "coverage_equity",
    label: "Survey Coverage & Equity",
    icon: "📋",
    description: "Did we BOTH cover the universe AND get representative answers?",
    isV2: false,
    sortOrder: 50,
  },
  {
    slug: "space_time",
    label: "Space-Time Pattern Mining",
    icon: "⏰",
    description: "Emerging hot spots and spatio-temporal change (v2 — coming soon).",
    isV2: true,
    sortOrder: 60,
  },
  {
    slug: "spatial_regression",
    label: "Spatial Regression",
    icon: "📈",
    description: "GWR and other spatial regression models (v2 — coming soon).",
    isV2: true,
    sortOrder: 70,
  },
  {
    slug: "sampling_equity",
    label: "Sampling Equity",
    icon: "⚖️",
    description: "Segregation and bias indices (v2 — coming soon).",
    isV2: true,
    sortOrder: 80,
  },
];

export function v1Toolboxes(): Toolbox[] {
  return TOOLBOXES.filter(t => !t.isV2).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function v2Toolboxes(): Toolbox[] {
  return TOOLBOXES.filter(t => t.isV2).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getToolbox(slug: ToolboxSlug): Toolbox | undefined {
  return TOOLBOXES.find(t => t.slug === slug);
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/analyses/toolboxes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/analyses/toolboxes.ts tests/analyses/toolboxes.test.ts
git commit -m "feat(analyses): toolbox metadata (5 v1 + 3 v2 placeholders) (M7.2 W0)"
```

---

### Task 6: Add A0 + S1–S4 catalog entries to `registry.ts`

The existing `A0_colorizer` entry has `stub: true` — we widen it to the new `SpatialCardCatalogEntry` shape and add S1, S2, S3, S4.

**Files:**
- Modify: `lib/analyses/registry.ts`
- Test: `tests/analyses/spatial-cards.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/analyses/spatial-cards.test.ts
import { describe, it, expect } from "vitest";
import { getCardById } from "@/lib/analyses/registry";
import type { SpatialCardCatalogEntry } from "@/lib/analyses/types";

const SPATIAL_IDS = [
  "A0_colorizer", "S1_autocorr", "S2_gi_star_q",
  "S3_lisa_q", "S4_satscan",
];

describe("spatial-cards wave 0 catalog (A0 + S1-S4)", () => {
  it.each(SPATIAL_IDS)("%s has spatial-catalog-entry fields", (id) => {
    const c = getCardById(id) as SpatialCardCatalogEntry | undefined;
    expect(c, `${id} missing`).toBeDefined();
    expect(c!.toolbox).toBeTruthy();
    expect(c!.previewImage.src).toMatch(/^\/analyses-previews\//);
    expect(c!.questionsAnswered.length).toBeGreaterThan(0);
    expect(c!.whatItDoes.length).toBeGreaterThan(20);
    expect(c!.inputRequirements.length).toBeGreaterThan(0);
    expect(c!.settingsSchema.length).toBeGreaterThan(0);
  });

  it("A0 toolbox is symbology", () => {
    const c = getCardById("A0_colorizer") as SpatialCardCatalogEntry;
    expect(c.toolbox).toBe("symbology");
  });

  it("S2 / S3 / S4 toolbox is mapping_clusters", () => {
    expect((getCardById("S2_gi_star_q") as SpatialCardCatalogEntry).toolbox).toBe("mapping_clusters");
    expect((getCardById("S3_lisa_q") as SpatialCardCatalogEntry).toolbox).toBe("mapping_clusters");
    expect((getCardById("S4_satscan") as SpatialCardCatalogEntry).toolbox).toBe("mapping_clusters");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyses/spatial-cards.test.ts`
Expected: FAIL — missing fields on existing A0 + missing S1–S4.

- [ ] **Step 3: Replace the existing `A0_colorizer` entry in `lib/analyses/registry.ts` and append S1-S4**

Edit the `A0_colorizer` block at `lib/analyses/registry.ts:17-38` to the form below, then append S1-S4 after `match_donut`:

```ts
// REPLACES the existing A0_colorizer entry.
{
  id: "A0_colorizer",
  section: "cornerstone",
  name: "Question Colorizer",
  short: "Pick a question — color every map point by the answer.",
  requiredInputs: ["responses", "raw_data_key_categorical"],
  nMin: 10,
  roleGate: "guest",
  mobileVisible: false,
  computeStrategy: "client",
  vizComponent: "A0ColorizerPlaceholder",   // Wave-0 placeholder; Wave-1 swaps to MapColorizer
  defaultPack: true,
  m7Wave1: false,    // built in Wave 1, not yet
  stub: true,        // still a placeholder in Wave 0
  trustSignals: ["n_non_null", "pct_missing", "classification_method"],
  pitfalls: [
    "Equal-interval breaks on skewed numerics hide variation — use quantile",
    "Categorical with >12 classes becomes a rainbow — collapse rare values first",
  ],
  sourceInspiration: "Mapbox + Felt graduated-symbol patterns",
  cardOrder: 0,
  toolbox: "symbology",
  previewImage: {
    src: "/analyses-previews/A0_colorizer.png",
    alt: "U.S. counties colored on a blue–red ramp by 2004–2016 presidential vote margin.",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:U.S._Presidential_election_margin,_2004-2016.png",
    sourceTitle: "Wikimedia Commons — Bplewe",
    license: "CC-BY-SA-4.0",
  },
  questionsAnswered: [
    "What did each respondent answer to a chosen question, mapped to their location?",
    "Are certain answers concentrated in specific areas?",
  ],
  whatItDoes:
    "Infers the question's data type (categorical, Likert, numeric, boolean, date) and " +
    "picks a sensible classification (quantile, equal-interval, or Jenks natural breaks) and " +
    "color ramp. Every map point is colored by its answer. Missing values render grey.",
  inputRequirements: [
    "1 question from the survey response schema",
    "≥10 geocoded responses",
  ],
  settingsSchema: [
    { key: "questionKey", type: "question_picker", label: "Question", defaultValue: "inherit_global" },
    { key: "classification", type: "select", label: "Classification",
      options: [
        { value: "quantile", label: "Quantile (default)" },
        { value: "equal_interval", label: "Equal interval" },
        { value: "natural_breaks", label: "Jenks natural breaks" },
      ],
      defaultValue: "quantile" },
    { key: "classCount", type: "select", label: "Class count",
      options: [
        { value: 3, label: "3" }, { value: 5, label: "5" },
        { value: 7, label: "7" }, { value: 9, label: "9" },
      ],
      defaultValue: 5 },
  ],
},
```

Then append (after the `match_donut` entry's closing brace and before "§1 Response analytics"):

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Spatial Analysis Toolbox (M7.2 — Wave 0 placeholders, real compute in Wave 1-4)
// ─────────────────────────────────────────────────────────────────────────────
{
  id: "S1_autocorr",
  section: "spatial",
  name: "Spatial Autocorrelation",
  short: "Is this answer spatially clustered at all? (Moran's I + Geary's C)",
  requiredInputs: ["points", "responses"],
  nMin: 30,
  roleGate: "member",
  mobileVisible: false,
  computeStrategy: "python_sidecar",
  vizComponent: "S1Placeholder",
  defaultPack: false,
  m7Wave1: false,
  stub: true,
  trustSignals: ["n_permutations", "weights_type", "p_value_method"],
  pitfalls: ["Moran's I assumes stationarity — non-stationary fields mislead it."],
  sourceInspiration: "PySAL esda — Moran / Geary",
  cardOrder: 100,
  toolbox: "analyzing_patterns",
  previewImage: {
    src: "/analyses-previews/S1_autocorr.png",
    alt: "Moran's I scatterplot of crime rates by neighborhood, Columbus, OH.",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Moran_ScatterPlot_Columbus_Crime.PNG",
    sourceTitle: "Wikimedia Commons — Lgalvis74",
    license: "Public Domain",
  },
  questionsAnswered: [
    "Is the answer to this question spatially clustered, dispersed, or random?",
    "Should I even look at local cluster maps for this question?",
  ],
  whatItDoes:
    "Computes Moran's I and Geary's C with a 999-permutation null distribution. " +
    "Both global statistics are shown — agreement signals a stationary spatial pattern; " +
    "disagreement flags non-stationarity. Renders a single KPI tile with a clustered / " +
    "dispersed / random / non-stationary verdict.",
  inputRequirements: [
    "1 question (numeric, Likert, or binary)",
    "Spatial weights matrix (auto-built on first use)",
  ],
  settingsSchema: [
    { key: "questionKey", type: "question_picker", label: "Question", defaultValue: "inherit_global" },
    { key: "weightsType", type: "select", label: "Spatial weights",
      options: [
        { value: "knn8", label: "k-Nearest Neighbors (k=8) — default" },
        { value: "dband_500m", label: "Distance band 500 m" },
        { value: "queen", label: "Queen contiguity (zones)" },
      ],
      defaultValue: "knn8" },
    { key: "nPermutations", type: "select", label: "Permutations",
      options: [
        { value: 999, label: "999 (interactive, default)" },
        { value: 9999, label: "9 999 (publish-grade, slower)" },
      ],
      defaultValue: 999 },
  ],
},
{
  id: "S2_gi_star_q",
  section: "spatial",
  name: "Hot/Cold Spot Analysis (Getis-Ord Gi*)",
  short: "Where are the statistically significant clusters of high or low values?",
  requiredInputs: ["points", "responses"],
  nMin: 30,
  roleGate: "member",
  mobileVisible: false,
  computeStrategy: "python_sidecar",
  vizComponent: "S2Placeholder",
  defaultPack: false,
  m7Wave1: false,
  stub: true,
  trustSignals: ["n_units", "weights_type", "fdr_corrected", "fdr_cutoff"],
  pitfalls: [
    "Without FDR correction Gi* over-flags at α·n rate — FDR is non-negotiable.",
    "MAUP — results change with aggregation level.",
  ],
  sourceInspiration: "Getis-Ord 1992; PySAL esda.G_Local; esda.fdr",
  cardOrder: 200,
  toolbox: "mapping_clusters",
  previewImage: {
    src: "/analyses-previews/S2_gi_star_q.jpg",
    alt: "Getis-Ord Gi* hot-spot / cold-spot map of estimated U.S. county unemployment, 2020.",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:USA_Contiguous_Unemployment_Rate_2020.jpg",
    sourceTitle: "Wikimedia Commons — GeogSage",
    license: "CC-BY-4.0",
  },
  questionsAnswered: [
    "Where are the statistically significant clusters of high values?",
    "Where are the statistically significant clusters of low values?",
    "Which spots are noise vs real?",
  ],
  whatItDoes:
    "Runs the Getis-Ord Gi* local statistic against your spatial weights matrix " +
    "with 999 permutations. Applies a False Discovery Rate (FDR) cutoff via PySAL's " +
    "esda.fdr so the map doesn't over-flag at the α·n rate. Each point is labeled " +
    "hot, cold, or insignificant.",
  inputRequirements: [
    "1 question (numeric, Likert, or binary)",
    "Spatial weights matrix (auto-built on first use)",
    "FDR alpha (default 0.05)",
  ],
  settingsSchema: [
    { key: "questionKey", type: "question_picker", label: "Question", defaultValue: "inherit_global" },
    { key: "fdrAlpha", type: "slider", label: "FDR alpha", min: 0.01, max: 0.10, step: 0.01, defaultValue: 0.05 },
    { key: "weightsType", type: "select", label: "Spatial weights",
      options: [
        { value: "knn8", label: "k-Nearest Neighbors (k=8) — default" },
        { value: "dband_500m", label: "Distance band 500 m" },
      ],
      defaultValue: "knn8" },
    { key: "nPermutations", type: "select", label: "Permutations",
      options: [
        { value: 999, label: "999 (interactive, default)" },
        { value: 9999, label: "9 999 (publish-grade, slower)" },
      ],
      defaultValue: 999 },
  ],
},
{
  id: "S3_lisa_q",
  section: "spatial",
  name: "Cluster & Outlier Analysis (LISA)",
  short: "Where do neighborhoods agree, and where is a single block an outlier?",
  requiredInputs: ["points", "responses"],
  nMin: 30,
  roleGate: "member",
  mobileVisible: false,
  computeStrategy: "python_sidecar",
  vizComponent: "S3Placeholder",
  defaultPack: false,
  m7Wave1: false,
  stub: true,
  trustSignals: ["n_HH", "n_LL", "n_HL", "n_LH", "fdr_cutoff"],
  pitfalls: [
    "Significant cells mark cluster CORES, not extents — legend must say 'cores'.",
    "FDR cutoff required to avoid over-flagging.",
  ],
  sourceInspiration: "Anselin 1995; PySAL esda.Moran_Local",
  cardOrder: 300,
  toolbox: "mapping_clusters",
  previewImage: {
    src: "/analyses-previews/S3_lisa_q.jpg",
    alt: "Anselin Local Moran cluster map of U.S. county poverty 2020, showing HH/LL/HL/LH categories.",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:USA_Contiguous_Poverty_2020_clusters.jpg",
    sourceTitle: "Wikimedia Commons — GeogSage",
    license: "CC-BY-SA-4.0",
  },
  questionsAnswered: [
    "Where do neighbors all give the same high answer (HH cluster)?",
    "Where do neighbors all give the same low answer (LL cluster)?",
    "Where is a single block an outlier — high in a low neighborhood, or vice versa?",
  ],
  whatItDoes:
    "Computes the Anselin Local Moran's I per point and categorizes each as HH (high-high cluster), " +
    "LL (low-low cluster), HL (high outlier surrounded by low), LH (low outlier surrounded by high), " +
    "or not significant. FDR-corrected via PySAL esda.fdr.",
  inputRequirements: [
    "1 question (numeric, Likert, or binary)",
    "Spatial weights matrix (auto-built on first use)",
    "FDR alpha (default 0.05)",
  ],
  settingsSchema: [
    { key: "questionKey", type: "question_picker", label: "Question", defaultValue: "inherit_global" },
    { key: "fdrAlpha", type: "slider", label: "FDR alpha", min: 0.01, max: 0.10, step: 0.01, defaultValue: 0.05 },
    { key: "weightsType", type: "select", label: "Spatial weights",
      options: [
        { value: "knn8", label: "k-Nearest Neighbors (k=8) — default" },
        { value: "dband_500m", label: "Distance band 500 m" },
      ],
      defaultValue: "knn8" },
    { key: "nPermutations", type: "select", label: "Permutations",
      options: [
        { value: 999, label: "999 (interactive, default)" },
        { value: 9999, label: "9 999 (publish-grade, slower)" },
      ],
      defaultValue: 999 },
  ],
},
{
  id: "S4_satscan",
  section: "spatial",
  name: "Spatial Scan Statistic (Kulldorff)",
  short: "Where is the biggest geographic excess of a response, ignoring admin boundaries?",
  requiredInputs: ["points", "responses"],
  nMin: 100,
  roleGate: "member",
  mobileVisible: false,
  computeStrategy: "python_sidecar",
  vizComponent: "S4Placeholder",
  defaultPack: false,
  m7Wave1: false,
  stub: true,
  trustSignals: ["model_used", "max_window_pct", "n_permutations", "n_clusters"],
  pitfalls: [
    "Without max-window cap, the MLE circle inflates to half the study area on sparse data.",
    "Bernoulli model needs a binary case/control; Poisson needs an exposure denominator.",
  ],
  sourceInspiration: "Kulldorff 1997 — A Spatial Scan Statistic; SaTScan CLI",
  cardOrder: 400,
  toolbox: "mapping_clusters",
  previewImage: {
    src: "/analyses-previews/S4_satscan.svg",
    alt: "Schematic showing two red circular scan windows over a light-grey polygon basemap, the primary thicker than the secondary.",
    sourceUrl: "https://www.satscan.org/papers/k-cstm1997.pdf",
    sourceTitle: "Custom illustration — based on Kulldorff 1997",
    license: "Custom-by-us",
  },
  questionsAnswered: [
    "Where is the most concentrated cluster of 'yes' (or 'high') answers — without pre-defining zones?",
    "Are there secondary clusters worth investigating?",
  ],
  whatItDoes:
    "Runs Kulldorff's spatial scan statistic via the SaTScan CLI. Bernoulli model for binary answers; " +
    "Poisson model when a universe denominator exists. Returns the primary cluster (circle on the map) " +
    "with its relative risk, log-likelihood ratio, and p-value, plus secondary clusters.",
  inputRequirements: [
    "1 question (binary, or numeric with an answer threshold)",
    "≥100 geocoded responses",
    "Optional: universe for the Poisson model",
  ],
  settingsSchema: [
    { key: "questionKey", type: "question_picker", label: "Question", defaultValue: "inherit_global" },
    { key: "answerOption", type: "answer_picker", label: "Answer option (for Bernoulli)", questionKeyRef: "questionKey" },
    { key: "model", type: "select", label: "Model",
      options: [
        { value: "bernoulli", label: "Bernoulli (binary case/control) — default" },
        { value: "poisson", label: "Poisson (needs universe denominator)" },
      ],
      defaultValue: "bernoulli" },
    { key: "maxWindowPct", type: "slider", label: "Max window (% of population)",
      min: 0.10, max: 0.50, step: 0.05, defaultValue: 0.25 },
  ],
},
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/analyses/spatial-cards.test.ts`
Expected: PASS (5+ tests)

- [ ] **Step 5: Commit**

```bash
git add lib/analyses/registry.ts tests/analyses/spatial-cards.test.ts
git commit -m "feat(analyses): A0 (real catalog entry) + S1-S4 spatial cards (M7.2 W0)"
```

---

### Task 7: Add S5–S8 + v2 placeholders

Continues the registry append begun in Task 6.

**Files:**
- Modify: `lib/analyses/registry.ts`
- Test: Extend `tests/analyses/spatial-cards.test.ts`

- [ ] **Step 1: Extend the test with S5–S8 IDs**

```ts
// Update the SPATIAL_IDS constant in tests/analyses/spatial-cards.test.ts:
const SPATIAL_IDS = [
  "A0_colorizer", "S1_autocorr", "S2_gi_star_q",
  "S3_lisa_q", "S4_satscan",
  "S5_distance_decay", "S6_coverage_response",
  "S7_local_geary", "S8_bivariate",
];

// Add toolbox assertion after the existing it.each(...):
describe("S5-S8 toolbox assignments", () => {
  it("S5 → spatial_relationships", () => {
    const c = getCardById("S5_distance_decay") as SpatialCardCatalogEntry;
    expect(c.toolbox).toBe("spatial_relationships");
  });
  it("S6 → coverage_equity", () => {
    const c = getCardById("S6_coverage_response") as SpatialCardCatalogEntry;
    expect(c.toolbox).toBe("coverage_equity");
  });
  it("S7 → mapping_clusters", () => {
    expect((getCardById("S7_local_geary") as SpatialCardCatalogEntry).toolbox).toBe("mapping_clusters");
  });
  it("S8 → spatial_relationships", () => {
    expect((getCardById("S8_bivariate") as SpatialCardCatalogEntry).toolbox).toBe("spatial_relationships");
  });
});
```

- [ ] **Step 2: Run test — expect failure on missing S5-S8**

Run: `npx vitest run tests/analyses/spatial-cards.test.ts`
Expected: FAIL with "S5_distance_decay missing", etc.

- [ ] **Step 3: Append S5–S8 + v2 placeholders to `lib/analyses/registry.ts`**

```ts
{
  id: "S5_distance_decay",
  section: "spatial",
  name: "Distance-Decay vs Point of Interest",
  short: "Does the answer depend on distance from a chosen point?",
  requiredInputs: ["points", "responses"],
  nMin: 50,
  roleGate: "member",
  mobileVisible: false,
  computeStrategy: "python_sidecar",
  vizComponent: "S5Placeholder",
  defaultPack: false,
  m7Wave1: false,
  stub: true,
  trustSignals: ["n_permutations", "bin_edges_km", "envelope_method"],
  pitfalls: [
    "Modifiable distance bins — results change with bucket edges. We use fixed log-spaced bins.",
    "Without a permutation-POI envelope, even random data looks like a trend.",
  ],
  sourceInspiration: "Standard distance-decay from spatial epidemiology",
  cardOrder: 500,
  toolbox: "spatial_relationships",
  previewImage: {
    src: "/analyses-previews/S5_distance_decay.svg",
    alt: "Schematic line chart showing a descending response curve with a translucent grey 95 percent envelope band and a star marker at distance zero.",
    sourceUrl: "",
    sourceTitle: "Custom illustration",
    license: "Custom-by-us",
  },
  questionsAnswered: [
    "Do responses change with distance from a feature (e.g. proposed site, hazard)?",
    "Is the apparent distance-decay real or could it occur by chance?",
  ],
  whatItDoes:
    "Admin drops a point of interest. Each respondent's distance to the POI is computed and " +
    "binned into fixed log-spaced bins (0.25, 0.5, 1, 2, 4 km). Mean answer ± SE is plotted per " +
    "bin. A 999-permutation envelope of random POIs (sampled within the project boundary) is " +
    "overlaid so admins can tell signal from noise.",
  inputRequirements: [
    "1 question (numeric or Likert)",
    "1 point of interest (drop on the map or type lat/lon)",
    "Project boundary (for the permutation envelope sampler)",
  ],
  settingsSchema: [
    { key: "questionKey", type: "question_picker", label: "Question", defaultValue: "inherit_global" },
    { key: "poi", type: "poi_picker", label: "Point of interest" },
    { key: "nPermutations", type: "select", label: "Permutations",
      options: [
        { value: 999, label: "999 (interactive, default)" },
        { value: 9999, label: "9 999 (publish-grade, slower)" },
      ],
      defaultValue: 999 },
  ],
},
{
  id: "S6_coverage_response",
  section: "spatial",
  name: "Coverage × Response Bivariate",
  short: "Did we BOTH cover the universe AND get representative answers?",
  requiredInputs: ["points", "responses", "universe", "parcels"],
  nMin: 10,
  roleGate: "member",
  mobileVisible: false,
  computeStrategy: "postgres",
  vizComponent: "S6Placeholder",
  defaultPack: false,
  m7Wave1: false,
  stub: true,
  trustSignals: ["zone_unit", "n_suppressed_zones", "denominator_definition"],
  pitfalls: [
    "Zone size — too fine = many suppressed; too coarse = invisible patterns.",
    "Zones with n<10 respondents are suppressed for stability.",
  ],
  sourceInspiration: "AAPOR nonresponse subcommittee; CDC PLACES bivariate methodology",
  cardOrder: 600,
  toolbox: "coverage_equity",
  previewImage: {
    src: "/analyses-previews/S6_coverage_response.png",
    alt: "Bivariate choropleth of U.S. counties showing the joint distribution of Black and Hispanic population share.",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Black_Hispanic_Bivariate_Map.png",
    sourceTitle: "Wikimedia Commons — Bplewe",
    license: "CC-BY-SA-4.0",
  },
  questionsAnswered: [
    "Where did we both knock enough doors AND get a representative share of a chosen answer?",
    "Where is high coverage masking biased composition?",
  ],
  whatItDoes:
    "Per block group (default; admin can switch to tract or H3), computes (% universe touched) " +
    "tertile × (% responders picking option X) tertile. Renders a 3×3 bivariate choropleth — " +
    "9 categories from low/low (dark grey) to high/high (deep purple). Zones with n<10 are " +
    "suppressed.",
  inputRequirements: [
    "1 question + 1 answer option",
    "Universe upload",
    "Parcels or census polygons",
  ],
  settingsSchema: [
    { key: "questionKey", type: "question_picker", label: "Question", defaultValue: "inherit_global" },
    { key: "answerOption", type: "answer_picker", label: "Answer option", questionKeyRef: "questionKey" },
    { key: "zoneUnit", type: "select", label: "Zone unit",
      options: [
        { value: "block_group", label: "Block group (default)" },
        { value: "tract", label: "Census tract" },
        { value: "h3_8", label: "H3 hex res 8" },
      ],
      defaultValue: "block_group" },
    { key: "minN", type: "slider", label: "Min n per zone (suppress below)",
      min: 5, max: 30, step: 1, defaultValue: 10 },
  ],
},
{
  id: "S7_local_geary",
  section: "spatial",
  name: "Local Geary Heterogeneity",
  short: "Does this respondent agree with their geographic neighbors?",
  requiredInputs: ["points", "responses"],
  nMin: 30,
  roleGate: "member",
  mobileVisible: false,
  computeStrategy: "python_sidecar",
  vizComponent: "S7Placeholder",
  defaultPack: false,
  m7Wave1: false,
  stub: true,
  trustSignals: ["n_pos_autocorr", "n_neg_autocorr", "winsorize_pct", "fdr_cutoff"],
  pitfalls: [
    "Local Geary is sensitive to outliers in the answer value — winsorize unless you opt out.",
  ],
  sourceInspiration: "Anselin 1995; PySAL esda.Geary_Local",
  cardOrder: 700,
  toolbox: "mapping_clusters",
  previewImage: {
    src: "/analyses-previews/S7_local_geary.svg",
    alt: "Schematic hex mosaic using a teal-to-magenta diverging palette, with cells where neighbors agree shown in teal and cells where they differ shown in magenta.",
    sourceUrl: "",
    sourceTitle: "Custom illustration",
    license: "Custom-by-us",
  },
  questionsAnswered: [
    "Which respondents have neighbors who agree with them (positive local autocorrelation)?",
    "Which respondents differ sharply from their neighbors (negative local autocorrelation / heterogeneity)?",
  ],
  whatItDoes:
    "Computes the Local Geary c_i statistic per point — small c_i means you agree with " +
    "neighbors (positive autocorrelation), large means you differ. Winsorizes continuous " +
    "answers at the 2nd / 98th percentile by default. FDR-corrected via PySAL esda.fdr.",
  inputRequirements: [
    "1 question (numeric or Likert)",
    "Spatial weights matrix (auto-built on first use)",
    "FDR alpha (default 0.05)",
  ],
  settingsSchema: [
    { key: "questionKey", type: "question_picker", label: "Question", defaultValue: "inherit_global" },
    { key: "fdrAlpha", type: "slider", label: "FDR alpha", min: 0.01, max: 0.10, step: 0.01, defaultValue: 0.05 },
    { key: "winsorize", type: "toggle", label: "Winsorize at 2nd/98th percentile", defaultValue: true },
    { key: "nPermutations", type: "select", label: "Permutations",
      options: [
        { value: 999, label: "999 (interactive, default)" },
        { value: 9999, label: "9 999 (publish-grade, slower)" },
      ],
      defaultValue: 999 },
  ],
},
{
  id: "S8_bivariate",
  section: "spatial",
  name: "Bivariate Spatial Association (Lee's L)",
  short: "Do answers to two questions co-cluster spatially?",
  requiredInputs: ["points", "responses"],
  nMin: 50,
  roleGate: "member",
  mobileVisible: false,
  computeStrategy: "python_sidecar",
  vizComponent: "S8Placeholder",
  defaultPack: false,
  m7Wave1: false,
  stub: true,
  trustSignals: ["lee_L", "pearson_r", "disagreement_flag", "n_significant"],
  pitfalls: [
    "Lee's L and Pearson r disagreement is the whole point — surface it loudly.",
  ],
  sourceInspiration: "Lee 2001; ArcGIS Pro Bivariate Spatial Association; PySAL Moran_Local_BV",
  cardOrder: 800,
  toolbox: "spatial_relationships",
  previewImage: {
    src: "/analyses-previews/S8_bivariate.svg",
    alt: "Schematic hex mosaic using a four-class palette (dark red HH, dark blue LL, pink HL, light blue LH) with a small two-variable inset.",
    sourceUrl: "",
    sourceTitle: "Custom illustration",
    license: "Custom-by-us",
  },
  questionsAnswered: [
    "Where are two questions co-clustered (both high together, or both low together)?",
    "Are the questions correlated but NOT spatially co-located?",
  ],
  whatItDoes:
    "Computes Lee's L (preferred) or Bivariate Local Moran for the chosen pair of questions. " +
    "Reports the global Lee's L AND the Pearson r — divergence between them is informative " +
    "(strong correlation but weak Lee's L means correlated but not spatially co-located).",
  inputRequirements: [
    "2 questions (numeric or Likert)",
    "Spatial weights matrix (auto-built on first use)",
  ],
  settingsSchema: [
    { key: "questionKeyX", type: "question_picker", label: "Question X" },
    { key: "questionKeyY", type: "question_picker", label: "Question Y" },
    { key: "fdrAlpha", type: "slider", label: "FDR alpha", min: 0.01, max: 0.10, step: 0.01, defaultValue: 0.05 },
    { key: "nPermutations", type: "select", label: "Permutations",
      options: [
        { value: 999, label: "999 (interactive, default)" },
        { value: 9999, label: "9 999 (publish-grade, slower)" },
      ],
      defaultValue: 999 },
  ],
},

// v2 placeholder entries — visible (greyed) in the modal so users see the roadmap.
{
  id: "V2_emerging_hot",
  section: "spatial",
  name: "Emerging Hot Spot Analysis (v2)",
  short: "Spatio-temporal Gi* — where are response patterns changing over time?",
  requiredInputs: ["points", "responses", "timestamps_n_days"],
  nMin: 100,
  roleGate: "member",
  mobileVisible: false,
  computeStrategy: "python_sidecar",
  vizComponent: "V2Placeholder",
  defaultPack: false,
  m7Wave1: false,
  stub: true,
  trustSignals: [],
  pitfalls: ["Requires longitudinal panels — most surveys are one-shot."],
  sourceInspiration: "ArcGIS Pro Emerging Hot Spot",
  cardOrder: 900,
  toolbox: "space_time",
  previewImage: {
    src: "/analyses-previews/V2_emerging_hot.svg",
    alt: "Placeholder — coming in v2.",
    sourceUrl: "",
    sourceTitle: "Coming soon",
    license: "Custom-by-us",
  },
  questionsAnswered: ["v2 — see roadmap."],
  whatItDoes: "Coming in v2. Requires a longitudinal time series of responses.",
  inputRequirements: [">3 months of response data"],
  settingsSchema: [],
},
{
  id: "V2_gwr",
  section: "spatial",
  name: "Geographically Weighted Regression (v2)",
  short: "Where does the relationship between two questions break down across space?",
  requiredInputs: ["points", "responses"],
  nMin: 200,
  roleGate: "member",
  mobileVisible: false,
  computeStrategy: "python_sidecar",
  vizComponent: "V2Placeholder",
  defaultPack: false,
  m7Wave1: false,
  stub: true,
  trustSignals: [],
  pitfalls: ["Bandwidth cross-validation is O(n^2)–O(n^3); not a tile compute."],
  sourceInspiration: "Brunsdon/Fotheringham GWR; PySAL mgwr",
  cardOrder: 910,
  toolbox: "spatial_regression",
  previewImage: {
    src: "/analyses-previews/V2_gwr.svg",
    alt: "Placeholder — coming in v2.",
    sourceUrl: "",
    sourceTitle: "Coming soon",
    license: "Custom-by-us",
  },
  questionsAnswered: ["v2 — see roadmap."],
  whatItDoes: "Coming in v2.",
  inputRequirements: [],
  settingsSchema: [],
},
{
  id: "V2_segregation",
  section: "spatial",
  name: "Segregation Indices (v2)",
  short: "Dissimilarity / isolation by response group.",
  requiredInputs: ["points", "responses"],
  nMin: 200,
  roleGate: "member",
  mobileVisible: false,
  computeStrategy: "python_sidecar",
  vizComponent: "V2Placeholder",
  defaultPack: false,
  m7Wave1: false,
  stub: true,
  trustSignals: [],
  pitfalls: ["Vertical-leaning — not universally applicable."],
  sourceInspiration: "Massey-Denton 1988",
  cardOrder: 920,
  toolbox: "sampling_equity",
  previewImage: {
    src: "/analyses-previews/V2_segregation.svg",
    alt: "Placeholder — coming in v2.",
    sourceUrl: "",
    sourceTitle: "Coming soon",
    license: "Custom-by-us",
  },
  questionsAnswered: ["v2 — see roadmap."],
  whatItDoes: "Coming in v2.",
  inputRequirements: [],
  settingsSchema: [],
},
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/analyses/spatial-cards.test.ts`
Expected: PASS (all S1–S8 + toolbox assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/analyses/registry.ts tests/analyses/spatial-cards.test.ts
git commit -m "feat(analyses): S5-S8 + v2 placeholder catalog entries (M7.2 W0)"
```

---

### Task 8: Wave-0 placeholder viz components

Every catalog entry's `vizComponent` must exist in `viz-registry.ts` or the registry-card resolver crashes. Wave 0 ships placeholders that render `AwaitingDataPanel`.

**Files:**
- Create: `components/analyses/cards/wave0-placeholders.tsx`
- Modify: `lib/analyses/viz-registry.ts`
- Modify: `components/analyses/awaiting-data-panel.tsx`
- Test: `tests/analyses/wave0-placeholders.test.tsx`

- [ ] **Step 1: Extend `awaiting-data-panel.tsx` with new reasons**

Edit `components/analyses/awaiting-data-panel.tsx`:

```tsx
type Props = {
  cardName: string;
  cardId?: string;
  reason?:
    | "no-data" | "needs-universe" | "needs-aapor-mapping"
    | "needs-demographics" | "needs-boundary" | "sidecar-pending"
    // NEW (Wave 0):
    | "needs-weights" | "needs-poi" | "needs-second-question"
    | "non-stationary" | "sample-too-large" | "wave-pending";
};

const REASON_HINT: Record<NonNullable<Props["reason"]>, string> = {
  "no-data": "No data collected for this card yet. Cards stay hidden until n ≥ minimum.",
  "needs-universe": "Upload a universe CSV (left rail → Universe) to enable coverage analysis.",
  "needs-aapor-mapping": "Map each project status to an AAPOR outcome (Settings → AAPOR mapping).",
  "needs-demographics": "Declare demographic stratifier columns to enable representativeness.",
  "needs-boundary": "Draw a project boundary (left rail → Boundary) to enable spatial filters.",
  "sidecar-pending": "Python sidecar not deployed yet — see runbook.",
  // NEW:
  "needs-weights": "Spatial weights matrix not built yet — admin can click 'Rebuild weights' in Settings.",
  "needs-poi": "Drop a point of interest on the map to enable this analysis.",
  "needs-second-question": "Pick a second question in Settings to enable the bivariate analysis.",
  "non-stationary": "Global autocorrelation came back non-significant — local cluster maps may be unreliable.",
  "sample-too-large": "More than 50 000 points. Toggle 'Compute on a 10 k sample' in Settings.",
  "wave-pending":
    "Compute backend ships in a later wave of the M7.2 spatial-analysis rollout — preview only.",
};
```

- [ ] **Step 2: Author placeholders in one file**

```tsx
// components/analyses/cards/wave0-placeholders.tsx
"use client";
import { AwaitingDataPanel } from "@/components/analyses/awaiting-data-panel";

function makePlaceholder(cardId: string, cardName: string) {
  function Placeholder() {
    return <AwaitingDataPanel cardName={cardName} cardId={cardId} reason="wave-pending" />;
  }
  Placeholder.displayName = `Placeholder(${cardId})`;
  return Placeholder;
}

export const A0ColorizerPlaceholder = makePlaceholder("A0_colorizer", "Question Colorizer");
export const S1Placeholder = makePlaceholder("S1_autocorr", "Spatial Autocorrelation");
export const S2Placeholder = makePlaceholder("S2_gi_star_q", "Hot/Cold Spot (Gi*)");
export const S3Placeholder = makePlaceholder("S3_lisa_q", "Cluster & Outlier (LISA)");
export const S4Placeholder = makePlaceholder("S4_satscan", "Spatial Scan (Kulldorff)");
export const S5Placeholder = makePlaceholder("S5_distance_decay", "Distance-Decay vs POI");
export const S6Placeholder = makePlaceholder("S6_coverage_response", "Coverage × Response");
export const S7Placeholder = makePlaceholder("S7_local_geary", "Local Geary Heterogeneity");
export const S8Placeholder = makePlaceholder("S8_bivariate", "Bivariate (Lee's L)");
export const V2Placeholder = makePlaceholder("v2", "Coming in v2");
```

- [ ] **Step 3: Register them in `viz-registry.ts`**

Append to `lib/analyses/viz-registry.ts`:

```ts
A0ColorizerPlaceholder: lazy(() =>
  import("@/components/analyses/cards/wave0-placeholders").then(m => ({ default: m.A0ColorizerPlaceholder }))),
S1Placeholder: lazy(() =>
  import("@/components/analyses/cards/wave0-placeholders").then(m => ({ default: m.S1Placeholder }))),
S2Placeholder: lazy(() =>
  import("@/components/analyses/cards/wave0-placeholders").then(m => ({ default: m.S2Placeholder }))),
S3Placeholder: lazy(() =>
  import("@/components/analyses/cards/wave0-placeholders").then(m => ({ default: m.S3Placeholder }))),
S4Placeholder: lazy(() =>
  import("@/components/analyses/cards/wave0-placeholders").then(m => ({ default: m.S4Placeholder }))),
S5Placeholder: lazy(() =>
  import("@/components/analyses/cards/wave0-placeholders").then(m => ({ default: m.S5Placeholder }))),
S6Placeholder: lazy(() =>
  import("@/components/analyses/cards/wave0-placeholders").then(m => ({ default: m.S6Placeholder }))),
S7Placeholder: lazy(() =>
  import("@/components/analyses/cards/wave0-placeholders").then(m => ({ default: m.S7Placeholder }))),
S8Placeholder: lazy(() =>
  import("@/components/analyses/cards/wave0-placeholders").then(m => ({ default: m.S8Placeholder }))),
V2Placeholder: lazy(() =>
  import("@/components/analyses/cards/wave0-placeholders").then(m => ({ default: m.V2Placeholder }))),
```

- [ ] **Step 4: Test renders correctly**

```tsx
// tests/analyses/wave0-placeholders.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { S2Placeholder } from "@/components/analyses/cards/wave0-placeholders";

describe("Wave 0 placeholders", () => {
  it("renders the Awaiting-data chrome with wave-pending hint", () => {
    render(<S2Placeholder />);
    expect(screen.getByText(/Hot\/Cold Spot/i)).toBeInTheDocument();
    expect(screen.getByText(/Compute backend ships in a later wave/i)).toBeInTheDocument();
  });
});
```

Run: `npx vitest run tests/analyses/wave0-placeholders.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add components/analyses/cards/wave0-placeholders.tsx components/analyses/awaiting-data-panel.tsx lib/analyses/viz-registry.ts tests/analyses/wave0-placeholders.test.tsx
git commit -m "feat(analyses): Wave 0 placeholder viz components + new AwaitingDataPanel reasons (M7.2 W0)"
```

---

### Task 9: Preview-image build script

**Files:**
- Create: `scripts/build-analysis-previews.ts`
- Modify: `package.json` (add `prebuild:previews` npm script)
- Run output: `public/analyses-previews/*.{png,jpg,svg}` + `public/analyses-previews/CREDITS.json`

- [ ] **Step 1: Author the script**

```ts
// scripts/build-analysis-previews.ts
// Downloads canonical preview images for the Spatial Analysis Toolbox and writes
// a CREDITS.json registry. Run via `npm run build:previews` (or automatically
// as part of build via the "prebuild:previews" hook).

import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";

const OUT_DIR = "public/analyses-previews";
const ASSETS_DIR = "assets/analyses-previews";

type RemoteImage = {
  cardId: string;
  url: string;
  filename: string;
  sourceTitle: string;
  sourceUrl: string;
  license: string;
  alt: string;
};

const REMOTE_IMAGES: RemoteImage[] = [
  {
    cardId: "A0_colorizer",
    url: "https://upload.wikimedia.org/wikipedia/commons/2/23/U.S._Presidential_election_margin%2C_2004-2016.png",
    filename: "A0_colorizer.png",
    sourceTitle: "Wikimedia Commons — Bplewe",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:U.S._Presidential_election_margin,_2004-2016.png",
    license: "CC-BY-SA-4.0",
    alt: "U.S. counties colored on a blue–red ramp by 2004–2016 presidential vote margin.",
  },
  {
    cardId: "S1_autocorr",
    url: "https://upload.wikimedia.org/wikipedia/commons/5/52/Moran_ScatterPlot_Columbus_Crime.PNG",
    filename: "S1_autocorr.png",
    sourceTitle: "Wikimedia Commons — Lgalvis74",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Moran_ScatterPlot_Columbus_Crime.PNG",
    license: "Public Domain",
    alt: "Moran's I scatterplot of crime rates by neighborhood, Columbus, OH.",
  },
  {
    cardId: "S2_gi_star_q",
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/USA_Contiguous_Unemployment_Rate_2020.jpg",
    filename: "S2_gi_star_q.jpg",
    sourceTitle: "Wikimedia Commons — GeogSage",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:USA_Contiguous_Unemployment_Rate_2020.jpg",
    license: "CC-BY-4.0",
    alt: "Getis-Ord Gi* hot/cold spot map of U.S. county unemployment, 2020.",
  },
  {
    cardId: "S3_lisa_q",
    url: "https://upload.wikimedia.org/wikipedia/commons/7/72/USA_Contiguous_Poverty_2020_clusters.jpg",
    filename: "S3_lisa_q.jpg",
    sourceTitle: "Wikimedia Commons — GeogSage",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:USA_Contiguous_Poverty_2020_clusters.jpg",
    license: "CC-BY-SA-4.0",
    alt: "Anselin Local Moran cluster map of U.S. county poverty 2020.",
  },
  {
    cardId: "S6_coverage_response",
    url: "https://upload.wikimedia.org/wikipedia/commons/4/41/Black_Hispanic_Bivariate_Map.png",
    filename: "S6_coverage_response.png",
    sourceTitle: "Wikimedia Commons — Bplewe",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Black_Hispanic_Bivariate_Map.png",
    license: "CC-BY-SA-4.0",
    alt: "Bivariate choropleth of U.S. counties.",
  },
];

const LOCAL_SVGS = [
  { cardId: "S4_satscan", filename: "S4_satscan.svg" },
  { cardId: "S5_distance_decay", filename: "S5_distance_decay.svg" },
  { cardId: "S7_local_geary", filename: "S7_local_geary.svg" },
  { cardId: "S8_bivariate", filename: "S8_bivariate.svg" },
];

async function downloadOne(img: RemoteImage): Promise<void> {
  const res = await fetch(img.url, {
    headers: { "User-Agent": "FieldSurvey/0.1 (analysis-preview builder)" },
  });
  if (!res.ok) throw new Error(`Download failed for ${img.url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dest = join(OUT_DIR, img.filename);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`✓ ${img.filename} (${(buf.length / 1024).toFixed(1)} KB)`);
}

async function copyLocalSvg(filename: string): Promise<void> {
  const src = join(ASSETS_DIR, filename);
  const dest = join(OUT_DIR, filename);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  console.log(`✓ ${filename} (custom SVG)`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const img of REMOTE_IMAGES) await downloadOne(img);
  for (const svg of LOCAL_SVGS) await copyLocalSvg(svg.filename);

  const credits = {
    generatedAt: new Date().toISOString(),
    images: [
      ...REMOTE_IMAGES.map((img) => ({
        cardId: img.cardId,
        file: img.filename,
        sourceTitle: img.sourceTitle,
        sourceUrl: img.sourceUrl,
        license: img.license,
        alt: img.alt,
      })),
      ...LOCAL_SVGS.map((svg) => ({
        cardId: svg.cardId,
        file: svg.filename,
        sourceTitle: "Custom illustration",
        sourceUrl: "",
        license: "Custom-by-us",
        alt: `Custom SVG preview for ${svg.cardId}`,
      })),
    ],
  };
  await writeFile(join(OUT_DIR, "CREDITS.json"), JSON.stringify(credits, null, 2));
  console.log(`✓ CREDITS.json (${credits.images.length} entries)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm scripts**

Edit `package.json` `"scripts"` block:

```json
"build:previews": "tsx scripts/build-analysis-previews.ts",
"prebuild": "npm run build:previews"
```

(If `tsx` is not yet a dev-dep, add it: `npm install --save-dev tsx`.)

- [ ] **Step 3: Commit (without running yet — Wikimedia download happens in Task 11 with custom SVGs in place)**

```bash
git add scripts/build-analysis-previews.ts package.json
git commit -m "feat(build): preview-image build script + CREDITS.json registry (M7.2 W0)"
```

---

### Task 10: Custom SVG previews — S4 (SaTScan) and S5 (Distance-Decay)

**Files:**
- Create: `assets/analyses-previews/S4_satscan.svg`
- Create: `assets/analyses-previews/S5_distance_decay.svg`

- [ ] **Step 1: Author `assets/analyses-previews/S4_satscan.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 140" role="img" aria-label="Schematic Kulldorff scan windows over a polygon basemap">
  <rect width="280" height="140" fill="#F4F4F5"/>
  <!-- Basemap polygons (light grey) -->
  <g fill="#E4E4E7" stroke="#D4D4D8" stroke-width="0.6">
    <polygon points="10,30 60,20 75,55 50,80 15,75"/>
    <polygon points="60,20 130,30 125,75 75,55"/>
    <polygon points="130,30 210,35 220,90 125,75"/>
    <polygon points="210,35 270,40 265,110 220,90"/>
    <polygon points="15,75 50,80 60,120 20,115"/>
    <polygon points="60,120 125,115 130,75 75,55 50,80"/>
    <polygon points="125,115 220,110 220,90 125,75"/>
  </g>
  <!-- Scan circles -->
  <circle cx="115" cy="65" r="32" fill="rgba(239,68,68,0.10)" stroke="#DC2626" stroke-width="2.2"/>
  <circle cx="205" cy="85" r="20" fill="rgba(239,68,68,0.06)" stroke="#DC2626" stroke-width="1.5" stroke-dasharray="3 3"/>
  <!-- Case dots inside primary -->
  <g fill="#B91C1C">
    <circle cx="100" cy="55" r="2"/><circle cx="120" cy="50" r="2"/>
    <circle cx="130" cy="70" r="2"/><circle cx="105" cy="78" r="2"/>
    <circle cx="120" cy="80" r="2"/><circle cx="95" cy="68" r="2"/>
    <circle cx="115" cy="65" r="2"/>
  </g>
  <!-- Case dots inside secondary -->
  <g fill="#B91C1C">
    <circle cx="200" cy="80" r="2"/><circle cx="210" cy="90" r="2"/>
    <circle cx="215" cy="80" r="2"/><circle cx="198" cy="92" r="2"/>
  </g>
  <!-- Labels -->
  <text x="115" y="44" font-family="ui-monospace, monospace" font-size="8" fill="#7F1D1D" text-anchor="middle">primary · p&lt;0.001</text>
  <text x="205" y="64" font-family="ui-monospace, monospace" font-size="7" fill="#7F1D1D" text-anchor="middle">secondary</text>
</svg>
```

- [ ] **Step 2: Author `assets/analyses-previews/S5_distance_decay.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 140" role="img" aria-label="Distance-decay curve with permutation envelope band">
  <rect width="280" height="140" fill="#FAFAFA"/>
  <!-- Axes -->
  <line x1="30" y1="115" x2="265" y2="115" stroke="#A1A1AA" stroke-width="0.8"/>
  <line x1="30" y1="15" x2="30" y2="115" stroke="#A1A1AA" stroke-width="0.8"/>
  <!-- Envelope (95% permutation band) -->
  <path d="M30,55 Q90,70 150,90 T265,108 L265,118 Q150,100 90,80 T30,68 Z" fill="rgba(148,163,184,0.30)"/>
  <!-- Observed curve -->
  <path d="M30,40 Q90,60 150,82 T265,104" fill="none" stroke="#0EA5E9" stroke-width="2.2"/>
  <!-- POI star -->
  <polygon points="30,28 33,36 41,36 35,41 37,49 30,44 23,49 25,41 19,36 27,36" fill="#F59E0B"/>
  <!-- Axis labels -->
  <text x="148" y="132" font-family="ui-sans-serif, system-ui" font-size="8" fill="#52525B" text-anchor="middle">Distance from POI →</text>
  <text x="15" y="65" font-family="ui-sans-serif, system-ui" font-size="8" fill="#52525B" transform="rotate(-90 15 65)" text-anchor="middle">Mean response →</text>
  <text x="48" y="22" font-family="ui-monospace, monospace" font-size="7" fill="#A16207">POI</text>
</svg>
```

- [ ] **Step 3: Commit**

```bash
git add assets/analyses-previews/S4_satscan.svg assets/analyses-previews/S5_distance_decay.svg
git commit -m "feat(assets): S4 SaTScan + S5 distance-decay preview SVGs (M7.2 W0)"
```

---

### Task 11: Custom SVG previews — S7 (Local Geary), S8 (Lee's L), and v2 placeholders

**Files:**
- Create: `assets/analyses-previews/S7_local_geary.svg`
- Create: `assets/analyses-previews/S8_bivariate.svg`
- Create: `assets/analyses-previews/V2_emerging_hot.svg`
- Create: `assets/analyses-previews/V2_gwr.svg`
- Create: `assets/analyses-previews/V2_segregation.svg`

- [ ] **Step 1: Author `assets/analyses-previews/S7_local_geary.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 140" role="img" aria-label="Hex mosaic showing teal-magenta diverging palette for Local Geary heterogeneity">
  <rect width="280" height="140" fill="#FAFAFA"/>
  <!-- Hex grid (5 rows × 9 cols), classes: teal / pale / magenta -->
  <g stroke="#FFFFFF" stroke-width="0.8">
    <!-- Row 1 -->
    <polygon points="20,14 32,7 44,14 44,28 32,35 20,28" fill="#5EEAD4"/>
    <polygon points="48,14 60,7 72,14 72,28 60,35 48,28" fill="#5EEAD4"/>
    <polygon points="76,14 88,7 100,14 100,28 88,35 76,28" fill="#99F6E4"/>
    <polygon points="104,14 116,7 128,14 128,28 116,35 104,28" fill="#F1F5F9"/>
    <polygon points="132,14 144,7 156,14 156,28 144,35 132,28" fill="#F1F5F9"/>
    <polygon points="160,14 172,7 184,14 184,28 172,35 160,28" fill="#F1F5F9"/>
    <polygon points="188,14 200,7 212,14 212,28 200,35 188,28" fill="#FBCFE8"/>
    <polygon points="216,14 228,7 240,14 240,28 228,35 216,28" fill="#F472B6"/>
    <polygon points="244,14 256,7 268,14 268,28 256,35 244,28" fill="#F472B6"/>
    <!-- Row 2 (offset) -->
    <polygon points="34,42 46,35 58,42 58,56 46,63 34,56" fill="#5EEAD4"/>
    <polygon points="62,42 74,35 86,42 86,56 74,63 62,56" fill="#99F6E4"/>
    <polygon points="90,42 102,35 114,42 114,56 102,63 90,56" fill="#F1F5F9"/>
    <polygon points="118,42 130,35 142,42 142,56 130,63 118,56" fill="#F1F5F9"/>
    <polygon points="146,42 158,35 170,42 170,56 158,63 146,56" fill="#F1F5F9"/>
    <polygon points="174,42 186,35 198,42 198,56 186,63 174,56" fill="#FBCFE8"/>
    <polygon points="202,42 214,35 226,42 226,56 214,63 202,56" fill="#F472B6"/>
    <polygon points="230,42 242,35 254,42 254,56 242,63 230,56" fill="#F472B6"/>
    <!-- Row 3 -->
    <polygon points="20,70 32,63 44,70 44,84 32,91 20,84" fill="#99F6E4"/>
    <polygon points="48,70 60,63 72,70 72,84 60,91 48,84" fill="#99F6E4"/>
    <polygon points="76,70 88,63 100,70 100,84 88,91 76,84" fill="#F1F5F9"/>
    <polygon points="104,70 116,63 128,70 128,84 116,91 104,84" fill="#F1F5F9"/>
    <polygon points="132,70 144,63 156,70 156,84 144,91 132,84" fill="#FBCFE8"/>
    <polygon points="160,70 172,63 184,70 184,84 172,91 160,84" fill="#FBCFE8"/>
    <polygon points="188,70 200,63 212,70 212,84 200,91 188,84" fill="#F472B6"/>
    <polygon points="216,70 228,63 240,70 240,84 228,91 216,84" fill="#F472B6"/>
    <polygon points="244,70 256,63 268,70 268,84 256,91 244,84" fill="#F472B6"/>
    <!-- Row 4 (offset) -->
    <polygon points="34,98 46,91 58,98 58,112 46,119 34,112" fill="#99F6E4"/>
    <polygon points="62,98 74,91 86,98 86,112 74,119 62,112" fill="#F1F5F9"/>
    <polygon points="90,98 102,91 114,98 114,112 102,119 90,112" fill="#F1F5F9"/>
    <polygon points="118,98 130,91 142,98 142,112 130,119 118,112" fill="#F1F5F9"/>
    <polygon points="146,98 158,91 170,98 170,112 158,119 146,112" fill="#FBCFE8"/>
    <polygon points="174,98 186,91 198,98 198,112 186,119 174,112" fill="#FBCFE8"/>
    <polygon points="202,98 214,91 226,98 226,112 214,119 202,112" fill="#FBCFE8"/>
    <polygon points="230,98 242,91 254,98 254,112 242,119 230,112" fill="#F472B6"/>
  </g>
  <text x="20" y="132" font-family="ui-sans-serif, system-ui" font-size="8" fill="#52525B">Similar to neighbors</text>
  <text x="268" y="132" font-family="ui-sans-serif, system-ui" font-size="8" fill="#52525B" text-anchor="end">Differs from neighbors</text>
</svg>
```

- [ ] **Step 2: Author `assets/analyses-previews/S8_bivariate.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 140" role="img" aria-label="Hex mosaic with HH/LL/HL/LH bivariate palette and a small two-variable inset">
  <rect width="280" height="140" fill="#FAFAFA"/>
  <g stroke="#FFFFFF" stroke-width="0.8">
    <!-- Row 1 (HH cluster top-left, LH outliers right) -->
    <polygon points="20,14 32,7 44,14 44,28 32,35 20,28" fill="#7F1D1D"/>
    <polygon points="48,14 60,7 72,14 72,28 60,35 48,28" fill="#7F1D1D"/>
    <polygon points="76,14 88,7 100,14 100,28 88,35 76,28" fill="#B91C1C"/>
    <polygon points="104,14 116,7 128,14 128,28 116,35 104,28" fill="#FECACA"/>
    <polygon points="132,14 144,7 156,14 156,28 144,35 132,28" fill="#FECACA"/>
    <polygon points="160,14 172,7 184,14 184,28 172,35 160,28" fill="#FECACA"/>
    <polygon points="188,14 200,7 212,14 212,28 200,35 188,28" fill="#FBCFE8"/>
    <polygon points="216,14 228,7 240,14 240,28 228,35 216,28" fill="#FBCFE8"/>
    <polygon points="244,14 256,7 268,14 268,28 256,35 244,28" fill="#BFDBFE"/>
    <!-- Row 2 -->
    <polygon points="34,42 46,35 58,42 58,56 46,63 34,56" fill="#7F1D1D"/>
    <polygon points="62,42 74,35 86,42 86,56 74,63 62,56" fill="#B91C1C"/>
    <polygon points="90,42 102,35 114,42 114,56 102,63 90,56" fill="#FBCFE8"/>
    <polygon points="118,42 130,35 142,42 142,56 130,63 118,56" fill="#FBCFE8"/>
    <polygon points="146,42 158,35 170,42 170,56 158,63 146,56" fill="#FBCFE8"/>
    <polygon points="174,42 186,35 198,42 198,56 186,63 174,56" fill="#BFDBFE"/>
    <polygon points="202,42 214,35 226,42 226,56 214,63 202,56" fill="#BFDBFE"/>
    <polygon points="230,42 242,35 254,42 254,56 242,63 230,56" fill="#1E3A8A"/>
    <!-- Row 3 -->
    <polygon points="20,70 32,63 44,70 44,84 32,91 20,84" fill="#B91C1C"/>
    <polygon points="48,70 60,63 72,70 72,84 60,91 48,84" fill="#FECACA"/>
    <polygon points="76,70 88,63 100,70 100,84 88,91 76,84" fill="#FBCFE8"/>
    <polygon points="104,70 116,63 128,70 128,84 116,91 104,84" fill="#FBCFE8"/>
    <polygon points="132,70 144,63 156,70 156,84 144,91 132,84" fill="#BFDBFE"/>
    <polygon points="160,70 172,63 184,70 184,84 172,91 160,84" fill="#BFDBFE"/>
    <polygon points="188,70 200,63 212,70 212,84 200,91 188,84" fill="#1E3A8A"/>
    <polygon points="216,70 228,63 240,70 240,84 228,91 216,84" fill="#1E3A8A"/>
    <polygon points="244,70 256,63 268,70 268,84 256,91 244,84" fill="#1E40AF"/>
    <!-- Row 4 -->
    <polygon points="34,98 46,91 58,98 58,112 46,119 34,112" fill="#FECACA"/>
    <polygon points="62,98 74,91 86,98 86,112 74,119 62,112" fill="#FBCFE8"/>
    <polygon points="90,98 102,91 114,98 114,112 102,119 90,112" fill="#FBCFE8"/>
    <polygon points="118,98 130,91 142,98 142,112 130,119 118,112" fill="#BFDBFE"/>
    <polygon points="146,98 158,91 170,98 170,112 158,119 146,112" fill="#1E3A8A"/>
    <polygon points="174,98 186,91 198,98 198,112 186,119 174,112" fill="#1E3A8A"/>
    <polygon points="202,98 214,91 226,98 226,112 214,119 202,112" fill="#1E40AF"/>
    <polygon points="230,98 242,91 254,98 254,112 242,119 230,112" fill="#1E40AF"/>
  </g>
  <!-- Two-variable inset -->
  <g transform="translate(218,108)">
    <rect width="50" height="20" fill="#FFFFFF" stroke="#D4D4D8" stroke-width="0.6" rx="2"/>
    <rect x="3" y="4" width="20" height="5" fill="#DC2626"/>
    <rect x="3" y="11" width="20" height="5" fill="#2563EB"/>
    <text x="27" y="9" font-family="ui-monospace, monospace" font-size="6" fill="#27272A">X</text>
    <text x="27" y="16" font-family="ui-monospace, monospace" font-size="6" fill="#27272A">Y</text>
  </g>
</svg>
```

- [ ] **Step 3: Author 3 short v2 placeholder SVGs**

```svg
<!-- assets/analyses-previews/V2_emerging_hot.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 140" role="img" aria-label="Coming in v2">
  <rect width="280" height="140" fill="#F4F4F5"/>
  <text x="140" y="74" font-family="ui-sans-serif, system-ui" font-size="14" font-weight="600" fill="#71717A" text-anchor="middle">⏰ Space-Time</text>
  <text x="140" y="92" font-family="ui-monospace, monospace" font-size="9" fill="#A1A1AA" text-anchor="middle">Emerging Hot Spot — v2</text>
</svg>
```

```svg
<!-- assets/analyses-previews/V2_gwr.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 140" role="img" aria-label="Coming in v2">
  <rect width="280" height="140" fill="#F4F4F5"/>
  <text x="140" y="74" font-family="ui-sans-serif, system-ui" font-size="14" font-weight="600" fill="#71717A" text-anchor="middle">📈 Spatial Regression</text>
  <text x="140" y="92" font-family="ui-monospace, monospace" font-size="9" fill="#A1A1AA" text-anchor="middle">GWR / MGWR — v2</text>
</svg>
```

```svg
<!-- assets/analyses-previews/V2_segregation.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 140" role="img" aria-label="Coming in v2">
  <rect width="280" height="140" fill="#F4F4F5"/>
  <text x="140" y="74" font-family="ui-sans-serif, system-ui" font-size="14" font-weight="600" fill="#71717A" text-anchor="middle">⚖️ Sampling Equity</text>
  <text x="140" y="92" font-family="ui-monospace, monospace" font-size="9" fill="#A1A1AA" text-anchor="middle">Segregation Indices — v2</text>
</svg>
```

- [ ] **Step 4: Run the preview builder**

```bash
npm run build:previews
```

Expected output: 5 downloads + 7 copies + `CREDITS.json` written. Verify files exist:

```bash
ls public/analyses-previews/
```
Expected: `A0_colorizer.png S1_autocorr.png S2_gi_star_q.jpg S3_lisa_q.jpg S4_satscan.svg S5_distance_decay.svg S6_coverage_response.png S7_local_geary.svg S8_bivariate.svg V2_emerging_hot.svg V2_gwr.svg V2_segregation.svg CREDITS.json`

- [ ] **Step 5: Commit (downloaded images + svgs)**

```bash
git add assets/analyses-previews/ public/analyses-previews/
git commit -m "feat(assets): all 12 preview images + CREDITS.json (M7.2 W0)"
```

---

### Task 12: `AddAnalysisModal` shell (Radix Dialog + toolbox tab state)

**Files:**
- Create: `components/analyses/add-analysis-modal.tsx`
- Test: `tests/analyses/add-analysis-modal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/analyses/add-analysis-modal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddAnalysisModal } from "@/components/analyses/add-analysis-modal";

describe("AddAnalysisModal", () => {
  it("renders the 5 v1 toolbox names when open", () => {
    render(<AddAnalysisModal open onOpenChange={() => {}} onAdd={() => {}} />);
    expect(screen.getByText(/Symbology & Visualization/)).toBeInTheDocument();
    expect(screen.getByText(/Analyzing Patterns/)).toBeInTheDocument();
    expect(screen.getByText(/Mapping Clusters/)).toBeInTheDocument();
    expect(screen.getByText(/Modeling Spatial Relationships/)).toBeInTheDocument();
    expect(screen.getByText(/Survey Coverage & Equity/)).toBeInTheDocument();
  });

  it("renders 3 v2 placeholder toolboxes as greyed", () => {
    render(<AddAnalysisModal open onOpenChange={() => {}} onAdd={() => {}} />);
    const v2 = screen.getByText(/Space-Time Pattern Mining/);
    expect(v2).toBeInTheDocument();
    // Parent has data-v2="true" so the rail can style it greyed
    expect(v2.closest('[data-v2="true"]')).not.toBeNull();
  });

  it("clicking a v1 toolbox shows its cards", async () => {
    const u = userEvent.setup();
    render(<AddAnalysisModal open onOpenChange={() => {}} onAdd={() => {}} />);
    await u.click(screen.getByText(/Mapping Clusters/));
    expect(screen.getByText(/Hot\/Cold Spot/i)).toBeInTheDocument();
    expect(screen.getByText(/Cluster & Outlier/i)).toBeInTheDocument();
  });

  it("clicking Add on a card calls onAdd with the card id", async () => {
    const u = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddAnalysisModal open onOpenChange={() => {}} onAdd={onAdd} />);
    await u.click(screen.getByText(/Mapping Clusters/));
    // First "Add" button under the Hot/Cold Spot card
    const cards = screen.getAllByRole("button", { name: /Add .* to Analyze tab/i });
    await u.click(cards[0]);
    expect(onAdd).toHaveBeenCalledWith(expect.stringMatching(/^S[2347]_/));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyses/add-analysis-modal.test.tsx`
Expected: FAIL — `Cannot find module '@/components/analyses/add-analysis-modal'`

- [ ] **Step 3: Implement the modal**

```tsx
// components/analyses/add-analysis-modal.tsx
"use client";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { TOOLBOXES, v1Toolboxes, getToolbox } from "@/lib/analyses/toolboxes";
import type { ToolboxSlug, SpatialCardCatalogEntry } from "@/lib/analyses/types";
import { ANALYSES_REGISTRY } from "@/lib/analyses/registry";
import { ToolboxLeftRail } from "./toolbox-left-rail";
import { AnalysisCardPreview } from "./analysis-card-preview";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (cardId: string) => void;
};

export function AddAnalysisModal({ open, onOpenChange, onAdd }: Props) {
  const v1 = v1Toolboxes();
  const [activeToolbox, setActiveToolbox] = useState<ToolboxSlug>(v1[0]?.slug ?? "symbology");
  const active = getToolbox(activeToolbox);

  const cardsInToolbox = ANALYSES_REGISTRY
    .filter((c): c is SpatialCardCatalogEntry => "toolbox" in c)
    .filter((c) => c.toolbox === activeToolbox)
    .sort((a, b) => a.cardOrder - b.cardOrder);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                     w-[min(1100px,92vw)] h-[min(720px,86vh)] rounded-2xl
                     bg-[var(--shell-1)] border border-[var(--shell-border)] shadow-2xl
                     grid grid-cols-[260px_1fr] overflow-hidden"
          aria-describedby="add-analysis-desc"
        >
          <ToolboxLeftRail
            toolboxes={TOOLBOXES}
            activeSlug={activeToolbox}
            onSelect={setActiveToolbox}
          />
          <div className="flex flex-col min-h-0">
            <header className="border-b border-[var(--shell-border)] p-4">
              <Dialog.Title className="text-base font-semibold flex items-center gap-2">
                <span aria-hidden>{active?.icon}</span>
                {active?.label}
              </Dialog.Title>
              <p id="add-analysis-desc" className="text-[12px] text-[var(--shell-text-muted)] mt-1">
                {active?.description}
              </p>
            </header>
            <div className="flex-1 overflow-auto p-4">
              {cardsInToolbox.length === 0 ? (
                <div className="grid place-items-center h-full text-[var(--shell-text-muted)] text-sm">
                  No analyses in this toolbox yet — coming in v2.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {cardsInToolbox.map((card) => (
                    <AnalysisCardPreview key={card.id} card={card} onAdd={() => onAdd(card.id)} />
                  ))}
                </div>
              )}
            </div>
          </div>
          <Dialog.Close
            aria-label="Close"
            className="absolute top-3 right-3 rounded-md p-1.5
                       text-[var(--shell-text-muted)] hover:text-[var(--shell-text)]"
          >
            ✕
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Run the test (still fails — `ToolboxLeftRail` + `AnalysisCardPreview` not built)**

Run: `npx vitest run tests/analyses/add-analysis-modal.test.tsx`
Expected: FAIL — `Cannot find module './toolbox-left-rail'`. That's OK; Tasks 13–14 implement them. **Do not commit yet.**

---

### Task 13: `ToolboxLeftRail`

**Files:**
- Create: `components/analyses/toolbox-left-rail.tsx`

- [ ] **Step 1: Implement (test from Task 12 will pass after Task 14 is done)**

```tsx
// components/analyses/toolbox-left-rail.tsx
"use client";
import type { Toolbox } from "@/lib/analyses/toolboxes";
import type { ToolboxSlug } from "@/lib/analyses/types";

type Props = {
  toolboxes: Toolbox[];
  activeSlug: ToolboxSlug;
  onSelect: (slug: ToolboxSlug) => void;
};

export function ToolboxLeftRail({ toolboxes, activeSlug, onSelect }: Props) {
  const v1 = toolboxes.filter((t) => !t.isV2).sort((a, b) => a.sortOrder - b.sortOrder);
  const v2 = toolboxes.filter((t) => t.isV2).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <nav
      role="tablist"
      aria-label="Spatial Analysis Toolboxes"
      className="border-r border-[var(--shell-border)] bg-[var(--shell-2)] flex flex-col py-3 gap-0.5 text-sm"
    >
      <div className="px-3 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--shell-text-muted)]">
        Toolboxes
      </div>
      {v1.map((t) => (
        <button
          key={t.slug}
          role="tab"
          aria-selected={activeSlug === t.slug}
          data-v2="false"
          onClick={() => onSelect(t.slug)}
          className={
            "text-left px-3 py-2 mx-1 rounded-md flex items-center gap-2 " +
            (activeSlug === t.slug
              ? "bg-[var(--shell-1)] text-[var(--shell-text)] font-semibold"
              : "text-[var(--shell-text-muted)] hover:bg-[var(--shell-1)]/60")
          }
        >
          <span aria-hidden>{t.icon}</span>
          <span className="text-[12.5px]">{t.label}</span>
        </button>
      ))}
      <div className="px-3 pt-3 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--shell-text-muted)]">
        Coming in v2
      </div>
      {v2.map((t) => (
        <div
          key={t.slug}
          role="tab"
          data-v2="true"
          aria-disabled
          className="text-left px-3 py-2 mx-1 rounded-md flex items-center gap-2
                     opacity-50 cursor-not-allowed text-[12.5px]"
        >
          <span aria-hidden>{t.icon}</span>
          <span>{t.label}</span>
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Commit (test still failing — `AnalysisCardPreview` next)**

```bash
git add components/analyses/toolbox-left-rail.tsx
git commit -m "feat(analyses): ToolboxLeftRail (5 v1 + 3 v2 greyed) (M7.2 W0)"
```

---

### Task 14: `AnalysisCardPreview`

**Files:**
- Create: `components/analyses/analysis-card-preview.tsx`

- [ ] **Step 1: Implement**

```tsx
// components/analyses/analysis-card-preview.tsx
"use client";
import Image from "next/image";
import type { SpatialCardCatalogEntry } from "@/lib/analyses/types";

type Props = {
  card: SpatialCardCatalogEntry;
  onAdd: () => void;
};

export function AnalysisCardPreview({ card, onAdd }: Props) {
  const img = card.previewImage;
  return (
    <article className="rounded-xl border border-[var(--shell-border)] bg-[var(--shell-1)] overflow-hidden flex flex-col">
      <div className="relative h-[140px] w-full bg-[var(--shell-2)]">
        <Image
          src={img.src}
          alt={img.alt}
          fill
          sizes="(min-width: 1280px) 320px, (min-width: 768px) 50vw, 100vw"
          style={{ objectFit: "cover" }}
          unoptimized={img.src.endsWith(".svg")}
        />
      </div>
      <div className="p-3 flex flex-col gap-2 flex-1 min-h-0">
        <header>
          <h3 className="font-semibold text-[13.5px] leading-tight">{card.name}</h3>
          <p className="text-[11.5px] text-[var(--shell-text-muted)] mt-0.5">{card.short}</p>
        </header>
        <section>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)] mb-1">
            What it answers
          </div>
          <ul className="list-disc pl-4 text-[11.5px] space-y-0.5">
            {card.questionsAnswered.slice(0, 2).map((q) => <li key={q}>{q}</li>)}
          </ul>
        </section>
        <section>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)] mb-1">
            What it does
          </div>
          <p className="text-[11.5px] leading-snug">{card.whatItDoes}</p>
        </section>
        <section>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)] mb-1">
            Inputs
          </div>
          <div className="flex flex-wrap gap-1">
            {card.inputRequirements.map((r) => (
              <span
                key={r}
                className="font-mono text-[9.5px] rounded-full border border-[var(--shell-border)] bg-[var(--shell-2)] px-1.5 py-0.5"
              >
                {r}
              </span>
            ))}
          </div>
        </section>
        <button
          onClick={onAdd}
          aria-label={`Add ${card.name} to Analyze tab`}
          className="mt-auto rounded-md bg-[var(--accent-1,#0EA5E9)] text-white text-[12px] font-semibold py-1.5 px-3 hover:opacity-90"
        >
          + Add to Analyze tab
        </button>
        <footer className="text-[9.5px] text-[var(--shell-text-muted)] mt-0.5">
          Image © <a href={img.sourceUrl || "#"} target="_blank" rel="noopener" className="underline">
            {img.sourceTitle}
          </a>{" · "}{img.license}
        </footer>
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Run Task-12 test**

Run: `npx vitest run tests/analyses/add-analysis-modal.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add components/analyses/analysis-card-preview.tsx components/analyses/add-analysis-modal.tsx tests/analyses/add-analysis-modal.test.tsx
git commit -m "feat(analyses): AddAnalysisModal + AnalysisCardPreview (M7.2 W0)"
```

---

### Task 15: Setting input primitives — `SettingSlider`, `SettingSelect`, `SettingToggle`

**Files:**
- Create: `components/analyses/inputs/setting-slider.tsx`
- Create: `components/analyses/inputs/setting-select.tsx`
- Create: `components/analyses/inputs/setting-toggle.tsx`

- [ ] **Step 1: Implement `setting-slider.tsx`**

```tsx
// components/analyses/inputs/setting-slider.tsx
"use client";
type Props = {
  label: string;
  min: number; max: number; step: number;
  value: number;
  onChange: (v: number) => void;
};
export function SettingSlider({ label, min, max, step, value, onChange }: Props) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
        {label}
      </span>
      <div className="flex items-center gap-3 mt-1">
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-[var(--accent-1,#0EA5E9)]"
          aria-label={label}
        />
        <span className="font-mono text-[12px] tabular-nums min-w-[3.5rem] text-right">
          {value.toFixed(step < 1 ? 2 : 0)}
        </span>
      </div>
    </label>
  );
}
```

- [ ] **Step 2: Implement `setting-select.tsx`**

```tsx
// components/analyses/inputs/setting-select.tsx
"use client";
type Opt = { value: string | number; label: string };
type Props = {
  label: string;
  options: Opt[];
  value: string | number;
  onChange: (v: string | number) => void;
};
export function SettingSelect({ label, options, value, onChange }: Props) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
        {label}
      </span>
      <select
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const o = options.find((o) => String(o.value) === raw);
          onChange(o ? o.value : raw);
        }}
        className="mt-1 w-full rounded-md border border-[var(--shell-border)] bg-[var(--shell-1)] py-1.5 px-2 text-[12.5px]"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 3: Implement `setting-toggle.tsx`**

```tsx
// components/analyses/inputs/setting-toggle.tsx
"use client";
type Props = { label: string; value: boolean; onChange: (v: boolean) => void };
export function SettingToggle({ label, value, onChange }: Props) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="text-[12.5px]">{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="accent-[var(--accent-1,#0EA5E9)]"
      />
    </label>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add components/analyses/inputs/
git commit -m "feat(analyses): SettingSlider/Select/Toggle input primitives (M7.2 W0)"
```

---

### Task 16: Setting input primitives — `QuestionPicker`, `AnswerPicker`, `PoiPicker`

These need a hook for the project's survey-response column schema. Wave 0 ships a minimal stub that reads from a `useResponseColumns(projectId)` hook returning a hardcoded fixture; Wave 1 wires it to the real schema.

**Files:**
- Create: `hooks/use-response-columns.ts`
- Create: `components/analyses/inputs/question-picker.tsx`
- Create: `components/analyses/inputs/answer-picker.tsx`
- Create: `components/analyses/inputs/poi-picker.tsx`

- [ ] **Step 1: Implement `hooks/use-response-columns.ts` (Wave-0 fixture)**

```ts
// hooks/use-response-columns.ts
// Wave-0 stub: returns the distinct raw_data keys + sample values for a project.
// Wave-1 swaps this with a real fetch against /api/projects/{p}/response-schema.
"use client";
import { useEffect, useState } from "react";

export type ResponseColumn = {
  key: string;
  inferredType: "categorical" | "numeric" | "likert" | "boolean" | "text" | "date";
  distinctSample: string[];
};

export function useResponseColumns(projectId: string | undefined): {
  columns: ResponseColumn[];
  loading: boolean;
} {
  const [columns, setColumns] = useState<ResponseColumn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    // Wave-0 fixture; replaced in Wave 1 with real fetch.
    const fixture: ResponseColumn[] = [
      { key: "Q1", inferredType: "categorical", distinctSample: ["Yes", "No", "Maybe"] },
      { key: "Q2", inferredType: "numeric", distinctSample: ["12", "34", "56"] },
      { key: "Q3", inferredType: "likert", distinctSample: ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"] },
    ];
    setTimeout(() => { if (!cancelled) { setColumns(fixture); setLoading(false); } }, 30);
    return () => { cancelled = true; };
  }, [projectId]);

  return { columns, loading };
}
```

- [ ] **Step 2: Implement `question-picker.tsx`**

```tsx
// components/analyses/inputs/question-picker.tsx
"use client";
import { useResponseColumns } from "@/hooks/use-response-columns";

type Props = {
  label: string;
  projectId: string;
  value: string | "inherit_global";
  globalActiveQuestion: string | null;
  onChange: (v: string | "inherit_global") => void;
};

export function QuestionPicker({ label, projectId, value, globalActiveQuestion, onChange }: Props) {
  const { columns, loading } = useResponseColumns(projectId);
  return (
    <fieldset className="block">
      <legend className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
        {label}
      </legend>
      <div className="space-y-1 mt-1">
        <label className="flex items-center gap-2 text-[12.5px]">
          <input
            type="radio" name={`qp-${label}`} value="inherit_global"
            checked={value === "inherit_global"}
            onChange={() => onChange("inherit_global")}
          />
          Inherit global active question
          {globalActiveQuestion && (
            <span className="font-mono text-[10.5px] text-[var(--shell-text-muted)]">
              ({globalActiveQuestion})
            </span>
          )}
        </label>
        <label className="flex items-center gap-2 text-[12.5px]">
          <input
            type="radio" name={`qp-${label}`} value="override"
            checked={value !== "inherit_global"}
            onChange={() => onChange(columns[0]?.key ?? "")}
          />
          Override with…
          <select
            disabled={value === "inherit_global" || loading}
            value={value === "inherit_global" ? "" : value}
            onChange={(e) => onChange(e.target.value)}
            className="rounded-md border border-[var(--shell-border)] bg-[var(--shell-1)] py-1 px-2 text-[12.5px] disabled:opacity-50"
          >
            <option value="">{loading ? "Loading…" : "Pick a question"}</option>
            {columns.map((c) => (
              <option key={c.key} value={c.key}>{c.key} ({c.inferredType})</option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 3: Implement `answer-picker.tsx`**

```tsx
// components/analyses/inputs/answer-picker.tsx
"use client";
import { useResponseColumns } from "@/hooks/use-response-columns";

type Props = {
  label: string;
  projectId: string;
  /** The question key whose answers populate this picker. */
  questionKey: string;
  value: string;
  onChange: (v: string) => void;
};

export function AnswerPicker({ label, projectId, questionKey, value, onChange }: Props) {
  const { columns } = useResponseColumns(projectId);
  const col = columns.find((c) => c.key === questionKey);
  const options = col?.distinctSample ?? [];

  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!col}
        className="mt-1 w-full rounded-md border border-[var(--shell-border)] bg-[var(--shell-1)] py-1.5 px-2 text-[12.5px] disabled:opacity-50"
      >
        <option value="">{col ? "Pick an answer" : "Select a question first"}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
```

- [ ] **Step 4: Implement `poi-picker.tsx`**

```tsx
// components/analyses/inputs/poi-picker.tsx
"use client";
type POI = { lat: number; lon: number } | null;
type Props = {
  label: string;
  value: POI;
  onChange: (v: POI) => void;
  /** Click-on-map mode hook — Wave-0 leaves it as a no-op; Wave-1 wires MapLibre. */
  onRequestMapPick?: () => void;
};

export function PoiPicker({ label, value, onChange, onRequestMapPick }: Props) {
  return (
    <fieldset className="block">
      <legend className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
        {label}
      </legend>
      <div className="grid grid-cols-2 gap-2 mt-1">
        <label className="text-[12px]">
          Lat
          <input
            type="number" step="0.000001"
            value={value?.lat ?? ""}
            onChange={(e) => {
              const lat = Number(e.target.value);
              onChange(Number.isFinite(lat) ? { lat, lon: value?.lon ?? 0 } : null);
            }}
            className="block w-full rounded-md border border-[var(--shell-border)] bg-[var(--shell-1)] py-1 px-2 text-[12.5px] mt-0.5"
          />
        </label>
        <label className="text-[12px]">
          Lon
          <input
            type="number" step="0.000001"
            value={value?.lon ?? ""}
            onChange={(e) => {
              const lon = Number(e.target.value);
              onChange(Number.isFinite(lon) ? { lat: value?.lat ?? 0, lon } : null);
            }}
            className="block w-full rounded-md border border-[var(--shell-border)] bg-[var(--shell-1)] py-1 px-2 text-[12.5px] mt-0.5"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={onRequestMapPick}
        disabled={!onRequestMapPick}
        className="mt-2 rounded-md border border-[var(--shell-border)] bg-[var(--shell-1)] px-2 py-1 text-[11.5px] disabled:opacity-50"
      >
        📍 Click on map to set
      </button>
    </fieldset>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add hooks/use-response-columns.ts components/analyses/inputs/question-picker.tsx components/analyses/inputs/answer-picker.tsx components/analyses/inputs/poi-picker.tsx
git commit -m "feat(analyses): QuestionPicker / AnswerPicker / PoiPicker inputs (M7.2 W0)"
```

---

### Task 17: `SettingsDrawer` — schema-driven router

**Files:**
- Create: `components/analyses/settings-drawer.tsx`
- Test: `tests/analyses/settings-drawer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/analyses/settings-drawer.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsDrawer } from "@/components/analyses/settings-drawer";
import { getCardById } from "@/lib/analyses/registry";
import type { SpatialCardCatalogEntry } from "@/lib/analyses/types";

describe("SettingsDrawer", () => {
  const card = getCardById("S2_gi_star_q") as SpatialCardCatalogEntry;

  it("renders one input per settingsSchema entry", () => {
    render(
      <SettingsDrawer
        open card={card} projectId="p1"
        globalActiveQuestion="Q1"
        settings={{}}
        onChange={() => {}}
        onClose={() => {}}
        onRecompute={() => {}}
      />
    );
    expect(screen.getByText(/Question/i)).toBeInTheDocument();
    expect(screen.getByText(/FDR alpha/i)).toBeInTheDocument();
    expect(screen.getByText(/Spatial weights/i)).toBeInTheDocument();
    expect(screen.getByText(/Permutations/i)).toBeInTheDocument();
  });

  it("emits onChange when the slider changes", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SettingsDrawer
        open card={card} projectId="p1"
        globalActiveQuestion="Q1"
        settings={{ fdrAlpha: 0.05 }}
        onChange={onChange}
        onClose={() => {}}
        onRecompute={() => {}}
      />
    );
    const slider = screen.getByLabelText(/FDR alpha/i);
    await u.click(slider); // focuses
    // jsdom doesn't fire a real range change via arrow keys reliably, so set value:
    (slider as HTMLInputElement).value = "0.07";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement `settings-drawer.tsx`**

```tsx
// components/analyses/settings-drawer.tsx
"use client";
import * as Dialog from "@radix-ui/react-dialog";
import type { SpatialCardCatalogEntry, SettingSchema } from "@/lib/analyses/types";
import { QuestionPicker } from "./inputs/question-picker";
import { AnswerPicker } from "./inputs/answer-picker";
import { PoiPicker } from "./inputs/poi-picker";
import { SettingSlider } from "./inputs/setting-slider";
import { SettingSelect } from "./inputs/setting-select";
import { SettingToggle } from "./inputs/setting-toggle";

type Props = {
  open: boolean;
  card: SpatialCardCatalogEntry;
  projectId: string;
  globalActiveQuestion: string | null;
  settings: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  onClose: () => void;
  onRecompute: () => void;
};

function renderField(
  schema: SettingSchema,
  ctx: { projectId: string; globalActiveQuestion: string | null; settings: Record<string, unknown>; emit: (key: string, v: unknown) => void },
) {
  const { projectId, globalActiveQuestion, settings, emit } = ctx;
  switch (schema.type) {
    case "question_picker":
      return (
        <QuestionPicker
          key={schema.key} label={schema.label} projectId={projectId}
          value={(settings[schema.key] as string | "inherit_global" | undefined) ?? schema.defaultValue ?? "inherit_global"}
          globalActiveQuestion={globalActiveQuestion}
          onChange={(v) => emit(schema.key, v)}
        />
      );
    case "answer_picker": {
      const qk = (settings[schema.questionKeyRef] as string | undefined) ?? "";
      return (
        <AnswerPicker
          key={schema.key} label={schema.label} projectId={projectId}
          questionKey={qk}
          value={(settings[schema.key] as string | undefined) ?? ""}
          onChange={(v) => emit(schema.key, v)}
        />
      );
    }
    case "poi_picker":
      return (
        <PoiPicker
          key={schema.key} label={schema.label}
          value={(settings[schema.key] as { lat: number; lon: number } | null | undefined) ?? null}
          onChange={(v) => emit(schema.key, v)}
        />
      );
    case "slider":
      return (
        <SettingSlider
          key={schema.key} label={schema.label}
          min={schema.min} max={schema.max} step={schema.step}
          value={(settings[schema.key] as number | undefined) ?? schema.defaultValue}
          onChange={(v) => emit(schema.key, v)}
        />
      );
    case "select":
      return (
        <SettingSelect
          key={schema.key} label={schema.label} options={schema.options}
          value={(settings[schema.key] as string | number | undefined) ?? schema.defaultValue}
          onChange={(v) => emit(schema.key, v)}
        />
      );
    case "toggle":
      return (
        <SettingToggle
          key={schema.key} label={schema.label}
          value={(settings[schema.key] as boolean | undefined) ?? schema.defaultValue}
          onChange={(v) => emit(schema.key, v)}
        />
      );
  }
}

export function SettingsDrawer(p: Props) {
  const emit = (key: string, v: unknown) => p.onChange({ ...p.settings, [key]: v });

  return (
    <Dialog.Root open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content
          className="fixed z-50 right-0 top-0 h-full w-[min(420px,100vw)]
                     bg-[var(--shell-1)] border-l border-[var(--shell-border)] shadow-2xl
                     flex flex-col"
        >
          <header className="p-4 border-b border-[var(--shell-border)] flex items-start justify-between">
            <div>
              <Dialog.Title className="text-sm font-semibold">{p.card.name}</Dialog.Title>
              <p className="text-[11px] text-[var(--shell-text-muted)] font-mono">{p.card.id}</p>
            </div>
            <Dialog.Close aria-label="Close" className="text-[var(--shell-text-muted)] hover:text-[var(--shell-text)]">✕</Dialog.Close>
          </header>
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <section className="space-y-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
                Inputs
              </div>
              {p.card.settingsSchema.map((s) =>
                renderField(s, { projectId: p.projectId, globalActiveQuestion: p.globalActiveQuestion, settings: p.settings, emit })
              )}
            </section>
            <section>
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)] mb-1">
                Method
              </div>
              <p className="text-[12px] leading-snug">{p.card.whatItDoes}</p>
              <p className="text-[11px] text-[var(--shell-text-muted)] mt-1">
                {p.card.sourceInspiration}
              </p>
            </section>
          </div>
          <footer className="p-3 border-t border-[var(--shell-border)] flex justify-end gap-2">
            <button
              onClick={p.onRecompute}
              className="rounded-md bg-[var(--accent-1,#0EA5E9)] text-white text-[12px] font-semibold py-1.5 px-3"
            >
              Re-compute
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 3: Run test**

Run: `npx vitest run tests/analyses/settings-drawer.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 4: Commit**

```bash
git add components/analyses/settings-drawer.tsx tests/analyses/settings-drawer.test.tsx
git commit -m "feat(analyses): schema-driven SettingsDrawer with 6 input types (M7.2 W0)"
```

---

### Task 18: `AnalysesList` + `AnalysesListItem` (no drag-reorder in Wave 0)

**Files:**
- Create: `components/analyses/analyses-list-item.tsx`
- Create: `components/analyses/analyses-list.tsx`
- Test: `tests/analyses/analyses-list.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/analyses/analyses-list.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalysesList } from "@/components/analyses/analyses-list";
import type { AnalysisListItem } from "@/lib/analyses/types";

const items: AnalysisListItem[] = [
  { cardId: "S2_gi_star_q", settings: {}, addedAt: "2026-05-30T12:00:00Z" },
  { cardId: "S6_coverage_response", settings: {}, addedAt: "2026-05-30T12:05:00Z" },
];

describe("AnalysesList", () => {
  it("renders an empty state when items is []", () => {
    render(<AnalysesList items={[]} projectId="p1" globalActiveQuestion={null} onOpenSettings={() => {}} onRemove={() => {}} onAddClick={() => {}} />);
    expect(screen.getByText(/no spatial analyses added/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add spatial analysis/i })).toBeInTheDocument();
  });

  it("renders one row per item with card name + status", () => {
    render(<AnalysesList items={items} projectId="p1" globalActiveQuestion={null} onOpenSettings={() => {}} onRemove={() => {}} onAddClick={() => {}} />);
    expect(screen.getByText(/Hot\/Cold Spot/i)).toBeInTheDocument();
    expect(screen.getByText(/Coverage × Response/i)).toBeInTheDocument();
  });

  it("clicking the settings cog emits onOpenSettings with the cardId", async () => {
    const u = userEvent.setup();
    const onOpenSettings = vi.fn();
    render(<AnalysesList items={items} projectId="p1" globalActiveQuestion={null} onOpenSettings={onOpenSettings} onRemove={() => {}} onAddClick={() => {}} />);
    const cogs = screen.getAllByRole("button", { name: /open settings/i });
    await u.click(cogs[0]);
    expect(onOpenSettings).toHaveBeenCalledWith("S2_gi_star_q");
  });
});
```

- [ ] **Step 2: Implement `analyses-list-item.tsx`**

```tsx
// components/analyses/analyses-list-item.tsx
"use client";
import type { AnalysisListItem, SpatialCardCatalogEntry } from "@/lib/analyses/types";
import { getCardById } from "@/lib/analyses/registry";
import { Suspense } from "react";
import { getVizComponent } from "@/lib/analyses/viz-registry";

type Props = {
  item: AnalysisListItem;
  projectId: string;
  globalActiveQuestion: string | null;
  onOpenSettings: (cardId: string) => void;
  onRemove: (cardId: string) => void;
};

export function AnalysesListItem({ item, projectId, globalActiveQuestion, onOpenSettings, onRemove }: Props) {
  const card = getCardById(item.cardId) as SpatialCardCatalogEntry | undefined;
  if (!card) return null;

  const Viz = getVizComponent(card.vizComponent);
  const inheritedQ =
    (item.settings.questionKey as string | undefined) === "inherit_global" || !item.settings.questionKey
      ? globalActiveQuestion
      : (item.settings.questionKey as string);

  return (
    <article className="rounded-xl border border-[var(--shell-border)] bg-[var(--shell-1)] p-3 flex flex-col gap-2">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-[13px]">{card.name}</h3>
          <p className="text-[11px] text-[var(--shell-text-muted)] font-mono">
            {card.id} {inheritedQ ? `· Q: ${inheritedQ}` : "· no question yet"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            aria-label={`Open settings for ${card.name}`}
            onClick={() => onOpenSettings(card.id)}
            className="rounded-md p-1 text-[var(--shell-text-muted)] hover:bg-[var(--shell-2)] hover:text-[var(--shell-text)]"
          >
            ⚙
          </button>
          <button
            aria-label={`Remove ${card.name}`}
            onClick={() => {
              if (confirm(`Remove "${card.name}" from the Analyze tab?`)) onRemove(card.id);
            }}
            className="rounded-md p-1 text-[var(--shell-text-muted)] hover:bg-[var(--shell-2)] hover:text-red-400"
          >
            ✕
          </button>
        </div>
      </header>
      <div className="min-h-[80px]">
        {Viz ? (
          <Suspense fallback={<div className="text-[11px] text-[var(--shell-text-muted)]">Loading…</div>}>
            <Viz projectId={projectId} settings={item.settings} />
          </Suspense>
        ) : (
          <div className="text-[11px] text-[var(--shell-text-muted)]">No viz registered.</div>
        )}
      </div>
    </article>
  );
}
```

- [ ] **Step 3: Implement `analyses-list.tsx`**

```tsx
// components/analyses/analyses-list.tsx
"use client";
import type { AnalysisListItem } from "@/lib/analyses/types";
import { AnalysesListItem } from "./analyses-list-item";

type Props = {
  items: AnalysisListItem[];
  projectId: string;
  globalActiveQuestion: string | null;
  onAddClick: () => void;
  onOpenSettings: (cardId: string) => void;
  onRemove: (cardId: string) => void;
};

export function AnalysesList({ items, projectId, globalActiveQuestion, onAddClick, onOpenSettings, onRemove }: Props) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Spatial analyses</h2>
        <button
          onClick={onAddClick}
          className="rounded-md bg-[var(--accent-1,#0EA5E9)] text-white text-[12px] font-semibold py-1.5 px-3"
          aria-label="Add spatial analysis"
        >
          + Add spatial analysis
        </button>
      </div>
      {items.length === 0 ? (
        <div className="flex-1 grid place-items-center rounded-xl border border-dashed border-[var(--shell-border)] p-6 text-center">
          <div>
            <p className="text-[13px] mb-2">No spatial analyses added yet.</p>
            <p className="text-[11.5px] text-[var(--shell-text-muted)] mb-3">
              Browse the Spatial Analysis Toolbox to add hot-spot maps, autocorrelation, distance-decay and more.
            </p>
            <button
              onClick={onAddClick}
              className="rounded-md bg-[var(--accent-1,#0EA5E9)] text-white text-[12px] font-semibold py-1.5 px-3"
            >
              Open the toolbox
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-auto">
          {items.map((item) => (
            <AnalysesListItem
              key={`${item.cardId}-${item.addedAt}`}
              item={item}
              projectId={projectId}
              globalActiveQuestion={globalActiveQuestion}
              onOpenSettings={onOpenSettings}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/analyses/analyses-list.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add components/analyses/analyses-list.tsx components/analyses/analyses-list-item.tsx tests/analyses/analyses-list.test.tsx
git commit -m "feat(analyses): AnalysesList + AnalysesListItem with empty state (M7.2 W0)"
```

---

### Task 19: API route — added-analyses persistence

**Files:**
- Create: `app/api/projects/[projectId]/added-analyses/route.ts`
- Create: `hooks/use-added-analyses.ts`

- [ ] **Step 1: Implement the route**

```ts
// app/api/projects/[projectId]/added-analyses/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { AnalysisListItem } from "@/lib/analyses/types";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data, error } = await sb
    .from("user_view_state")
    .select("added_analyses, active_question_key")
    .eq("project_id", projectId)
    .eq("user_id", u.user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    items: (data?.added_analyses ?? []) as AnalysisListItem[],
    activeQuestion: data?.active_question_key ?? null,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await req.json()) as { cardId: string; settings?: Record<string, unknown> };
  if (!body?.cardId) return NextResponse.json({ error: "cardId required" }, { status: 400 });

  // Upsert user_view_state row + append the new item.
  const { data: existing } = await sb
    .from("user_view_state")
    .select("added_analyses")
    .eq("project_id", projectId)
    .eq("user_id", u.user.id)
    .maybeSingle();

  const current = (existing?.added_analyses ?? []) as AnalysisListItem[];
  const next: AnalysisListItem = {
    cardId: body.cardId,
    settings: body.settings ?? {},
    addedAt: new Date().toISOString(),
  };
  const merged = [...current, next];

  const { error } = await sb
    .from("user_view_state")
    .upsert(
      { user_id: u.user.id, project_id: projectId, added_analyses: merged },
      { onConflict: "user_id,project_id" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit log
  await sb.from("analysis_versions").insert({
    project_id: projectId, card_id: "add_analysis", user_id: u.user.id,
    payload: { addedCardId: body.cardId },
  });

  return NextResponse.json({ items: merged });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const url = new URL(req.url);
  const cardId = url.searchParams.get("cardId");
  const addedAt = url.searchParams.get("addedAt");
  if (!cardId || !addedAt) return NextResponse.json({ error: "cardId+addedAt required" }, { status: 400 });

  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: existing } = await sb
    .from("user_view_state")
    .select("added_analyses")
    .eq("project_id", projectId)
    .eq("user_id", u.user.id)
    .maybeSingle();

  const filtered = ((existing?.added_analyses ?? []) as AnalysisListItem[])
    .filter((i) => !(i.cardId === cardId && i.addedAt === addedAt));

  const { error } = await sb
    .from("user_view_state")
    .upsert(
      { user_id: u.user.id, project_id: projectId, added_analyses: filtered },
      { onConflict: "user_id,project_id" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sb.from("analysis_versions").insert({
    project_id: projectId, card_id: "remove_analysis", user_id: u.user.id,
    payload: { removedCardId: cardId, removedAddedAt: addedAt },
  });

  return NextResponse.json({ items: filtered });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = (await req.json()) as { cardId: string; addedAt: string; settings: Record<string, unknown> };
  if (!body?.cardId || !body?.addedAt) {
    return NextResponse.json({ error: "cardId+addedAt required" }, { status: 400 });
  }

  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: existing } = await sb
    .from("user_view_state")
    .select("added_analyses")
    .eq("project_id", projectId)
    .eq("user_id", u.user.id)
    .maybeSingle();

  const items = ((existing?.added_analyses ?? []) as AnalysisListItem[]).map((i) =>
    i.cardId === body.cardId && i.addedAt === body.addedAt
      ? { ...i, settings: body.settings }
      : i,
  );

  const { error } = await sb
    .from("user_view_state")
    .upsert(
      { user_id: u.user.id, project_id: projectId, added_analyses: items },
      { onConflict: "user_id,project_id" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items });
}
```

- [ ] **Step 2: Implement the React hook**

```ts
// hooks/use-added-analyses.ts
"use client";
import { useCallback, useEffect, useState } from "react";
import type { AnalysisListItem } from "@/lib/analyses/types";

type State = {
  items: AnalysisListItem[];
  activeQuestion: string | null;
  loading: boolean;
  error: string | null;
};

export function useAddedAnalyses(projectId: string | undefined) {
  const [state, setState] = useState<State>({ items: [], activeQuestion: null, loading: true, error: null });

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`/api/projects/${projectId}/added-analyses`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { items: AnalysisListItem[]; activeQuestion: string | null };
      setState({ items: json.items, activeQuestion: json.activeQuestion, loading: false, error: null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const add = useCallback(async (cardId: string, settings: Record<string, unknown> = {}) => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/added-analyses`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId, settings }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { items: AnalysisListItem[] };
    setState((s) => ({ ...s, items: json.items }));
  }, [projectId]);

  const remove = useCallback(async (cardId: string, addedAt: string) => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/added-analyses?cardId=${encodeURIComponent(cardId)}&addedAt=${encodeURIComponent(addedAt)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { items: AnalysisListItem[] };
    setState((s) => ({ ...s, items: json.items }));
  }, [projectId]);

  const updateSettings = useCallback(async (cardId: string, addedAt: string, settings: Record<string, unknown>) => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/added-analyses`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId, addedAt, settings }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { items: AnalysisListItem[] };
    setState((s) => ({ ...s, items: json.items }));
  }, [projectId]);

  return { ...state, refresh, add, remove, updateSettings };
}
```

- [ ] **Step 3: Lint + type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/projects/\[projectId\]/added-analyses/route.ts hooks/use-added-analyses.ts
git commit -m "feat(api): added-analyses CRUD + use-added-analyses hook (M7.2 W0)"
```

---

### Task 20: Wire the modal + drawer + list into the Analyze tab

**Files:**
- Modify: `components/desktop/right-rail.tsx` — replace the Analyze tab body

- [ ] **Step 1: Read the current right-rail and find the Analyze tab block**

Run: `grep -n "Analyze" components/desktop/right-rail.tsx`
Expected: locates the existing Analyze TabsContent block.

- [ ] **Step 2: Replace the Analyze tab body with the new container**

In `components/desktop/right-rail.tsx`, replace the JSX inside `<TabsContent value="analyze">` with:

```tsx
{/* ── Analyze tab ── */}
<TabsContent value="analyze" className="data-[state=inactive]:hidden">
  <AnalyzeTabContainer projectId={projectId} />
</TabsContent>
```

Then add this container at the top of the file (after imports):

```tsx
// Inline in components/desktop/right-rail.tsx (or split into a sibling file)
import { useState } from "react";
import { AddAnalysisModal } from "@/components/analyses/add-analysis-modal";
import { AnalysesList } from "@/components/analyses/analyses-list";
import { SettingsDrawer } from "@/components/analyses/settings-drawer";
import { useAddedAnalyses } from "@/hooks/use-added-analyses";
import { getCardById } from "@/lib/analyses/registry";
import type { SpatialCardCatalogEntry, AnalysisListItem } from "@/lib/analyses/types";

function AnalyzeTabContainer({ projectId }: { projectId: string }) {
  const { items, activeQuestion, add, remove, updateSettings } = useAddedAnalyses(projectId);
  const [modalOpen, setModalOpen] = useState(false);
  const [settingsFor, setSettingsFor] = useState<AnalysisListItem | null>(null);

  const settingsCard = settingsFor ? (getCardById(settingsFor.cardId) as SpatialCardCatalogEntry | undefined) : undefined;

  return (
    <div className="h-full p-3">
      <AnalysesList
        items={items}
        projectId={projectId}
        globalActiveQuestion={activeQuestion}
        onAddClick={() => setModalOpen(true)}
        onOpenSettings={(cardId) => {
          const item = items.find((i) => i.cardId === cardId);
          if (item) setSettingsFor(item);
        }}
        onRemove={(cardId) => {
          const item = items.find((i) => i.cardId === cardId);
          if (item) remove(item.cardId, item.addedAt);
        }}
      />
      <AddAnalysisModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onAdd={(cardId) => { add(cardId); setModalOpen(false); }}
      />
      {settingsFor && settingsCard && (
        <SettingsDrawer
          open
          card={settingsCard}
          projectId={projectId}
          globalActiveQuestion={activeQuestion}
          settings={settingsFor.settings}
          onChange={(patch) => {
            setSettingsFor((cur) => cur ? { ...cur, settings: { ...cur.settings, ...patch } } : cur);
            void updateSettings(settingsFor.cardId, settingsFor.addedAt, { ...settingsFor.settings, ...patch });
          }}
          onClose={() => setSettingsFor(null)}
          onRecompute={() => {/* Wave-1: triggers dispatcher refresh */}}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check + lint**

```bash
npx tsc --noEmit
npm run lint
```
Both expected to pass.

- [ ] **Step 4: Commit**

```bash
git add components/desktop/right-rail.tsx
git commit -m "feat(analyses): wire Add-Analysis modal + Analyses list + Settings drawer into Analyze tab (M7.2 W0)"
```

---

### Task 21: E2E smoke test (Playwright)

**Files:**
- Create: `e2e/spatial-toolbox.spec.ts`

- [ ] **Step 1: Write the smoke spec**

```ts
// e2e/spatial-toolbox.spec.ts
import { test, expect } from "@playwright/test";

const PROJECT_URL = process.env.FS_E2E_PROJECT_URL
  ?? "http://localhost:3000/p/40971687-2585-4391-8650-303483900517/map";

test.describe("Spatial Analysis Toolbox (Wave 0)", () => {
  test("admin opens Analyze tab → Add modal → picks a card → row appears in list → opens settings", async ({ page }) => {
    await page.goto(PROJECT_URL);
    await page.getByRole("tab", { name: /Analyze/ }).click();

    await page.getByRole("button", { name: /Add spatial analysis/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Default toolbox = Symbology; click "Mapping Clusters"
    await page.getByRole("tab", { name: /Mapping Clusters/ }).click();
    await expect(page.getByText(/Hot\/Cold Spot/i)).toBeVisible();

    // Add S2
    await page.getByRole("button", { name: /Add Hot\/Cold Spot.* to Analyze tab/i }).first().click();

    // Row appears in the list
    await expect(page.getByText(/^S2_gi_star_q$/)).toBeVisible();

    // Open settings → drawer shows FDR alpha + permutations
    await page.getByRole("button", { name: /Open settings for Hot\/Cold Spot/i }).click();
    await expect(page.getByLabel(/FDR alpha/i)).toBeVisible();
    await expect(page.getByText(/Permutations/i)).toBeVisible();
  });

  test("v2 toolboxes are visible but greyed (aria-disabled)", async ({ page }) => {
    await page.goto(PROJECT_URL);
    await page.getByRole("tab", { name: /Analyze/ }).click();
    await page.getByRole("button", { name: /Add spatial analysis/i }).click();

    const v2 = page.getByRole("tab", { name: /Space-Time/ });
    await expect(v2).toBeVisible();
    await expect(v2).toHaveAttribute("aria-disabled", "true");
  });
});
```

- [ ] **Step 2: Commit (do NOT run yet — needs the prod-applied migrations from Task 22 to load `user_view_state`)**

```bash
git add e2e/spatial-toolbox.spec.ts
git commit -m "test(e2e): spatial-toolbox smoke (M7.2 W0)"
```

---

### Task 22: Apply migrations 020–022 to production (gated on explicit user authorization)

This is the deploy step. Per the project's strict migration policy:

- [ ] **Step 1: Confirm migration files compile (dry-run via Supabase CLI if available)**

Run: `ls supabase/migrations/02*.sql`
Expected: `020_project_spatial_weights.sql 021_user_view_state_added_analyses.sql 022_dashboard_cache_spatial_cards.sql`

- [ ] **Step 2: Ask the user the gated question**

> "Wave 0 ships 3 migrations. Apply them to **fieldSurvey_prod (id: ykssihpinzbgmpylqtjl)** now? Re-confirm with the literal phrase 'yes, apply migration to prod' so I can run them via the Supabase MCP."

Wait for the user's literal confirmation. Do NOT proceed otherwise.

- [ ] **Step 3: On confirmation, apply each migration**

Apply in order (`020`, then `021`, then `022`) via `mcp__supabase__apply_migration`, each as a separate call. Verify `mcp__supabase__list_migrations` shows them after each.

- [ ] **Step 4: Verify the `added_analyses` column is present**

Run a one-shot SQL via MCP: `select column_name, data_type from information_schema.columns where table_name = 'user_view_state' and column_name in ('active_question_key','filter_chip','card_question_overrides','added_analyses');`
Expected: 4 rows.

- [ ] **Step 5: No commit needed — migrations are infra, not code.**

---

### Task 23: Run full Vitest + Playwright suite + push

- [ ] **Step 1: Run Vitest**

```bash
npx vitest run tests/analyses/
```
Expected: all spatial-toolbox tests PASS, plus the prior 37 analyses tests still pass.

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Lint**

```bash
npm run lint
```
Expected: 0 errors.

- [ ] **Step 4: Build**

```bash
npm run build
```
Expected: success. (The `prebuild` hook re-runs `build:previews`; verify it succeeds and the CDN copies are present.)

- [ ] **Step 5: Run Playwright smoke (after migrations applied)**

```bash
npm run e2e -- e2e/spatial-toolbox.spec.ts
```
Expected: 2 tests PASS.

- [ ] **Step 6: Push to origin/main**

```bash
git push origin main
```

- [ ] **Step 7: Watch Vercel auto-deploy**

Wait for `fieldsurvey-alpha.vercel.app` to redeploy `main`. Hard-refresh and verify:
- Analyze tab shows the new empty state.
- "+ Add spatial analysis" opens the modal.
- All 5 v1 toolboxes show, 3 v2 toolboxes are greyed.
- Adding a card from Mapping Clusters → row appears in list → opening settings shows the drawer → all input types render.

---

## Self-Review

**Spec coverage:**
- ✓ §1.1–1.3 pipeline + global selector + weights matrix — schema in Task 1; UI in Tasks 12–20
- ✓ §1.4 cache key contract — Wave 1+, no Wave 0 task required
- ✓ §1.6 performance budget — N/A Wave 0 (no compute)
- ✓ §2 A0 colorizer — placeholder catalog entry (Task 6) + placeholder viz (Task 8); real impl in Wave 1
- ✓ §3 S1–S8 — catalog entries (Tasks 6–7) + placeholder viz (Task 8)
- ✓ §4 universal chrome — new AwaitingDataPanel reasons (Task 8)
- ✓ §5 DB changes — migrations 020, 021, 022 (Tasks 1–3); 023 RPCs deferred to Wave 1 (only A0 + S6 use Postgres compute, both Wave-1 cards)
- ✓ §6 API contracts — Wave 0 implements added-analyses CRUD (Task 19); dispatcher route shape is Wave-1
- ✓ §7 testing fixtures — Wave-1+ (no fixtures needed for Wave-0 placeholder)
- ✓ §11.2 toolbox structure — `lib/analyses/toolboxes.ts` (Task 5)
- ✓ §11.4 modal layout — `add-analysis-modal.tsx` (Task 12)
- ✓ §11.5 card schema — types (Task 4) + 9 entries (Tasks 6–7)
- ✓ §11.6 list state machine — list-item shows status badge via card + suspense (Task 18); full state machine (loading/ready/awaiting_data/error/stale) lands when compute exists in Wave 1+
- ✓ §11.7 settings drawer — schema-driven router (Task 17) + 6 input types (Tasks 15–16)
- ✓ §11.8 preview images — build script + 5 downloads + 4 custom + 3 v2 SVGs (Tasks 9, 10, 11)
- ✓ §11.9 entry points — `+ Add` button (Task 18) + empty state (Task 18). ⌘K palette deferred to Wave 1.
- ✓ §11.10 persistence — migration 021 (Task 2) + API + hook (Task 19)
- ✓ §11.11 accessibility — `aria-label`s on cards (Task 14) + `role="tab"` + `aria-selected` (Task 13) + Dialog focus trap from Radix
- ✓ §11.12 telemetry — `analysis_versions` insert on add/remove (Task 19); migration 022 widens the CHECK to allow `add_analysis`/`remove_analysis` ids

**Placeholder scan:** none — every step has either runnable code, a complete SQL block, or a precise CLI command. No "TODO" or "TBD" tokens.

**Type consistency:**
- `SpatialCardCatalogEntry` defined in Task 4, used identically in Tasks 6, 7, 8, 12, 14, 17, 18, 20.
- `AnalysisListItem` defined in Task 4, used identically in Tasks 18, 19, 20.
- `SettingSchema` discriminated union in Task 4 matches the 6 cases handled in Task 17's `renderField`.
- `useAddedAnalyses` hook signature in Task 19 matches the call sites in Task 20.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-30-spatial-toolbox-wave-0.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review between tasks (spec-compliance then code-quality), fast iteration.

**2. Inline Execution** — Execute tasks in this session, batch with checkpoints for review.

Which approach?
