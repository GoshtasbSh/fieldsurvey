# Medium Analyses — M7.4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Implement 9 medium-tier analysis cards (A3, A6, A7, A12, A35, A41, A42, A43, A46) with full SpatialCardCatalogEntry registry entries, animated SVG previews, real compute (Python sidecar + TypeScript), and structured result display panels.

**Architecture:**
- Same pattern as S1–S8 (M7.3): registry → modal → settings drawer → dispatcher → compute → result panel
- New ToolboxSlugs: `"survey_response"` (A3/A6/A7/A46) and `"quality_bias"` (A12/A35/A41/A42/A43)
- Python sidecar (proxima_app env): A6 (n-grams), A35 (straight-line), A43 (raking), A46 (segment diff)
- TypeScript server-side (POSTGRES_DISPATCH): A3, A7, A12, A41, A42
- Animated SVGs via SMIL `<animate>` — work universally in `<img>` tags

**Tech Stack:** Next.js 15, TypeScript strict, FastAPI sidecar (proxima_app Python 3.13), Vitest, pytest

---

## File map

**Modified:**
- `lib/analyses/types.ts` — add `"survey_response" | "quality_bias"` to ToolboxSlug
- `lib/analyses/registry.ts` — upgrade 9 cards to SpatialCardCatalogEntry with full fields
- `components/analyses/toolbox-left-rail.tsx` — add 2 new toolbox sections
- `sidecar/app.py` — register 4 new routers
- `app/api/projects/[projectId]/analyses/[cardId]/route.ts` — add 9 handlers
- `lib/queries/sidecar-inputs.ts` — add 4 sidecar builders + 5 TS handlers

**New:**
- `public/analyses-previews/A3_multiselect_upset.svg` (animated)
- `public/analyses-previews/A6_text_ngrams.svg` (animated)
- `public/analyses-previews/A7_weighted_vs_unweighted.svg` (animated)
- `public/analyses-previews/A12_choropleth_agg.svg` (animated)
- `public/analyses-previews/A35_straight_line.svg` (animated)
- `public/analyses-previews/A41_whos_missing.svg` (animated)
- `public/analyses-previews/A42_lorenz.svg` (animated)
- `public/analyses-previews/A43_raking_diag.svg` (animated)
- `public/analyses-previews/A46_segment_diff.svg` (animated)
- `sidecar/routers/a6_ngrams.py`
- `sidecar/routers/a35_straight_line.py`
- `sidecar/routers/a43_raking.py`
- `sidecar/routers/a46_segment_diff.py`
- `sidecar/tests/test_medium_routers.py`
- `lib/queries/medium-analyses.ts` (A3, A7, A12, A41, A42 TypeScript handlers)
- `components/analyses/results/a3-result.tsx`
- `components/analyses/results/a6-result.tsx`
- `components/analyses/results/a7-result.tsx`
- `components/analyses/results/a12-result.tsx`
- `components/analyses/results/a35-result.tsx`
- `components/analyses/results/a41-result.tsx`
- `components/analyses/results/a42-result.tsx`
- `components/analyses/results/a43-result.tsx`
- `components/analyses/results/a46-result.tsx`

---

## Task 1 — Types + Toolbox UI

**Files:** `lib/analyses/types.ts`, `components/analyses/toolbox-left-rail.tsx`

- [ ] Add to `ToolboxSlug` in `types.ts`:
```ts
| "survey_response"
| "quality_bias"
```

- [ ] Read `components/analyses/toolbox-left-rail.tsx`. Add the two new toolboxes to the toolbox list alongside existing ones. Each toolbox entry needs a label and icon (emoji is fine). Pattern: look at how `mapping_clusters` etc. are rendered and add same structure for:
  - `survey_response` → label "Survey Response" icon "📊"
  - `quality_bias` → label "Quality & Bias" icon "🔍"

- [ ] `npx tsc --noEmit 2>&1 | head -5` → 0 errors
- [ ] `npx vitest run --reporter=verbose 2>&1 | tail -3`
- [ ] Commit: `feat(types): add survey_response + quality_bias toolbox slugs`

---

## Task 2 — Animated SVG previews (survey_response group: A3/A6/A7/A46)

**Files:** 4 new SVGs in `public/analyses-previews/`

Create each SVG at 320×180px with dark background `#1a1a2e`, using SMIL `<animate>` for animation.

- [ ] **A3_multiselect_upset.svg** — UpSet-style bars: 4 set-size bars on left, 3 intersection bars on right, bars grow from 0 width using `<animate attributeName="width" from="0" to="...">`. Color: `#60a5fa`.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="#1a1a2e"/>
  <text x="10" y="20" fill="#94a3b8" font-size="11" font-family="monospace">Multi-select Co-occurrence</text>
  <!-- Set bars (left) -->
  <rect x="10" y="35" height="18" fill="#60a5fa" rx="2">
    <animate attributeName="width" from="0" to="90" dur="0.6s" fill="freeze"/>
  </rect>
  <rect x="10" y="60" height="18" fill="#60a5fa" rx="2">
    <animate attributeName="width" from="0" to="70" dur="0.7s" begin="0.1s" fill="freeze"/>
  </rect>
  <rect x="10" y="85" height="18" fill="#60a5fa" rx="2">
    <animate attributeName="width" from="0" to="55" dur="0.7s" begin="0.2s" fill="freeze"/>
  </rect>
  <rect x="10" y="110" height="18" fill="#60a5fa" rx="2">
    <animate attributeName="width" from="0" to="40" dur="0.7s" begin="0.3s" fill="freeze"/>
  </rect>
  <!-- Intersection bars (right) -->
  <rect x="160" y="35" height="18" fill="#f472b6" rx="2">
    <animate attributeName="width" from="0" to="110" dur="0.6s" begin="0.5s" fill="freeze"/>
  </rect>
  <rect x="160" y="60" height="18" fill="#f472b6" rx="2">
    <animate attributeName="width" from="0" to="75" dur="0.6s" begin="0.6s" fill="freeze"/>
  </rect>
  <rect x="160" y="85" height="18" fill="#f472b6" rx="2">
    <animate attributeName="width" from="0" to="45" dur="0.6s" begin="0.7s" fill="freeze"/>
  </rect>
  <text x="10" y="145" fill="#94a3b8" font-size="9" font-family="monospace">Sets</text>
  <text x="160" y="145" fill="#94a3b8" font-size="9" font-family="monospace">Intersections</text>
</svg>
```

- [ ] **A6_text_ngrams.svg** — Horizontal bars of top terms, bars slide in from left:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="#1a1a2e"/>
  <text x="10" y="18" fill="#94a3b8" font-size="11" font-family="monospace">Top N-grams</text>
  <text x="10" y="38" fill="#e2e8f0" font-size="9" font-family="monospace">clean water</text>
  <rect x="90" y="27" height="13" fill="#34d399" rx="2"><animate attributeName="width" from="0" to="180" dur="0.5s" fill="freeze"/></rect>
  <text x="10" y="58" fill="#e2e8f0" font-size="9" font-family="monospace">road safety</text>
  <rect x="90" y="47" height="13" fill="#34d399" rx="2"><animate attributeName="width" from="0" to="140" dur="0.5s" begin="0.1s" fill="freeze"/></rect>
  <text x="10" y="78" fill="#e2e8f0" font-size="9" font-family="monospace">public park</text>
  <rect x="90" y="67" height="13" fill="#34d399" rx="2"><animate attributeName="width" from="0" to="110" dur="0.5s" begin="0.2s" fill="freeze"/></rect>
  <text x="10" y="98" fill="#e2e8f0" font-size="9" font-family="monospace">more jobs</text>
  <rect x="90" y="87" height="13" fill="#34d399" rx="2"><animate attributeName="width" from="0" to="85" dur="0.5s" begin="0.3s" fill="freeze"/></rect>
  <text x="10" y="118" fill="#e2e8f0" font-size="9" font-family="monospace">better schools</text>
  <rect x="90" y="107" height="13" fill="#34d399" rx="2"><animate attributeName="width" from="0" to="60" dur="0.5s" begin="0.4s" fill="freeze"/></rect>
  <text x="10" y="165" fill="#64748b" font-size="8" font-family="monospace">n-gram frequency · stopwords removed</text>
</svg>
```

- [ ] **A7_weighted_vs_unweighted.svg** — Two side-by-side bar pairs that swap between raw and weighted:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="#1a1a2e"/>
  <text x="10" y="18" fill="#94a3b8" font-size="11" font-family="monospace">Weighted vs Unweighted</text>
  <!-- Unweighted bars -->
  <rect x="20" y="40" width="18" fill="#60a5fa" rx="2"><animate attributeName="height" from="0" to="80" dur="0.5s" fill="freeze"/><animate attributeName="y" from="120" to="40" dur="0.5s" fill="freeze"/></rect>
  <rect x="50" y="60" width="18" fill="#60a5fa" rx="2"><animate attributeName="height" from="0" to="60" dur="0.5s" begin="0.1s" fill="freeze"/><animate attributeName="y" from="120" to="60" dur="0.5s" begin="0.1s" fill="freeze"/></rect>
  <rect x="80" y="75" width="18" fill="#60a5fa" rx="2"><animate attributeName="height" from="0" to="45" dur="0.5s" begin="0.2s" fill="freeze"/><animate attributeName="y" from="120" to="75" dur="0.5s" begin="0.2s" fill="freeze"/></rect>
  <!-- Weighted bars -->
  <rect x="170" y="50" width="18" fill="#f59e0b" rx="2"><animate attributeName="height" from="0" to="70" dur="0.5s" begin="0.4s" fill="freeze"/><animate attributeName="y" from="120" to="50" dur="0.5s" begin="0.4s" fill="freeze"/></rect>
  <rect x="200" y="45" width="18" fill="#f59e0b" rx="2"><animate attributeName="height" from="0" to="75" dur="0.5s" begin="0.5s" fill="freeze"/><animate attributeName="y" from="120" to="45" dur="0.5s" begin="0.5s" fill="freeze"/></rect>
  <rect x="230" y="65" width="18" fill="#f59e0b" rx="2"><animate attributeName="height" from="0" to="55" dur="0.5s" begin="0.6s" fill="freeze"/><animate attributeName="y" from="120" to="65" dur="0.5s" begin="0.6s" fill="freeze"/></rect>
  <text x="20" y="140" fill="#60a5fa" font-size="9" font-family="monospace">Raw</text>
  <text x="170" y="140" fill="#f59e0b" font-size="9" font-family="monospace">Post-stratified</text>
  <line x1="150" y1="30" x2="150" y2="130" stroke="#334155" stroke-width="1"/>
</svg>
```

- [ ] **A46_segment_diff.svg** — Sorted diff bars (positive/negative diverging):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="#1a1a2e"/>
  <text x="10" y="18" fill="#94a3b8" font-size="11" font-family="monospace">Segment Differences (FDR)</text>
  <line x1="160" y1="28" x2="160" y2="160" stroke="#334155" stroke-width="1"/>
  <!-- positive diffs -->
  <rect x="160" y="33" height="14" fill="#34d399" rx="2"><animate attributeName="width" from="0" to="95" dur="0.5s" fill="freeze"/></rect>
  <rect x="160" y="52" height="14" fill="#34d399" rx="2"><animate attributeName="width" from="0" to="72" dur="0.5s" begin="0.1s" fill="freeze"/></rect>
  <rect x="160" y="71" height="14" fill="#34d399" rx="2"><animate attributeName="width" from="0" to="50" dur="0.5s" begin="0.2s" fill="freeze"/></rect>
  <!-- negative diffs -->
  <rect height="14" fill="#f87171" rx="2">
    <animate attributeName="x" from="160" to="80" dur="0.5s" begin="0.3s" fill="freeze"/>
    <animate attributeName="y" from="33" to="93" dur="0s" fill="freeze"/>
    <animate attributeName="width" from="0" to="80" dur="0.5s" begin="0.3s" fill="freeze"/>
  </rect>
  <rect height="14" fill="#f87171" rx="2">
    <animate attributeName="x" from="160" to="105" dur="0.5s" begin="0.4s" fill="freeze"/>
    <animate attributeName="y" from="33" to="112" dur="0s" fill="freeze"/>
    <animate attributeName="width" from="0" to="55" dur="0.5s" begin="0.4s" fill="freeze"/>
  </rect>
  <text x="10" y="170" fill="#64748b" font-size="8" font-family="monospace">p_fdr &lt; 0.05 · Mann-Whitney U</text>
</svg>
```

- [ ] Commit: `feat(previews): animated SVG previews for A3/A6/A7/A46`

---

## Task 3 — Animated SVG previews (quality_bias group: A12/A35/A41/A42/A43)

- [ ] **A12_choropleth_agg.svg** — Grid cells filling with color:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="#1a1a2e"/>
  <text x="10" y="18" fill="#94a3b8" font-size="11" font-family="monospace">Choropleth Aggregation</text>
  <!-- 4x3 grid of cells with staggered color fill -->
  <rect x="20" y="30" width="60" height="40" rx="3" fill="#1e3a5f"><animate attributeName="fill" from="#1e3a5f" to="#1d4ed8" dur="0.4s" begin="0.0s" fill="freeze"/></rect>
  <rect x="85" y="30" width="60" height="40" rx="3" fill="#1e3a5f"><animate attributeName="fill" from="#1e3a5f" to="#3b82f6" dur="0.4s" begin="0.1s" fill="freeze"/></rect>
  <rect x="150" y="30" width="60" height="40" rx="3" fill="#1e3a5f"><animate attributeName="fill" from="#1e3a5f" to="#60a5fa" dur="0.4s" begin="0.2s" fill="freeze"/></rect>
  <rect x="215" y="30" width="60" height="40" rx="3" fill="#1e3a5f"><animate attributeName="fill" from="#1e3a5f" to="#93c5fd" dur="0.4s" begin="0.3s" fill="freeze"/></rect>
  <rect x="20" y="75" width="60" height="40" rx="3" fill="#1e3a5f"><animate attributeName="fill" from="#1e3a5f" to="#2563eb" dur="0.4s" begin="0.2s" fill="freeze"/></rect>
  <rect x="85" y="75" width="60" height="40" rx="3" fill="#1e3a5f"><animate attributeName="fill" from="#1e3a5f" to="#1d4ed8" dur="0.4s" begin="0.3s" fill="freeze"/></rect>
  <rect x="150" y="75" width="60" height="40" rx="3" fill="#1e3a5f"><animate attributeName="fill" from="#1e3a5f" to="#7dd3fc" dur="0.4s" begin="0.4s" fill="freeze"/></rect>
  <rect x="215" y="75" width="60" height="40" rx="3" fill="#1e3a5f"><animate attributeName="fill" from="#1e3a5f" to="#bfdbfe" dur="0.4s" begin="0.5s" fill="freeze"/></rect>
  <text x="10" y="165" fill="#64748b" font-size="8" font-family="monospace">points → grid cells · count or density</text>
</svg>
```

- [ ] **A35_straight_line.svg** — Response rows with identical marks pulsing red:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="#1a1a2e"/>
  <text x="10" y="18" fill="#94a3b8" font-size="11" font-family="monospace">Straight-line Detector</text>
  <!-- Normal row -->
  <rect x="10" y="30" width="8" height="8" rx="1" fill="#60a5fa"/>
  <rect x="25" y="30" width="8" height="8" rx="1" fill="#34d399"/>
  <rect x="40" y="30" width="8" height="8" rx="1" fill="#f59e0b"/>
  <rect x="55" y="30" width="8" height="8" rx="1" fill="#60a5fa"/>
  <rect x="70" y="30" width="8" height="8" rx="1" fill="#34d399"/>
  <text x="90" y="39" fill="#64748b" font-size="9" font-family="monospace">normal</text>
  <!-- Straight-line row (all same) -->
  <rect x="10" y="50" width="8" height="8" rx="1" fill="#f87171"><animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite"/></rect>
  <rect x="25" y="50" width="8" height="8" rx="1" fill="#f87171"><animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite"/></rect>
  <rect x="40" y="50" width="8" height="8" rx="1" fill="#f87171"><animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite"/></rect>
  <rect x="55" y="50" width="8" height="8" rx="1" fill="#f87171"><animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite"/></rect>
  <rect x="70" y="50" width="8" height="8" rx="1" fill="#f87171"><animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite"/></rect>
  <text x="90" y="59" fill="#f87171" font-size="9" font-family="monospace">⚠ flagged</text>
  <!-- Another normal row -->
  <rect x="10" y="70" width="8" height="8" rx="1" fill="#f59e0b"/>
  <rect x="25" y="70" width="8" height="8" rx="1" fill="#60a5fa"/>
  <rect x="40" y="70" width="8" height="8" rx="1" fill="#f59e0b"/>
  <rect x="55" y="70" width="8" height="8" rx="1" fill="#34d399"/>
  <rect x="70" y="70" width="8" height="8" rx="1" fill="#f59e0b"/>
  <text x="90" y="79" fill="#64748b" font-size="9" font-family="monospace">normal</text>
  <text x="10" y="165" fill="#64748b" font-size="8" font-family="monospace">longstring index · review, never auto-delete</text>
</svg>
```

- [ ] **A41_whos_missing.svg** — Deficit bars filling from the right:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="#1a1a2e"/>
  <text x="10" y="18" fill="#94a3b8" font-size="11" font-family="monospace">Who&apos;s Missing</text>
  <text x="10" y="38" fill="#e2e8f0" font-size="9" font-family="monospace">Zone NW</text>
  <rect x="80" y="27" height="13" fill="#475569" rx="2" width="200"/>
  <rect x="80" y="27" height="13" fill="#f87171" rx="2"><animate attributeName="width" from="0" to="160" dur="0.5s" fill="freeze"/></rect>
  <text x="10" y="58" fill="#e2e8f0" font-size="9" font-family="monospace">Zone SE</text>
  <rect x="80" y="47" height="13" fill="#475569" rx="2" width="200"/>
  <rect x="80" y="47" height="13" fill="#f87171" rx="2"><animate attributeName="width" from="0" to="110" dur="0.5s" begin="0.1s" fill="freeze"/></rect>
  <text x="10" y="78" fill="#e2e8f0" font-size="9" font-family="monospace">Zone E</text>
  <rect x="80" y="67" height="13" fill="#475569" rx="2" width="200"/>
  <rect x="80" y="67" height="13" fill="#f59e0b" rx="2"><animate attributeName="width" from="0" to="70" dur="0.5s" begin="0.2s" fill="freeze"/></rect>
  <text x="10" y="98" fill="#e2e8f0" font-size="9" font-family="monospace">Zone SW</text>
  <rect x="80" y="87" height="13" fill="#475569" rx="2" width="200"/>
  <rect x="80" y="87" height="13" fill="#34d399" rx="2"><animate attributeName="width" from="0" to="30" dur="0.5s" begin="0.3s" fill="freeze"/></rect>
  <text x="10" y="165" fill="#64748b" font-size="8" font-family="monospace">universe - responses · ranked by deficit</text>
</svg>
```

- [ ] **A42_lorenz.svg** — Lorenz curve drawing itself:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="#1a1a2e"/>
  <text x="10" y="18" fill="#94a3b8" font-size="11" font-family="monospace">Coverage Equity (Lorenz)</text>
  <!-- Axes -->
  <line x1="40" y1="20" x2="40" y2="155" stroke="#334155" stroke-width="1"/>
  <line x1="40" y1="155" x2="290" y2="155" stroke="#334155" stroke-width="1"/>
  <!-- Perfect equality line -->
  <line x1="40" y1="155" x2="290" y2="20" stroke="#334155" stroke-width="1" stroke-dasharray="4,3"/>
  <!-- Lorenz curve drawing via stroke-dashoffset -->
  <polyline points="40,155 80,148 120,138 160,122 200,100 240,72 290,20"
    fill="none" stroke="#f59e0b" stroke-width="2.5"
    stroke-dasharray="300" stroke-dashoffset="300">
    <animate attributeName="stroke-dashoffset" from="300" to="0" dur="1.2s" fill="freeze"/>
  </polyline>
  <!-- Gini label -->
  <text x="180" y="130" fill="#f59e0b" font-size="10" font-family="monospace">
    Gini
    <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.2s" fill="freeze"/>
  </text>
  <text x="10" y="170" fill="#64748b" font-size="8" font-family="monospace">cumulative coverage vs cumulative universe</text>
</svg>
```

- [ ] **A43_raking_diag.svg** — Weight histogram bars with skewed distribution:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="#1a1a2e"/>
  <text x="10" y="18" fill="#94a3b8" font-size="11" font-family="monospace">Raking Weights Diagnostic</text>
  <!-- Histogram bars with right-skew -->
  <rect x="20" y="120" width="22" height="0" fill="#a78bfa" rx="2">
    <animate attributeName="height" from="0" to="30" dur="0.4s" begin="0.0s" fill="freeze"/>
    <animate attributeName="y" from="120" to="90" dur="0.4s" begin="0.0s" fill="freeze"/>
  </rect>
  <rect x="46" y="120" width="22" height="0" fill="#a78bfa" rx="2">
    <animate attributeName="height" from="0" to="70" dur="0.4s" begin="0.05s" fill="freeze"/>
    <animate attributeName="y" from="120" to="50" dur="0.4s" begin="0.05s" fill="freeze"/>
  </rect>
  <rect x="72" y="120" width="22" height="0" fill="#a78bfa" rx="2">
    <animate attributeName="height" from="0" to="80" dur="0.4s" begin="0.1s" fill="freeze"/>
    <animate attributeName="y" from="120" to="40" dur="0.4s" begin="0.1s" fill="freeze"/>
  </rect>
  <rect x="98" y="120" width="22" height="0" fill="#a78bfa" rx="2">
    <animate attributeName="height" from="0" to="55" dur="0.4s" begin="0.15s" fill="freeze"/>
    <animate attributeName="y" from="120" to="65" dur="0.4s" begin="0.15s" fill="freeze"/>
  </rect>
  <rect x="124" y="120" width="22" height="0" fill="#a78bfa" rx="2">
    <animate attributeName="height" from="0" to="35" dur="0.4s" begin="0.2s" fill="freeze"/>
    <animate attributeName="y" from="120" to="85" dur="0.4s" begin="0.2s" fill="freeze"/>
  </rect>
  <rect x="150" y="120" width="22" height="0" fill="#f87171" rx="2">
    <animate attributeName="height" from="0" to="15" dur="0.4s" begin="0.25s" fill="freeze"/>
    <animate attributeName="y" from="120" to="105" dur="0.4s" begin="0.25s" fill="freeze"/>
  </rect>
  <rect x="176" y="120" width="22" height="0" fill="#f87171" rx="2">
    <animate attributeName="height" from="0" to="8" dur="0.4s" begin="0.3s" fill="freeze"/>
    <animate attributeName="y" from="120" to="112" dur="0.4s" begin="0.3s" fill="freeze"/>
  </rect>
  <line x1="20" y1="120" x2="210" y2="120" stroke="#334155" stroke-width="1"/>
  <text x="220" y="50" fill="#f87171" font-size="9" font-family="monospace">high</text>
  <text x="220" y="63" fill="#f87171" font-size="9" font-family="monospace">weight</text>
  <text x="220" y="80" fill="#94a3b8" font-size="8" font-family="monospace">CV, DEFF</text>
  <text x="220" y="93" fill="#94a3b8" font-size="8" font-family="monospace">eff. n</text>
  <text x="10" y="165" fill="#64748b" font-size="8" font-family="monospace">weight distribution · trim threshold shown</text>
</svg>
```

- [ ] Commit: `feat(previews): animated SVG previews for A12/A35/A41/A42/A43`

---

## Task 4 — Registry upgrades: all 9 cards to SpatialCardCatalogEntry

**File:** `lib/analyses/registry.ts`

Replace the 9 minimal stub entries with full `SpatialCardCatalogEntry` objects. Each needs: `toolbox`, `previewImage`, `questionsAnswered`, `whatItDoes`, `inputRequirements`, `settingsSchema`.

- [ ] **A3_multiselect_upset** (currently lines ~675–686, `stub: false` already):
```ts
{
  id: "A3_multiselect_upset",
  section: "response", name: "Multi-select Co-occurrence",
  short: "Which option combinations are chosen together most often?",
  requiredInputs: ["responses"],
  nMin: 30, roleGate: "member", mobileVisible: false,
  computeStrategy: "client", vizComponent: "UpSetResult",
  defaultPack: false, m7Wave1: true, stub: false,
  trustSignals: ["n", "n_options", "max_set_size"],
  pitfalls: ["Percentages sum >100 for multi-select — show counts, not %", "Intersections with n<3 are noise"],
  sourceInspiration: "Lex et al. 2014 UpSet; D3 UpSet.js",
  cardOrder: 12,
  toolbox: "survey_response",
  previewImage: { src: "/analyses-previews/A3_multiselect_upset.svg", alt: "Animated UpSet chart showing set sizes and intersection bars growing.", sourceUrl: "", sourceTitle: "Custom illustration", license: "Custom-by-us" },
  questionsAnswered: ["Which options are chosen together most often?", "Which single option is most popular?", "How many respondents chose all options?"],
  whatItDoes: "Parses comma-separated multi-select answers, counts every distinct option set, and ranks all pairwise and higher-order intersections by frequency. Returns set sizes and intersection sizes so you can see which option bundles dominate.",
  inputRequirements: ["1 multi-select question (comma-separated values)"],
  settingsSchema: [
    { key: "questionKey", type: "question_picker", label: "Question", defaultValue: "inherit_global" },
    { key: "maxSets", type: "slider", label: "Max sets shown", min: 3, max: 15, step: 1, defaultValue: 8 },
    { key: "minCount", type: "slider", label: "Min intersection size", min: 1, max: 20, step: 1, defaultValue: 2 },
  ],
},
```

- [ ] **A6_text_ngrams**:
```ts
{
  id: "A6_text_ngrams",
  section: "response", name: "Open-text N-grams",
  short: "What words and phrases appear most in open-ended answers?",
  requiredInputs: ["responses"],
  nMin: 30, roleGate: "member", mobileVisible: false,
  computeStrategy: "python_sidecar", vizComponent: "NgramResult",
  defaultPack: false, m7Wave1: true, stub: false,
  trustSignals: ["n_text", "pct_empty", "n_gram"],
  pitfalls: ["N-grams show frequency, not sentiment — pair with manual review", "Common words skew results if stopword list is wrong"],
  sourceInspiration: "Bird et al. NLTK; Manning & Schütze NLP",
  cardOrder: 15,
  toolbox: "survey_response",
  previewImage: { src: "/analyses-previews/A6_text_ngrams.svg", alt: "Animated horizontal bars showing top text n-grams by frequency.", sourceUrl: "", sourceTitle: "Custom illustration", license: "Custom-by-us" },
  questionsAnswered: ["What words and phrases appear most often?", "Are there clear recurring themes?", "What % of responses are blank?"],
  whatItDoes: "Tokenises open-text answers, removes English stopwords, and counts unigrams and bigrams. Returns a ranked frequency table with term, count, and percentage of non-empty responses. No ML required — fast and transparent.",
  inputRequirements: ["1 open-text question column"],
  settingsSchema: [
    { key: "questionKey", type: "question_picker", label: "Text question", defaultValue: "inherit_global" },
    { key: "nGram", type: "select", label: "N-gram size", options: [{ value: "both", label: "Unigrams + bigrams (default)" }, { value: "1", label: "Unigrams only" }, { value: "2", label: "Bigrams only" }], defaultValue: "both" },
    { key: "maxTerms", type: "slider", label: "Top terms to show", min: 5, max: 50, step: 5, defaultValue: 20 },
  ],
},
```

- [ ] **A7_weighted_vs_unweighted**:
```ts
{
  id: "A7_weighted_vs_unweighted",
  section: "response", name: "Weighted vs Unweighted Estimates",
  short: "How does a key answer change when groups are equally weighted?",
  requiredInputs: ["responses"],
  nMin: 50, roleGate: "member", mobileVisible: false,
  computeStrategy: "client", vizComponent: "WeightedResult",
  defaultPack: false, m7Wave1: true, stub: false,
  trustSignals: ["n_per_group", "max_weight_ratio"],
  pitfalls: ["Post-stratification only balances the chosen grouping variable — other biases remain", "Groups with n<5 produce unstable weights"],
  sourceInspiration: "Lumley survey R package; AAPOR post-stratification guidance",
  cardOrder: 16,
  toolbox: "survey_response",
  previewImage: { src: "/analyses-previews/A7_weighted_vs_unweighted.svg", alt: "Animated before/after bar chart comparing raw vs post-stratified response distributions.", sourceUrl: "", sourceTitle: "Custom illustration", license: "Custom-by-us" },
  questionsAnswered: ["How does the estimate change when groups are balanced?", "Which group is most over- or under-represented?", "Is my sample biased toward one subgroup?"],
  whatItDoes: "Takes a grouping question (e.g. age band, neighbourhood) and a response question. Computes raw group proportions, then post-stratifies so every group has equal weight. Shows raw vs weighted mean/proportion side-by-side with a delta column.",
  inputRequirements: ["1 grouping question (categorical)", "1 response question (numeric or binary)"],
  settingsSchema: [
    { key: "groupKey", type: "question_picker", label: "Grouping question", defaultValue: "inherit_global" },
    { key: "questionKey", type: "question_picker", label: "Response question", defaultValue: "inherit_global" },
  ],
},
```

- [ ] **A12_choropleth_agg**:
```ts
{
  id: "A12_choropleth_agg",
  section: "spatial", name: "Choropleth Aggregation",
  short: "How many points fell in each zone?",
  requiredInputs: ["points"],
  nMin: 30, roleGate: "member", mobileVisible: false,
  computeStrategy: "postgres", vizComponent: "ChoroplethResult",
  defaultPack: false, m7Wave1: true, stub: false,
  trustSignals: ["zone_unit", "n_per_zone_min", "n_zones"],
  pitfalls: ["MAUP: the chosen zone size drives the visual pattern", "Suppress zones with n<5 to avoid disclosing individuals"],
  sourceInspiration: "Tobler 1979; MAUP literature",
  cardOrder: 24,
  toolbox: "quality_bias",
  previewImage: { src: "/analyses-previews/A12_choropleth_agg.svg", alt: "Animated grid cells filling with blue shades to show point density per zone.", sourceUrl: "", sourceTitle: "Custom illustration", license: "Custom-by-us" },
  questionsAnswered: ["How many points fell in each zone?", "Which areas are densest vs sparse?", "Are any zones completely uncovered?"],
  whatItDoes: "Bins all geocoded field points into a regular grid (0.05°, 0.1°, or 0.2°) and counts visits per cell. Returns zone centroids + counts sorted by density, ready to render as a choropleth.",
  inputRequirements: ["Geocoded field points"],
  settingsSchema: [
    { key: "zoneUnit", type: "select", label: "Zone size", options: [{ value: "0.05", label: "~5 km cells (fine)" }, { value: "0.1", label: "~11 km cells (default)" }, { value: "0.2", label: "~22 km cells (coarse)" }], defaultValue: "0.1" },
    { key: "minN", type: "slider", label: "Suppress below n", min: 1, max: 20, step: 1, defaultValue: 3 },
  ],
},
```

- [ ] **A35_straight_line**:
```ts
{
  id: "A35_straight_line",
  section: "quality", name: "Straight-lining Detector",
  short: "Which respondents gave the same answer to every scale question?",
  requiredInputs: ["responses"],
  nMin: 30, roleGate: "admin", mobileVisible: false,
  computeStrategy: "python_sidecar", vizComponent: "StraightLineResult",
  defaultPack: false, m7Wave1: true, stub: false,
  trustSignals: ["n_questions_used", "threshold", "n_flagged"],
  pitfalls: ["Valid straight-lining exists — 'all 5s' can be honest", "Never auto-delete flagged responses"],
  sourceInspiration: "Kim et al. 2019 SSCR longstring index",
  cardOrder: 61,
  toolbox: "quality_bias",
  previewImage: { src: "/analyses-previews/A35_straight_line.svg", alt: "Animated response grid with identical-answer rows pulsing red as flagged.", sourceUrl: "", sourceTitle: "Custom illustration", license: "Custom-by-us" },
  questionsAnswered: ["Which respondents never varied their answers?", "What % of my sample shows suspicious uniformity?", "Which questions attract the most straight-lining?"],
  whatItDoes: "Computes a longstring index per respondent: the fraction of all Likert/numeric answers that are identical to the modal response. Respondents above the threshold are flagged for manual review with their score and the questions they straight-lined on.",
  inputRequirements: ["At least 3 Likert or numeric questions in the survey"],
  settingsSchema: [
    { key: "threshold", type: "slider", label: "Straight-line score threshold", min: 0.5, max: 1.0, step: 0.05, defaultValue: 0.8 },
    { key: "minQuestions", type: "slider", label: "Min questions required", min: 2, max: 10, step: 1, defaultValue: 3 },
  ],
},
```

- [ ] **A41_whos_missing**:
```ts
{
  id: "A41_whos_missing",
  section: "bias", name: "Who's Missing",
  short: "Which zones contributed far fewer responses than their share of the universe?",
  requiredInputs: ["points", "universe"],
  nMin: 30, roleGate: "member", mobileVisible: false,
  computeStrategy: "postgres", vizComponent: "WhosMissingResult",
  defaultPack: false, m7Wave1: true, stub: false,
  trustSignals: ["n_zones", "zone_unit", "min_universe_size"],
  pitfalls: ["Sparse zones inflate deficit — suppress zones with universe n<5"],
  sourceInspiration: "Pew non-response analysis practice",
  cardOrder: 71,
  toolbox: "quality_bias",
  previewImage: { src: "/analyses-previews/A41_whos_missing.svg", alt: "Animated deficit bars filling left to right, ranked from biggest to smallest under-representation.", sourceUrl: "", sourceTitle: "Custom illustration", license: "Custom-by-us" },
  questionsAnswered: ["Which zones are most under-represented in responses?", "How big is the response deficit relative to the universe?", "Where should follow-up canvassing focus?"],
  whatItDoes: "Per grid zone: computes expected response share (universe addresses / total) minus actual response share (responses / total). Ranks zones by deficit descending. Zones with universe n<5 are suppressed for stability.",
  inputRequirements: ["Universe upload", "Geocoded field points"],
  settingsSchema: [
    { key: "zoneUnit", type: "select", label: "Zone size", options: [{ value: "0.05", label: "~5 km" }, { value: "0.1", label: "~11 km (default)" }, { value: "0.2", label: "~22 km" }], defaultValue: "0.1" },
    { key: "minUniverseN", type: "slider", label: "Min universe n per zone", min: 1, max: 20, step: 1, defaultValue: 5 },
  ],
},
```

- [ ] **A42_lorenz**:
```ts
{
  id: "A42_lorenz",
  section: "bias", name: "Coverage Equity (Lorenz / Gini)",
  short: "Is coverage spread equitably across the universe, or concentrated in easy zones?",
  requiredInputs: ["points", "universe"],
  nMin: 30, roleGate: "member", mobileVisible: false,
  computeStrategy: "postgres", vizComponent: "LorenzResult",
  defaultPack: false, m7Wave1: true, stub: false,
  trustSignals: ["n_zones", "coverage_gini"],
  pitfalls: ["Legitimate prioritisation inflates Gini — contextualise with field plan", "Very few zones → noisy Gini"],
  sourceInspiration: "Quantifying Inequities in COVID-19 Vaccine Distribution (medRxiv 2021)",
  cardOrder: 72,
  toolbox: "quality_bias",
  previewImage: { src: "/analyses-previews/A42_lorenz.svg", alt: "Animated Lorenz curve drawing itself against the perfect-equality diagonal, with a Gini label appearing.", sourceUrl: "", sourceTitle: "Custom illustration", license: "Custom-by-us" },
  questionsAnswered: ["Is coverage equitably distributed across zones?", "What is the Gini coefficient of my coverage?", "How does my coverage compare to a perfectly equal canvass?"],
  whatItDoes: "Aggregates visits per grid zone, sorts zones by coverage rate, and builds the Lorenz curve (cumulative visits vs cumulative universe share). Computes the Gini coefficient as twice the area between the curve and the equality diagonal.",
  inputRequirements: ["Universe upload", "Geocoded field points"],
  settingsSchema: [
    { key: "zoneUnit", type: "select", label: "Zone size", options: [{ value: "0.05", label: "~5 km" }, { value: "0.1", label: "~11 km (default)" }, { value: "0.2", label: "~22 km" }], defaultValue: "0.1" },
  ],
},
```

- [ ] **A43_raking_diag**:
```ts
{
  id: "A43_raking_diag",
  section: "bias", name: "Raking Weights Diagnostic",
  short: "How extreme are the weights when you balance groups to equal size?",
  requiredInputs: ["responses"],
  nMin: 50, roleGate: "member", mobileVisible: false,
  computeStrategy: "python_sidecar", vizComponent: "RakingResult",
  defaultPack: false, m7Wave1: true, stub: false,
  trustSignals: ["cv", "effective_n", "max_weight", "min_weight"],
  pitfalls: ["Weights > 5× are unstable — consider collapsing small groups", "Raking one dimension doesn't fix other biases"],
  sourceInspiration: "Lumley survey R package; AAPOR weighting guidance",
  cardOrder: 73,
  toolbox: "quality_bias",
  previewImage: { src: "/analyses-previews/A43_raking_diag.svg", alt: "Animated histogram of raking weights with right-skewed bars and diagnostic stats on the right.", sourceUrl: "", sourceTitle: "Custom illustration", license: "Custom-by-us" },
  questionsAnswered: ["How extreme are my post-stratification weights?", "What is my effective sample size after weighting?", "What is the design effect (DEFF)?"],
  whatItDoes: "Takes a grouping question, computes equal-group post-stratification weights (each group weighted to 1/k of the total), and reports the weight distribution: histogram, CV (coefficient of variation), max/min ratio, effective n, and DEFF.",
  inputRequirements: ["1 grouping question (categorical, ≤20 groups)"],
  settingsSchema: [
    { key: "groupKey", type: "question_picker", label: "Grouping question", defaultValue: "inherit_global" },
    { key: "trimCap", type: "slider", label: "Weight trim cap", min: 2, max: 10, step: 0.5, defaultValue: 5 },
  ],
},
```

- [ ] **A46_segment_diff**:
```ts
{
  id: "A46_segment_diff",
  section: "compare", name: "Auto-detected Segment Differences",
  short: "Which questions show the biggest FDR-corrected gap between groups?",
  requiredInputs: ["responses"],
  nMin: 50, roleGate: "member", mobileVisible: false,
  computeStrategy: "python_sidecar", vizComponent: "SegmentDiffResult",
  defaultPack: false, m7Wave1: true, stub: false,
  trustSignals: ["n_tests", "fdr_threshold", "n_significant"],
  pitfalls: ["Multiple testing — FDR is mandatory, not optional", "Subgroup fishing is p-hacking — run once, report all"],
  sourceInspiration: "Benjamini & Hochberg 1995; Mann-Whitney U; chi-square",
  cardOrder: 82,
  toolbox: "survey_response",
  previewImage: { src: "/analyses-previews/A46_segment_diff.svg", alt: "Animated diverging bar chart showing FDR-significant segment differences sorted by effect size.", sourceUrl: "", sourceTitle: "Custom illustration", license: "Custom-by-us" },
  questionsAnswered: ["Which questions differ most between my defined groups?", "After correcting for multiple testing, which differences are real?", "How big are the effect sizes?"],
  whatItDoes: "For every question in the survey, tests whether distributions differ between user-defined groups (Mann-Whitney U for numeric; chi-square for categorical). Applies Benjamini-Hochberg FDR correction across all tests. Returns questions ranked by adjusted p-value with effect sizes.",
  inputRequirements: ["1 grouping question (categorical)", "Remaining questions are tested automatically"],
  settingsSchema: [
    { key: "groupKey", type: "question_picker", label: "Grouping question", defaultValue: "inherit_global" },
    { key: "fdrAlpha", type: "slider", label: "FDR alpha", min: 0.01, max: 0.10, step: 0.01, defaultValue: 0.05 },
    { key: "minN", type: "slider", label: "Min n per group", min: 5, max: 30, step: 1, defaultValue: 10 },
  ],
},
```

- [ ] `npx tsc --noEmit 2>&1 | head -10` → 0 errors
- [ ] Commit: `feat(registry): upgrade A3/A6/A7/A12/A35/A41/A42/A43/A46 to SpatialCardCatalogEntry`

---

## Task 5 — Python: a6_ngrams.py

**File:** `sidecar/routers/a6_ngrams.py`
**Python:** `/Users/goshtasbshahriari/opt/anaconda3/envs/proxima_app/bin/python`

```python
# sidecar/routers/a6_ngrams.py
import re
from collections import Counter
from fastapi import APIRouter
from pydantic import BaseModel
from ..lib.cache import write_cache

router = APIRouter()

STOPWORDS = {
    "a","an","the","and","or","but","in","on","at","to","for","of","with",
    "is","are","was","were","be","been","being","have","has","had","do","does",
    "did","will","would","could","should","may","might","can","this","that",
    "these","those","it","its","i","we","you","he","she","they","my","our",
    "your","his","her","their","not","no","nor","so","yet","both","either",
    "neither","as","if","then","than","too","very","just","because","while",
    "about","up","out","there","here","when","where","who","which","how",
    "what","all","any","each","more","also","from","by","into","through",
}

def tokenize(text: str) -> list[str]:
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s']", " ", text)
    tokens = [t.strip("'") for t in text.split() if len(t.strip("'")) > 1]
    return [t for t in tokens if t not in STOPWORDS]

def compute(texts: list[str], n_gram: str = "both", max_terms: int = 20) -> dict:
    non_empty = [t for t in texts if t and t.strip()]
    n_text = len(texts)
    pct_empty = round(1 - len(non_empty) / max(n_text, 1), 4)

    if not non_empty:
        return {"error": "no_text", "n_text": n_text, "pct_empty": 1.0}

    all_tokens: list[list[str]] = [tokenize(t) for t in non_empty]

    unigrams: list[dict] = []
    bigrams: list[dict] = []

    if n_gram in ("1", "both"):
        counter = Counter(tok for toks in all_tokens for tok in toks)
        total = sum(counter.values())
        unigrams = [
            {"term": t, "count": c, "pct": round(c / max(len(non_empty), 1), 4)}
            for t, c in counter.most_common(max_terms)
        ]

    if n_gram in ("2", "both"):
        bg_counter: Counter = Counter()
        for toks in all_tokens:
            for i in range(len(toks) - 1):
                bg_counter[(toks[i], toks[i + 1])] += 1
        bigrams = [
            {"term": f"{a} {b}", "count": c, "pct": round(c / max(len(non_empty), 1), 4)}
            for (a, b), c in bg_counter.most_common(max_terms)
        ]

    return {
        "unigrams": unigrams,
        "bigrams": bigrams,
        "n_text": n_text,
        "pct_empty": pct_empty,
        "n_gram": n_gram,
    }

class Req(BaseModel):
    project_id: str
    texts: list[str]
    n_gram: str = "both"
    max_terms: int = 20

@router.post("")
def post(req: Req):
    out = compute(req.texts, req.n_gram, req.max_terms)
    write_cache(req.project_id, "A6_text_ngrams", out)
    return out
```

- [ ] Verify: `cd project_root && PYTHONPATH=. /path/to/proxima_app/python -c "from sidecar.routers.a6_ngrams import compute; r = compute(['clean water is important', 'road safety matters', 'clean air and water']); print(r['unigrams'][:3])"`
- [ ] Commit: `feat(sidecar): A6 text n-grams router`

---

## Task 6 — Python: a35_straight_line.py

```python
# sidecar/routers/a35_straight_line.py
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel
from ..lib.cache import write_cache

router = APIRouter()

class Row(BaseModel):
    response_id: str
    values: list[float | None]

class Req(BaseModel):
    project_id: str
    rows: list[Row]
    question_keys: list[str]
    threshold: float = 0.8
    min_questions: int = 3

def compute(rows_d: list[dict], question_keys: list[str],
            threshold: float = 0.8, min_questions: int = 3) -> dict:
    if len(question_keys) < min_questions:
        return {"error": "insufficient_questions", "n_questions": len(question_keys), "n_min": min_questions}
    if len(rows_d) < 5:
        return {"error": "insufficient_data", "n": len(rows_d)}

    flagged = []
    for row in rows_d:
        vals = [v for v in row["values"] if v is not None]
        if len(vals) < min_questions:
            continue
        arr = np.array(vals)
        # Modal value frequency = longstring index
        unique, counts = np.unique(arr, return_counts=True)
        modal_count = int(counts.max())
        score = modal_count / len(vals)
        if score >= threshold:
            modal_val = float(unique[counts.argmax()])
            flagged.append({
                "response_id": row["response_id"],
                "score": round(score, 3),
                "modal_value": modal_val,
                "n_answered": len(vals),
            })

    flagged.sort(key=lambda x: x["score"], reverse=True)
    return {
        "flagged": flagged,
        "n_flagged": len(flagged),
        "n_total": len(rows_d),
        "pct_flagged": round(len(flagged) / max(len(rows_d), 1), 4),
        "threshold": threshold,
        "n_questions": len(question_keys),
    }

@router.post("")
def post(req: Req):
    rows_d = [r.model_dump() for r in req.rows]
    out = compute(rows_d, req.question_keys, req.threshold, req.min_questions)
    write_cache(req.project_id, "A35_straight_line", out)
    return out
```

- [ ] Verify import + commit: `feat(sidecar): A35 straight-line detector router`

---

## Task 7 — Python: a43_raking.py + a46_segment_diff.py

**a43_raking.py:**
```python
# sidecar/routers/a43_raking.py
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel
from ..lib.cache import write_cache

router = APIRouter()

class Req(BaseModel):
    project_id: str
    group_values: list[str]  # one value per response
    trim_cap: float = 5.0

def compute(group_values: list[str], trim_cap: float = 5.0) -> dict:
    if len(group_values) < 10:
        return {"error": "insufficient_data", "n": len(group_values)}

    groups, counts = np.unique(group_values, return_counts=True)
    n = len(group_values)
    k = len(groups)
    if k < 2:
        return {"error": "single_group", "n": n}

    target_per_group = n / k
    raw_weights = {g: target_per_group / c for g, c in zip(groups, counts)}

    # Trim
    weights = np.array([min(raw_weights[v], trim_cap) for v in group_values])
    weights = weights / weights.mean()  # re-normalise to mean=1

    cv = float(weights.std() / weights.mean())
    eff_n = float(n / (1 + cv ** 2))
    deff = float(n / eff_n)

    hist_counts, hist_edges = np.histogram(weights, bins=10)
    histogram = [
        {"lo": round(float(hist_edges[i]), 3), "hi": round(float(hist_edges[i+1]), 3), "count": int(hist_counts[i])}
        for i in range(len(hist_counts))
    ]

    group_summary = [
        {"group": str(g), "n": int(c), "weight": round(float(min(raw_weights[g], trim_cap)), 3)}
        for g, c in zip(groups, counts)
    ]

    return {
        "cv": round(cv, 4),
        "effective_n": round(eff_n, 1),
        "deff": round(deff, 3),
        "max_weight": round(float(weights.max()), 3),
        "min_weight": round(float(weights.min()), 3),
        "n_trimmed": int(sum(1 for v in group_values if raw_weights[v] > trim_cap)),
        "histogram": histogram,
        "group_summary": group_summary,
        "n": n,
        "n_groups": k,
        "trim_cap": trim_cap,
    }

@router.post("")
def post(req: Req):
    out = compute(req.group_values, req.trim_cap)
    write_cache(req.project_id, "A43_raking_diag", out)
    return out
```

**a46_segment_diff.py:**
```python
# sidecar/routers/a46_segment_diff.py
import numpy as np
from scipy import stats
from fastapi import APIRouter
from pydantic import BaseModel
from ..lib.cache import write_cache

router = APIRouter()

class Row(BaseModel):
    response_id: str
    group_value: str
    question_values: dict[str, str | float | None]

class Req(BaseModel):
    project_id: str
    rows: list[Row]
    group_key: str
    fdr_alpha: float = 0.05
    min_n: int = 10

def _fdr_bh(pvals: list[float], alpha: float) -> list[float]:
    """Benjamini-Hochberg FDR correction. Returns adjusted p-values."""
    n = len(pvals)
    if n == 0:
        return []
    order = np.argsort(pvals)
    ranked = np.empty(n)
    ranked[order] = np.arange(1, n + 1)
    adj = np.array(pvals) * n / ranked
    # Enforce monotonicity from right
    for i in range(n - 2, -1, -1):
        adj[order[i]] = min(adj[order[i]], adj[order[i + 1]])
    return [min(float(v), 1.0) for v in adj]

def compute(rows_d: list[dict], fdr_alpha: float = 0.05, min_n: int = 10) -> dict:
    if len(rows_d) < 2 * min_n:
        return {"error": "insufficient_data", "n": len(rows_d)}

    groups = list({r["group_value"] for r in rows_d})
    if len(groups) < 2:
        return {"error": "single_group"}

    all_keys = set()
    for r in rows_d:
        all_keys.update(r["question_values"].keys())

    results = []
    for qk in all_keys:
        group_vals: dict[str, list] = {g: [] for g in groups}
        for r in rows_d:
            v = r["question_values"].get(qk)
            if v is not None and v != "":
                group_vals[r["group_value"]].append(v)

        # Keep only groups with enough data
        valid_groups = {g: vals for g, vals in group_vals.items() if len(vals) >= min_n}
        if len(valid_groups) < 2:
            continue

        # Numeric: Mann-Whitney U; else: chi-square
        group_lists = list(valid_groups.values())
        try:
            numeric_vals = [[float(v) for v in lst] for lst in group_lists]
            stat, p = stats.mannwhitneyu(numeric_vals[0], numeric_vals[1], alternative="two-sided")
            test = "mann_whitney"
            effect = abs(np.mean(numeric_vals[0]) - np.mean(numeric_vals[1]))
        except (ValueError, TypeError):
            # Chi-square
            all_cats = sorted({str(v) for lst in group_lists for v in lst})
            contingency = [[lst.count(c) for c in all_cats] for lst in group_lists]
            try:
                chi2, p, *_ = stats.chi2_contingency(contingency)
                test = "chi_square"
                effect = float(chi2)
            except Exception:
                continue

        results.append({"question_key": qk, "test": test, "p_raw": round(float(p), 5), "effect": round(effect, 4)})

    if not results:
        return {"comparisons": [], "n_tests": 0, "n_significant": 0}

    p_raws = [r["p_raw"] for r in results]
    p_adjs = _fdr_bh(p_raws, fdr_alpha)
    for r, p_adj in zip(results, p_adjs):
        r["p_fdr"] = round(p_adj, 5)
        r["significant"] = p_adj < fdr_alpha

    results.sort(key=lambda x: x["p_fdr"])

    return {
        "comparisons": results,
        "n_tests": len(results),
        "n_significant": sum(1 for r in results if r["significant"]),
        "fdr_alpha": fdr_alpha,
        "groups": groups,
        "group_key": rows_d[0]["group_value"] if rows_d else "",
    }

@router.post("")
def post(req: Req):
    rows_d = [r.model_dump() for r in req.rows]
    out = compute(rows_d, req.fdr_alpha, req.min_n)
    write_cache(req.project_id, "A46_segment_diff", out)
    return out
```

- [ ] Verify both imports with proxima_app python
- [ ] Commit: `feat(sidecar): A43 raking diagnostic + A46 segment diff routers`

---

## Task 8 — Update sidecar/app.py + Python tests

- [ ] Register 4 new routers in `sidecar/app.py`:
```python
from sidecar.routers import a6_ngrams, a35_straight_line, a43_raking, a46_segment_diff

app.include_router(a6_ngrams.router, prefix="/sidecar/compute/A6_text_ngrams", tags=["A6"], dependencies=[Depends(verify_secret)])
app.include_router(a35_straight_line.router, prefix="/sidecar/compute/A35_straight_line", tags=["A35"], dependencies=[Depends(verify_secret)])
app.include_router(a43_raking.router, prefix="/sidecar/compute/A43_raking_diag", tags=["A43"], dependencies=[Depends(verify_secret)])
app.include_router(a46_segment_diff.router, prefix="/sidecar/compute/A46_segment_diff", tags=["A46"], dependencies=[Depends(verify_secret)])
```

- [ ] Create `sidecar/tests/test_medium_routers.py`:
```python
def test_a6_ngrams_basic():
    from sidecar.routers.a6_ngrams import compute
    r = compute(["clean water is important", "road safety matters", "clean water supply", "more parks needed", "clean air quality"], n_gram="both", max_terms=10)
    assert "unigrams" in r
    assert r["unigrams"][0]["term"] == "clean"
    assert r["n_text"] == 5

def test_a6_empty():
    from sidecar.routers.a6_ngrams import compute
    r = compute(["", "", ""], n_gram="1")
    assert r["error"] == "no_text"

def test_a35_detects_straightliner():
    from sidecar.routers.a35_straight_line import compute
    rows = [{"response_id": str(i), "values": [3.0, 3.0, 3.0, 3.0, 3.0]} for i in range(10)]
    rows += [{"response_id": str(i+10), "values": [1.0, 3.0, 5.0, 2.0, 4.0]} for i in range(10)]
    r = compute(rows, question_keys=["q1","q2","q3","q4","q5"], threshold=0.8)
    assert r["n_flagged"] == 10

def test_a35_insufficient_questions():
    from sidecar.routers.a35_straight_line import compute
    rows = [{"response_id": "1", "values": [3.0, 3.0]}]
    r = compute(rows, question_keys=["q1","q2"], threshold=0.8, min_questions=3)
    assert r["error"] == "insufficient_questions"

def test_a43_raking_basic():
    from sidecar.routers.a43_raking import compute
    groups = ["A"] * 30 + ["B"] * 10 + ["C"] * 20
    r = compute(groups, trim_cap=5.0)
    assert "cv" in r
    assert "effective_n" in r
    assert r["n_groups"] == 3

def test_a46_segment_diff():
    from sidecar.routers.a46_segment_diff import compute
    rows = []
    for i in range(30):
        rows.append({"response_id": str(i), "group_value": "A", "question_values": {"q1": float(i % 5 + 1), "q2": float(i % 3)}})
    for i in range(30):
        rows.append({"response_id": str(i+30), "group_value": "B", "question_values": {"q1": float((i % 5 + 3) % 5 + 1), "q2": float(i % 3)}})
    r = compute(rows, fdr_alpha=0.05, min_n=10)
    assert "comparisons" in r
    assert r["n_tests"] >= 1

def test_a46_single_group():
    from sidecar.routers.a46_segment_diff import compute
    rows = [{"response_id": str(i), "group_value": "A", "question_values": {"q1": 1.0}} for i in range(20)]
    r = compute(rows)
    assert r.get("error") == "single_group"
```

- [ ] Run: `/Users/goshtasbshahriari/opt/anaconda3/envs/proxima_app/bin/python -m pytest sidecar/tests/test_medium_routers.py -v 2>&1 | tail -15` → all PASS
- [ ] Commit: `feat(sidecar): register A6/A35/A43/A46 + medium router tests`

---

## Task 9 — TypeScript: lib/queries/medium-analyses.ts

Create TypeScript handlers for the 5 non-sidecar analyses.

```ts
// lib/queries/medium-analyses.ts
import { createServerSupabase } from "@/lib/supabase/server";

const ZONE_SIZES: Record<string, number> = { "0.05": 0.05, "0.1": 0.1, "0.2": 0.2 };

function cellKey(lat: number, lon: number, deg: number) {
  return `${Math.floor(lon / deg)}_${Math.floor(lat / deg)}`;
}
function cellCenter(key: string, deg: number) {
  const [bx, by] = key.split("_").map(Number);
  return { lon: (bx + 0.5) * deg, lat: (by + 0.5) * deg };
}

// ── A3: Multi-select co-occurrence ──────────────────────────────────────────

export async function getMultiselectUpset(
  projectId: string, settings: Record<string, string>,
) {
  const questionKey = settings["questionKey"] ?? "";
  const maxSets = Number(settings["maxSets"] ?? 8);
  const minCount = Number(settings["minCount"] ?? 2);
  if (!questionKey) return { error: "no_question_key" };

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).from("survey_responses")
    .select("raw_data").eq("project_id", projectId) as
    { data: Array<{ raw_data: Record<string, unknown> | null }> | null };

  if (!data) return { sets: [], intersections: [], n: 0 };

  const rawVals = data.map(r => String(r.raw_data?.[questionKey] ?? "")).filter(Boolean);
  const n = rawVals.length;

  // Parse comma-separated options
  const parsed = rawVals.map(v => v.split(",").map(s => s.trim()).filter(Boolean));

  // Count set sizes
  const setCount = new Map<string, number>();
  for (const opts of parsed) for (const o of opts) setCount.set(o, (setCount.get(o) ?? 0) + 1);
  const topSets = [...setCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxSets).map(([name, size]) => ({ name, size }));
  const setNames = new Set(topSets.map(s => s.name));

  // Count pairwise intersections
  const intersectionCount = new Map<string, number>();
  for (const opts of parsed) {
    const filtered = opts.filter(o => setNames.has(o)).sort();
    for (let i = 0; i < filtered.length; i++) {
      for (let j = i + 1; j < filtered.length; j++) {
        const key = `${filtered[i]}∩${filtered[j]}`;
        intersectionCount.set(key, (intersectionCount.get(key) ?? 0) + 1);
      }
    }
  }
  const intersections = [...intersectionCount.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([pair, count]) => { const [a, b] = pair.split("∩"); return { sets: [a, b], count }; });

  return { sets: topSets, intersections, n, question_key: questionKey };
}

// ── A7: Weighted vs unweighted ───────────────────────────────────────────────

export async function getWeightedVsUnweighted(
  projectId: string, settings: Record<string, string>,
) {
  const groupKey = settings["groupKey"] ?? "";
  const questionKey = settings["questionKey"] ?? "";
  if (!groupKey || !questionKey) return { error: "missing_keys" };

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).from("survey_responses")
    .select("raw_data").eq("project_id", projectId) as
    { data: Array<{ raw_data: Record<string, unknown> | null }> | null };

  if (!data || data.length === 0) return { error: "no_data" };

  const rows = data
    .map(r => ({ g: String(r.raw_data?.[groupKey] ?? ""), v: r.raw_data?.[questionKey] }))
    .filter(r => r.g && r.v !== null && r.v !== undefined && r.v !== "");

  const groups = [...new Set(rows.map(r => r.g))];
  const n = rows.length;
  const k = groups.length;
  if (k < 2) return { error: "single_group" };

  const groupSizes = Object.fromEntries(groups.map(g => [g, rows.filter(r => r.g === g).length]));
  const targetSize = n / k;

  const groupStats = groups.map(g => {
    const vals = rows.filter(r => r.g === g).map(r => Number(r.v)).filter(Number.isFinite);
    const n_g = vals.length;
    const raw_mean = n_g > 0 ? vals.reduce((a, b) => a + b, 0) / n_g : 0;
    const weight = n_g > 0 ? targetSize / n_g : 1;
    return { group: g, n: n_g, raw_mean: round4(raw_mean), weight: round4(weight) };
  });

  const totalWeight = groupStats.reduce((s, g) => s + g.weight * g.n, 0);
  const weightedMean = round4(groupStats.reduce((s, g) => s + g.weight * g.n * g.raw_mean, 0) / Math.max(totalWeight, 1));
  const rawMean = round4(rows.map(r => Number(r.v)).filter(Number.isFinite).reduce((a, b) => a + b, 0) / Math.max(n, 1));

  return {
    raw_mean: rawMean,
    weighted_mean: weightedMean,
    delta: round4(weightedMean - rawMean),
    group_stats: groupStats,
    n,
    group_key: groupKey,
    question_key: questionKey,
  };
}

// ── A12: Choropleth aggregation ──────────────────────────────────────────────

export async function getChoroplethAgg(
  projectId: string, settings: Record<string, string>,
) {
  const deg = ZONE_SIZES[settings["zoneUnit"] ?? "0.1"] ?? 0.1;
  const minN = Number(settings["minN"] ?? 3);

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).from("points")
    .select("lat, lon").eq("project_id", projectId) as
    { data: Array<{ lat: number | null; lon: number | null }> | null };

  if (!data) return { zones: [], n: 0 };

  const zoneMap = new Map<string, number>();
  for (const r of data) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const k = cellKey(r.lat, r.lon, deg);
    zoneMap.set(k, (zoneMap.get(k) ?? 0) + 1);
  }

  const zones = [...zoneMap.entries()]
    .filter(([, n]) => n >= minN)
    .sort((a, b) => b[1] - a[1])
    .map(([k, count]) => ({ zone_id: k, count, ...cellCenter(k, deg) }));

  return { zones, n: data.length, zone_unit: `${deg}deg`, n_zones: zones.length };
}

// ── A41: Who's missing ───────────────────────────────────────────────────────

export async function getWhosMissing(
  projectId: string, settings: Record<string, string>,
) {
  const deg = ZONE_SIZES[settings["zoneUnit"] ?? "0.1"] ?? 0.1;
  const minUnivN = Number(settings["minUniverseN"] ?? 5);

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;

  const [{ data: univRows }, { data: pointRows }] = await Promise.all([
    sbAny.from("survey_universe").select("lat, lon").eq("project_id", projectId) as
      Promise<{ data: Array<{ lat: number | null; lon: number | null }> | null }>,
    sbAny.from("points").select("lat, lon").eq("project_id", projectId) as
      Promise<{ data: Array<{ lat: number | null; lon: number | null }> | null }>,
  ]);

  const univMap = new Map<string, number>();
  for (const r of univRows ?? []) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const k = cellKey(r.lat, r.lon, deg);
    univMap.set(k, (univMap.get(k) ?? 0) + 1);
  }
  const pointMap = new Map<string, number>();
  for (const r of pointRows ?? []) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const k = cellKey(r.lat, r.lon, deg);
    pointMap.set(k, (pointMap.get(k) ?? 0) + 1);
  }

  const totalUniv = [...univMap.values()].reduce((a, b) => a + b, 0);
  const totalPoints = [...pointMap.values()].reduce((a, b) => a + b, 0);

  const zones = [...univMap.entries()]
    .filter(([, n]) => n >= minUnivN)
    .map(([k, n_univ]) => {
      const n_resp = pointMap.get(k) ?? 0;
      const exp_pct = n_univ / Math.max(totalUniv, 1);
      const act_pct = n_resp / Math.max(totalPoints, 1);
      const deficit = round4(exp_pct - act_pct);
      return { zone_id: k, n_universe: n_univ, n_responses: n_resp, expected_pct: round4(exp_pct), actual_pct: round4(act_pct), deficit, ...cellCenter(k, deg) };
    })
    .sort((a, b) => b.deficit - a.deficit);

  return { zones, n_zones: zones.length, total_universe: totalUniv, total_responses: totalPoints };
}

// ── A42: Lorenz curve + Gini ─────────────────────────────────────────────────

export async function getLorenzCurve(
  projectId: string, settings: Record<string, string>,
) {
  const deg = ZONE_SIZES[settings["zoneUnit"] ?? "0.1"] ?? 0.1;

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;

  const [{ data: univRows }, { data: pointRows }] = await Promise.all([
    sbAny.from("survey_universe").select("lat, lon").eq("project_id", projectId) as
      Promise<{ data: Array<{ lat: number | null; lon: number | null }> | null }>,
    sbAny.from("points").select("lat, lon").eq("project_id", projectId) as
      Promise<{ data: Array<{ lat: number | null; lon: number | null }> | null }>,
  ]);

  const univMap = new Map<string, number>();
  for (const r of univRows ?? []) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    univMap.set(cellKey(r.lat, r.lon, deg), (univMap.get(cellKey(r.lat, r.lon, deg)) ?? 0) + 1);
  }
  const pointMap = new Map<string, number>();
  for (const r of pointRows ?? []) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    pointMap.set(cellKey(r.lat, r.lon, deg), (pointMap.get(cellKey(r.lat, r.lon, deg)) ?? 0) + 1);
  }

  const totalUniv = [...univMap.values()].reduce((a, b) => a + b, 0);
  const totalPoints = [...pointMap.values()].reduce((a, b) => a + b, 0);
  if (totalUniv === 0 || totalPoints === 0) return { error: "no_data" };

  // Coverage rate per zone: visits / universe
  const zones = [...univMap.entries()]
    .filter(([, n]) => n >= 1)
    .map(([k, n_univ]) => ({
      coverage_rate: (pointMap.get(k) ?? 0) / n_univ,
      univ_share: n_univ / totalUniv,
      visit_share: (pointMap.get(k) ?? 0) / Math.max(totalPoints, 1),
    }))
    .sort((a, b) => a.coverage_rate - b.coverage_rate);

  // Lorenz points
  const lorenz_points: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  let cum_univ = 0, cum_visit = 0;
  for (const z of zones) {
    cum_univ += z.univ_share;
    cum_visit += z.visit_share;
    lorenz_points.push({ x: round4(cum_univ), y: round4(cum_visit) });
  }

  // Gini = 1 - 2 * area under Lorenz
  let area = 0;
  for (let i = 1; i < lorenz_points.length; i++) {
    area += (lorenz_points[i].x - lorenz_points[i-1].x) * (lorenz_points[i].y + lorenz_points[i-1].y) / 2;
  }
  const gini = round4(1 - 2 * area);

  return { lorenz_points, gini, n_zones: zones.length, total_universe: totalUniv, total_visits: totalPoints };
}

function round4(n: number) { return Math.round(n * 10000) / 10000; }
```

- [ ] `npx tsc --noEmit 2>&1 | head -10` → 0 errors
- [ ] Commit: `feat(analyses): TypeScript handlers for A3/A7/A12/A41/A42`

---

## Task 10 — Sidecar input builders + dispatcher wiring

**Files:** `lib/queries/sidecar-inputs.ts`, `app/api/projects/[projectId]/analyses/[cardId]/route.ts`

- [ ] Add to `sidecar-inputs.ts` (4 builders for Python sidecar):

```ts
/** A6: Text n-grams */
export async function buildA6Input(projectId: string, settings: Record<string, string>) {
  const qk = settings["questionKey"] ?? "";
  if (!qk) return null;
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).from("survey_responses")
    .select("raw_data").eq("project_id", projectId) as
    { data: Array<{ raw_data: Record<string, unknown> | null }> | null };
  const texts = (data ?? []).map(r => String(r.raw_data?.[qk] ?? ""));
  return { texts, n_gram: settings["nGram"] ?? "both", max_terms: Number(settings["maxTerms"] ?? 20) };
}

/** A35: Straight-line detector */
export async function buildA35Input(projectId: string, settings: Record<string, string>) {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).from("survey_responses")
    .select("id, raw_data").eq("project_id", projectId) as
    { data: Array<{ id: string; raw_data: Record<string, unknown> | null }> | null };
  if (!data || data.length === 0) return null;

  // Find all numeric/Likert keys from first non-null row
  const sample = data.find(r => r.raw_data)?.raw_data ?? {};
  const numericKeys = Object.keys(sample).filter(k => {
    const vals = data.map(r => r.raw_data?.[k]).filter(v => v !== null && v !== undefined && v !== "");
    return vals.length >= 3 && vals.every(v => Number.isFinite(Number(v)));
  });

  if (numericKeys.length < Number(settings["minQuestions"] ?? 3)) return null;

  const rows = data.map(r => ({
    response_id: r.id,
    values: numericKeys.map(k => {
      const v = r.raw_data?.[k];
      return (v !== null && v !== undefined && v !== "") ? Number(v) : null;
    }),
  }));

  return {
    rows,
    question_keys: numericKeys,
    threshold: Number(settings["threshold"] ?? 0.8),
    min_questions: Number(settings["minQuestions"] ?? 3),
  };
}

/** A43: Raking diagnostic */
export async function buildA43Input(projectId: string, settings: Record<string, string>) {
  const groupKey = settings["groupKey"] ?? "";
  if (!groupKey) return null;
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).from("survey_responses")
    .select("raw_data").eq("project_id", projectId) as
    { data: Array<{ raw_data: Record<string, unknown> | null }> | null };
  const groupValues = (data ?? [])
    .map(r => String(r.raw_data?.[groupKey] ?? ""))
    .filter(Boolean);
  if (groupValues.length === 0) return null;
  return { group_values: groupValues, trim_cap: Number(settings["trimCap"] ?? 5) };
}

/** A46: Segment differences */
export async function buildA46Input(projectId: string, settings: Record<string, string>) {
  const groupKey = settings["groupKey"] ?? "";
  if (!groupKey) return null;
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).from("survey_responses")
    .select("id, raw_data").eq("project_id", projectId) as
    { data: Array<{ id: string; raw_data: Record<string, unknown> | null }> | null };
  if (!data) return null;
  const rows = data
    .filter(r => r.raw_data?.[groupKey])
    .map(r => ({
      response_id: r.id,
      group_value: String(r.raw_data![groupKey]),
      question_values: Object.fromEntries(
        Object.entries(r.raw_data ?? {}).filter(([k]) => k !== groupKey)
      ),
    }));
  if (rows.length === 0) return null;
  return {
    rows,
    group_key: groupKey,
    fdr_alpha: Number(settings["fdrAlpha"] ?? 0.05),
    min_n: Number(settings["minN"] ?? 10),
  };
}
```

- [ ] Add to dispatcher route (POSTGRES_DISPATCH):
```ts
import { getMultiselectUpset, getWeightedVsUnweighted, getChoroplethAgg, getWhosMissing, getLorenzCurve } from "@/lib/queries/medium-analyses";
// ...
A3_multiselect_upset: (projectId, settings) => getMultiselectUpset(projectId, settings),
A7_weighted_vs_unweighted: (projectId, settings) => getWeightedVsUnweighted(projectId, settings),
A12_choropleth_agg: (projectId, settings) => getChoroplethAgg(projectId, settings),
A41_whos_missing: (projectId, settings) => getWhosMissing(projectId, settings),
A42_lorenz: (projectId, settings) => getLorenzCurve(projectId, settings),
```

- [ ] Add to SIDECAR_DISPATCH:
```ts
import { buildA6Input, buildA35Input, buildA43Input, buildA46Input } from "@/lib/queries/sidecar-inputs";
// ...
A6_text_ngrams: async (projectId, settings) => {
  const body = await buildA6Input(projectId, settings);
  if (!body) return { reason: "wave-pending", message: "No text question selected." };
  return callSidecar(projectId, "A6_text_ngrams", body);
},
A35_straight_line: async (projectId, settings) => {
  const body = await buildA35Input(projectId, settings);
  if (!body) return { reason: "wave-pending", message: "Need ≥3 numeric/Likert questions." };
  return callSidecar(projectId, "A35_straight_line", body);
},
A43_raking_diag: async (projectId, settings) => {
  const body = await buildA43Input(projectId, settings);
  if (!body) return { reason: "wave-pending", message: "No grouping question selected." };
  return callSidecar(projectId, "A43_raking_diag", body);
},
A46_segment_diff: async (projectId, settings) => {
  const body = await buildA46Input(projectId, settings);
  if (!body) return { reason: "wave-pending", message: "No grouping question selected." };
  return callSidecar(projectId, "A46_segment_diff", body);
},
```

- [ ] `npx tsc --noEmit` → 0 errors; `npx vitest run` → all pass
- [ ] Commit: `feat(dispatcher): wire A3/A6/A7/A12/A35/A41/A42/A43/A46`

---

## Task 11 — Result display panels (9 components + index update)

Create one file per card in `components/analyses/results/`. Each accepts `{ data: unknown }`.

- [ ] **a3-result.tsx** — Sets + intersections table:
```tsx
"use client";
type S = { name: string; size: number };
type I = { sets: string[]; count: number };
type D = { sets: S[]; intersections: I[]; n: number; question_key: string };
export function A3Result({ data }: { data: unknown }) {
  const r = data as D;
  if (!r?.sets) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-[var(--shell-text-muted)]">n = {r.n} · {r.sets.length} options</p>
      <div className="space-y-1">
        <p className="text-[10px] font-mono text-[var(--shell-text-muted)] uppercase tracking-wide">Top options</p>
        {r.sets.slice(0,5).map((s,i) => (
          <div key={i} className="flex justify-between text-[11px]">
            <span className="font-mono text-[var(--shell-text)]">{s.name}</span>
            <span className="text-[var(--shell-text-muted)]">{s.size}</span>
          </div>
        ))}
      </div>
      {r.intersections.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-[var(--shell-border)]">
          <p className="text-[10px] font-mono text-[var(--shell-text-muted)] uppercase tracking-wide">Top co-occurrences</p>
          {r.intersections.slice(0,5).map((x,i) => (
            <div key={i} className="flex justify-between text-[11px]">
              <span className="font-mono text-[var(--shell-text)]">{x.sets.join(" + ")}</span>
              <span className="text-[var(--shell-text-muted)]">{x.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **a6-result.tsx** — N-gram frequency bars (CSS width %):
```tsx
"use client";
type Term = { term: string; count: number; pct: number };
type D = { unigrams: Term[]; bigrams: Term[]; n_text: number; pct_empty: number };
export function A6Result({ data }: { data: unknown }) {
  const r = data as D;
  if (!r?.unigrams) return null;
  const maxCount = Math.max(...[...r.unigrams, ...r.bigrams].map(t => t.count), 1);
  const renderTerms = (terms: Term[], label: string) => (
    <div className="space-y-1">
      <p className="text-[10px] font-mono text-[var(--shell-text-muted)] uppercase tracking-wide">{label}</p>
      {terms.slice(0,8).map((t,i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-[var(--shell-text-muted)] w-20 truncate">{t.term}</span>
          <div className="flex-1 h-2 bg-[var(--shell-2)] rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(t.count / maxCount) * 100}%` }}/>
          </div>
          <span className="text-[10px] text-[var(--shell-text-muted)] w-8 text-right">{t.count}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="space-y-3">
      <p className="text-[10px] text-[var(--shell-text-muted)]">n = {r.n_text} · {(r.pct_empty*100).toFixed(1)}% empty</p>
      {r.unigrams.length > 0 && renderTerms(r.unigrams, "Unigrams")}
      {r.bigrams.length > 0 && renderTerms(r.bigrams, "Bigrams")}
    </div>
  );
}
```

- [ ] **a7-result.tsx** — Before/after table with delta:
```tsx
"use client";
type G = { group: string; n: number; raw_mean: number; weight: number };
type D = { raw_mean: number; weighted_mean: number; delta: number; group_stats: G[]; n: number };
export function A7Result({ data }: { data: unknown }) {
  const r = data as D;
  if (r?.raw_mean === undefined) return null;
  return (
    <div className="space-y-2">
      <div className="flex gap-4 text-[12px]">
        <div><span className="text-[var(--shell-text-muted)] text-[10px]">Raw mean</span><br/><span className="font-mono font-bold">{r.raw_mean.toFixed(3)}</span></div>
        <div><span className="text-[var(--shell-text-muted)] text-[10px]">Weighted mean</span><br/><span className="font-mono font-bold text-amber-400">{r.weighted_mean.toFixed(3)}</span></div>
        <div><span className="text-[var(--shell-text-muted)] text-[10px]">Δ</span><br/><span className={`font-mono font-bold ${Math.abs(r.delta) > 0.1 ? "text-orange-400" : "text-[var(--shell-text-muted)]"}`}>{r.delta > 0 ? "+" : ""}{r.delta.toFixed(3)}</span></div>
      </div>
      <table className="w-full text-[10.5px] font-mono">
        <thead><tr className="text-[var(--shell-text-muted)]"><th className="text-left">Group</th><th className="text-right">n</th><th className="text-right">mean</th><th className="text-right">weight</th></tr></thead>
        <tbody>{(r.group_stats ?? []).map((g,i) => (
          <tr key={i}><td>{g.group}</td><td className="text-right">{g.n}</td><td className="text-right">{g.raw_mean.toFixed(3)}</td><td className="text-right">{g.weight.toFixed(2)}×</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}
```

- [ ] **a12-result.tsx** — Top zones table:
```tsx
"use client";
type Zone = { zone_id: string; count: number; lat: number; lon: number };
type D = { zones: Zone[]; n: number; n_zones: number; zone_unit: string };
export function A12Result({ data }: { data: unknown }) {
  const r = data as D;
  if (!r?.zones) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-[var(--shell-text-muted)]">{r.n_zones} zones · {r.n} total points · {r.zone_unit}</p>
      <table className="w-full text-[10.5px] font-mono">
        <thead><tr className="text-[var(--shell-text-muted)]"><th className="text-left">Zone</th><th className="text-right">Points</th><th className="text-right">Lat</th><th className="text-right">Lon</th></tr></thead>
        <tbody>{r.zones.slice(0,8).map((z,i) => (
          <tr key={i}><td className="text-[var(--shell-text-muted)]">{z.zone_id}</td><td className="text-right font-bold">{z.count}</td><td className="text-right">{z.lat.toFixed(3)}</td><td className="text-right">{z.lon.toFixed(3)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}
```

- [ ] **a35-result.tsx** — Flagged respondent list:
```tsx
"use client";
type F = { response_id: string; score: number; modal_value: number; n_answered: number };
type D = { flagged: F[]; n_flagged: number; n_total: number; pct_flagged: number; threshold: number };
export function A35Result({ data }: { data: unknown }) {
  const r = data as D;
  if (r?.n_flagged === undefined) return null;
  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-[11.5px]">
        <span className="text-red-400 font-semibold">{r.n_flagged} flagged</span>
        <span className="text-[var(--shell-text-muted)]">of {r.n_total} ({(r.pct_flagged*100).toFixed(1)}%)</span>
      </div>
      <p className="text-[10px] text-amber-400">⚠ Review manually — never auto-delete flagged responses.</p>
      {r.flagged.length > 0 && (
        <table className="w-full text-[10.5px] font-mono">
          <thead><tr className="text-[var(--shell-text-muted)]"><th className="text-left">Response ID</th><th className="text-right">Score</th><th className="text-right">Modal val</th></tr></thead>
          <tbody>{r.flagged.slice(0,8).map((f,i) => (
            <tr key={i}><td className="text-[var(--shell-text-muted)] truncate max-w-[100px]">{f.response_id.slice(0,12)}…</td><td className="text-right text-red-400">{(f.score*100).toFixed(0)}%</td><td className="text-right">{f.modal_value}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **a41-result.tsx** — Deficit ranked list:
```tsx
"use client";
type Z = { zone_id: string; n_universe: number; n_responses: number; expected_pct: number; actual_pct: number; deficit: number };
type D = { zones: Z[]; n_zones: number; total_universe: number; total_responses: number };
export function A41Result({ data }: { data: unknown }) {
  const r = data as D;
  if (!r?.zones) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-[var(--shell-text-muted)]">{r.n_zones} zones · universe {r.total_universe} · responses {r.total_responses}</p>
      <table className="w-full text-[10.5px] font-mono">
        <thead><tr className="text-[var(--shell-text-muted)]"><th className="text-left">Zone</th><th className="text-right">Exp%</th><th className="text-right">Act%</th><th className="text-right">Deficit</th></tr></thead>
        <tbody>{r.zones.slice(0,8).map((z,i) => (
          <tr key={i}>
            <td className="text-[var(--shell-text-muted)]">{z.zone_id}</td>
            <td className="text-right">{(z.expected_pct*100).toFixed(1)}</td>
            <td className="text-right">{(z.actual_pct*100).toFixed(1)}</td>
            <td className={`text-right font-bold ${z.deficit > 0.02 ? "text-red-400" : z.deficit < -0.02 ? "text-green-400" : ""}`}>{z.deficit > 0 ? "+" : ""}{(z.deficit*100).toFixed(1)}pp</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
```

- [ ] **a42-result.tsx** — Gini KPI + curve summary:
```tsx
"use client";
type D = { gini: number; n_zones: number; lorenz_points: Array<{x:number;y:number}>; total_universe: number; total_visits: number };
export function A42Result({ data }: { data: unknown }) {
  const r = data as D;
  if (r?.gini === undefined) return null;
  const interpretation = r.gini < 0.2 ? "equitable" : r.gini < 0.4 ? "moderate inequality" : "high inequality";
  const color = r.gini < 0.2 ? "text-green-400" : r.gini < 0.4 ? "text-amber-400" : "text-red-400";
  return (
    <div className="space-y-2">
      <div className="flex gap-4 items-baseline">
        <div><p className="text-[10px] text-[var(--shell-text-muted)]">Gini coefficient</p><p className={`text-[22px] font-bold font-mono ${color}`}>{r.gini.toFixed(3)}</p></div>
        <p className={`text-[12px] ${color}`}>{interpretation}</p>
      </div>
      <p className="text-[10px] text-[var(--shell-text-muted)]">{r.n_zones} zones · {r.total_universe} universe · {r.total_visits} visits</p>
      <p className="text-[10px] text-[var(--shell-text-muted)]">0 = perfectly equal coverage · 1 = all visits in one zone</p>
    </div>
  );
}
```

- [ ] **a43-result.tsx** — Raking diagnostics:
```tsx
"use client";
type G = { group: string; n: number; weight: number };
type D = { cv: number; effective_n: number; deff: number; max_weight: number; min_weight: number; n_trimmed: number; group_summary: G[]; n: number; n_groups: number };
export function A43Result({ data }: { data: unknown }) {
  const r = data as D;
  if (r?.cv === undefined) return null;
  return (
    <div className="space-y-2">
      <table className="w-full text-[11px] font-mono">
        <tbody>
          <tr><td className="text-[var(--shell-text-muted)]">CV (coeff. of variation)</td><td className="text-right font-bold">{r.cv.toFixed(3)}</td></tr>
          <tr><td className="text-[var(--shell-text-muted)]">Effective n</td><td className="text-right">{r.effective_n.toFixed(0)} <span className="text-[var(--shell-text-muted)] text-[9px]">of {r.n}</span></td></tr>
          <tr><td className="text-[var(--shell-text-muted)]">DEFF</td><td className="text-right">{r.deff.toFixed(3)}</td></tr>
          <tr><td className="text-[var(--shell-text-muted)]">Weight range</td><td className="text-right">{r.min_weight.toFixed(2)}× – {r.max_weight.toFixed(2)}×</td></tr>
          {r.n_trimmed > 0 && <tr><td className="text-amber-400">Trimmed</td><td className="text-right text-amber-400">{r.n_trimmed} responses</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **a46-result.tsx** — Significant differences ranked:
```tsx
"use client";
type C = { question_key: string; test: string; p_raw: number; p_fdr: number; effect: number; significant: boolean };
type D = { comparisons: C[]; n_tests: number; n_significant: number; fdr_alpha: number; groups: string[] };
export function A46Result({ data }: { data: unknown }) {
  const r = data as D;
  if (!r?.comparisons) return null;
  const sig = r.comparisons.filter(c => c.significant);
  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-[11.5px]">
        <span className="font-semibold text-emerald-400">{r.n_significant} significant</span>
        <span className="text-[var(--shell-text-muted)]">of {r.n_tests} tested</span>
      </div>
      {sig.length > 0 && (
        <table className="w-full text-[10.5px] font-mono">
          <thead><tr className="text-[var(--shell-text-muted)]"><th className="text-left">Question</th><th className="text-right">p_fdr</th><th className="text-right">test</th></tr></thead>
          <tbody>{sig.slice(0,8).map((c,i) => (
            <tr key={i}><td className="truncate max-w-[120px]">{c.question_key}</td><td className="text-right text-emerald-400">{c.p_fdr.toFixed(4)}</td><td className="text-right text-[var(--shell-text-muted)]">{c.test === "mann_whitney" ? "MW" : "χ²"}</td></tr>
          ))}</tbody>
        </table>
      )}
      {sig.length === 0 && <p className="text-[11px] text-[var(--shell-text-muted)]">No significant differences found after FDR correction.</p>}
    </div>
  );
}
```

- [ ] Update `components/analyses/results/index.ts` — add 9 new entries:
```ts
import { A3Result } from "./a3-result";
import { A6Result } from "./a6-result";
import { A7Result } from "./a7-result";
import { A12Result } from "./a12-result";
import { A35Result } from "./a35-result";
import { A41Result } from "./a41-result";
import { A42Result } from "./a42-result";
import { A43Result } from "./a43-result";
import { A46Result } from "./a46-result";
// Add to RESULT_PANELS:
A3_multiselect_upset: A3Result,
A6_text_ngrams: A6Result,
A7_weighted_vs_unweighted: A7Result,
A12_choropleth_agg: A12Result,
A35_straight_line: A35Result,
A41_whos_missing: A41Result,
A42_lorenz: A42Result,
A43_raking_diag: A43Result,
A46_segment_diff: A46Result,
```

- [ ] `npx tsc --noEmit` → 0 errors; `npx vitest run` → all pass
- [ ] Commit: `feat(analyses): result display panels for A3/A6/A7/A12/A35/A41/A42/A43/A46`

---

## Task 12 — Final check + push

- [ ] `npx tsc --noEmit` → 0 errors
- [ ] `npx vitest run 2>&1 | tail -5` → all pass
- [ ] `/Users/goshtasbshahriari/opt/anaconda3/envs/proxima_app/bin/python -m pytest sidecar/tests/ -v 2>&1 | tail -8` → all pass
- [ ] `git push origin main`

---

## Acceptance criteria

- All 9 cards appear in the AddAnalysisModal under "Survey Response" or "Quality & Bias" toolboxes with animated SVG preview
- Clicking a card shows the correct settings schema in the SettingsDrawer
- Running A3 with a multi-select question returns `{sets, intersections}`
- Running A6 with a text question returns ranked n-grams
- Running A42 returns `{gini, lorenz_points}`
- Running A46 returns `{comparisons, n_significant}`
- V2 placeholder cards still show AwaitingDataPanel
- `npx tsc --noEmit` → 0 errors
- All Vitest + pytest tests pass
