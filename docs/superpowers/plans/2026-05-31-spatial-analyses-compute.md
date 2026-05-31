# Spatial Analyses Compute — M7.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real compute for all 9 spatial analysis cards (A0 + S1–S8) — Python sidecar routers, TypeScript input builders, dispatcher query-param forwarding, S6 Postgres handler, and structured result display panels in the SettingsDrawer.

**Architecture:**
- `useAnalysisResult.run()` already sends settings as URL query params (`?questionKey=X&weightsType=knn8&...`). The dispatcher route currently ignores them; Task 1 fixes that.
- Input builders (`lib/queries/sidecar-inputs.ts`) fetch `(id, value, lat, lon)` tuples from Supabase by JOINing `points` + `survey_responses`, encode Likert/bool → float, then hand the cells array to `callSidecar()`.
- Python routers receive the cells in the POST body — they never query Supabase themselves (except via `write_cache`).
- `esda 2.6.0`, `libpysal 4.12.1`, `numpy` are already in `sidecar/requirements.txt`. No new Python dependencies needed for S1–S3, S5, S7, S8.
- S4 (Kulldorff) uses a pure-Python Monte Carlo Bernoulli scan — no SaTScan binary.
- S6 is Postgres-only (`computeStrategy: "postgres"`) — direct SQL aggregate, no sidecar.
- A0 is TypeScript server-side using existing `lib/colorize/auto-classify.ts` — returns legend spec + class breaks.
- Migration 022 already added S1–S8 to the `dashboard_cache.data_type` CHECK constraint. No new migration needed.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, FastAPI Python sidecar, PySAL esda 2.6.0, libpysal 4.12.1, Vitest + pytest

---

## File map

**New Python files:**
- `sidecar/lib/weights.py` — shared spatial weights builder (KNN + distance-band)
- `sidecar/lib/encode.py` — Likert/bool/categorical → float normalization
- `sidecar/routers/s1_autocorr.py` — global Moran's I + Geary's C
- `sidecar/routers/s2_gi_star_q.py` — Gi* on a question column
- `sidecar/routers/s3_lisa_q.py` — LISA Local Moran
- `sidecar/routers/s4_satscan.py` — Bernoulli spatial scan (Monte Carlo)
- `sidecar/routers/s5_distance_decay.py` — distance-decay vs POI
- `sidecar/routers/s7_local_geary.py` — Local Geary
- `sidecar/routers/s8_bivariate.py` — Bivariate Local Moran (Lee's L proxy)
- `sidecar/tests/test_spatial_routers.py` — pytest unit tests for all new routers

**Modified Python files:**
- `sidecar/app.py` — register 7 new routers

**New TypeScript files:**
- `lib/queries/coverage-response.ts` — S6 Postgres aggregate
- `components/analyses/results/a0-result.tsx` — colorizer legend panel
- `components/analyses/results/s1-result.tsx` — Moran KPI tile
- `components/analyses/results/s2-result.tsx` — hot/cold spot summary
- `components/analyses/results/s3-result.tsx` — LISA quadrant breakdown
- `components/analyses/results/s4-result.tsx` — scan cluster summary
- `components/analyses/results/s5-result.tsx` — decay curve table
- `components/analyses/results/s6-result.tsx` — 3×3 bivariate grid
- `components/analyses/results/s7-result.tsx` — local heterogeneity summary
- `components/analyses/results/s8-result.tsx` — Lee's L vs Pearson comparison
- `components/analyses/results/index.ts` — result-panel registry dispatch

**Modified TypeScript files:**
- `app/api/projects/[projectId]/analyses/[cardId]/route.ts` — read query params, update handler signatures, add S1–S8 + A0 + S6
- `lib/queries/sidecar-inputs.ts` — add buildSpatialCells helper + buildS1–S8Input builders
- `components/analyses/settings-drawer.tsx` — swap generic JSON preview for card-specific result panel
- `lib/analyses/registry.ts` — clear `stub: true` for implemented cards (A0, S1–S8)

---

## Task 1 — Dispatcher: read query params + update handler signatures

**Files:**
- Modify: `app/api/projects/[projectId]/analyses/[cardId]/route.ts`

The current GET handler ignores `_req`. Spatial cards need `questionKey`, `weightsType`, `fdrAlpha`, etc. forwarded. Change the handler map to accept a second `settings` argument.

- [ ] **Step 1: Read the file**

```bash
cat app/api/projects/[projectId]/analyses/[cardId]/route.ts
```

- [ ] **Step 2: Update handler types and extract query params**

Change `_req: Request` → `req: Request`. After destructuring `params`, add:

```ts
const url = new URL(req.url);
const settings: Record<string, string> = {};
url.searchParams.forEach((v, k) => { settings[k] = v; });
```

Change dispatch map types:
```ts
const POSTGRES_DISPATCH: Record<string, (projectId: string, settings: Record<string, string>) => Promise<unknown>> = { ... }
const SIDECAR_DISPATCH: Record<string, (projectId: string, settings: Record<string, string>) => Promise<unknown>> = { ... }
```

Update existing entries to accept `(projectId, _settings)` (ignore settings for A-series cards that don't use them):
```ts
A16_rr: (projectId) => getAaporResult(projectId),
// ... same for all existing entries
A8_gi_star: async (projectId) => {
  const body = await buildA8GiStarInput(projectId);
  return callSidecar(projectId, "A8_gi_star", body);
},
```

Update the handler call:
```ts
const handler = POSTGRES_DISPATCH[cardId] ?? SIDECAR_DISPATCH[cardId];
...
const data = await handler(projectId, settings);
```

- [ ] **Step 3: Run tests — ensure existing cards still pass**

```bash
cd "/Users/goshtasbshahriari/UF Dropbox/Goshtasb Shahriari Mehr/DTSC_Lab/Survey_Dashboards" && npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: same pass count as before (108).

- [ ] **Step 4: Commit**

```bash
git add app/api/projects/\[projectId\]/analyses/\[cardId\]/route.ts
git commit -m "feat(analyses): forward query-param settings to dispatch handlers"
```

---

## Task 2 — Shared TS helper: buildSpatialCells

**Files:**
- Modify: `lib/queries/sidecar-inputs.ts`

Add a helper that JOINs `points` + `survey_responses` and returns `{id, value, lat, lon}[]` for a question column. Likert is encoded as ordinal index (0-based); boolean as 0/1; numeric as-is; categorical as index in sorted distinct list.

- [ ] **Step 1: Read current sidecar-inputs.ts**

- [ ] **Step 2: Add imports and helper**

Add at the top (after existing imports):
```ts
import { inferType } from "@/lib/colorize/auto-classify";
```

Add this function before the existing builders:
```ts
export type SpatialCell = { id: string; value: number; lat: number; lon: number };

/**
 * Fetch all M1-matched (field+response) records for a project question column.
 * Returns cells with encoded numeric value. Encoding:
 *   numeric  → as-is
 *   boolean  → 0 / 1
 *   likert   → ordinal rank (0-based, ascending)
 *   categorical → sorted-distinct index (0-based)
 *   missing  → row excluded
 */
export async function buildSpatialCells(
  projectId: string,
  questionKey: string,
  limit = 50_000,
): Promise<SpatialCell[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await ((sb as any)
    .from("points")
    .select("id, lat, lon, survey_responses!matched_response_id(id, raw_data)")
    .eq("project_id", projectId)
    .not("matched_response_id", "is", null)
    .limit(limit)
  ) as { data: Array<{
    id: string; lat: number | null; lon: number | null;
    survey_responses: { id: string; raw_data: Record<string, unknown> | null } | null;
  }> | null };

  if (!data) return [];

  // Collect raw values to infer type once
  const rawAll: unknown[] = [];
  for (const r of data) {
    const v = r.survey_responses?.raw_data?.[questionKey];
    if (v !== null && v !== undefined && v !== "") rawAll.push(v);
  }
  if (rawAll.length === 0) return [];

  const profile = inferType(rawAll);
  const { type, likertOrder, sampleValues } = profile;

  // Build encoding map once
  let encodeMap: Map<string, number> | null = null;
  if (type === "likert" && likertOrder) {
    encodeMap = new Map(likertOrder.map((v, i) => [String(v), i]));
  } else if (type === "categorical" || type === "boolean") {
    const sorted = [...new Set(sampleValues)].sort();
    encodeMap = new Map(sorted.map((v, i) => [String(v), i]));
  }

  const BOOL_TRUE = new Set(["true", "yes", "1", "y"]);

  const cells: SpatialCell[] = [];
  for (const r of data) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const raw = r.survey_responses?.raw_data?.[questionKey];
    if (raw === null || raw === undefined || raw === "") continue;

    let value: number;
    if (type === "numeric_continuous" || type === "numeric_skewed" || type === "date") {
      value = Number(raw);
      if (!Number.isFinite(value)) continue;
    } else if (type === "boolean") {
      value = BOOL_TRUE.has(String(raw).toLowerCase().trim()) ? 1 : 0;
    } else if (encodeMap) {
      const idx = encodeMap.get(String(raw));
      if (idx === undefined) continue;
      value = idx;
    } else {
      continue;
    }

    cells.push({ id: r.id, value, lat: r.lat, lon: r.lon });
  }
  return cells;
}
```

- [ ] **Step 3: Write vitest test**

In `tests/queries/sidecar-inputs.test.ts` (create if absent):

```ts
import { describe, it, expect, vi } from "vitest";
// Test the encoding logic in isolation (no DB call)
import { inferType } from "@/lib/colorize/auto-classify";

describe("buildSpatialCells encoding logic", () => {
  it("infers likert type correctly", () => {
    const r = inferType(["strongly agree","agree","neutral","disagree","strongly disagree"]);
    expect(r.type).toBe("likert");
    expect(r.likertOrder).toBeDefined();
  });

  it("infers boolean type correctly", () => {
    const r = inferType(["yes","no","yes","yes","no"]);
    expect(r.type).toBe("boolean");
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/queries/sidecar-inputs.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/sidecar-inputs.ts tests/queries/sidecar-inputs.test.ts
git commit -m "feat(sidecar-inputs): add buildSpatialCells helper with Likert/bool encoding"
```

---

## Task 3 — Python: sidecar/lib/weights.py + sidecar/lib/encode.py

**Files:**
- Create: `sidecar/lib/weights.py`
- Create: `sidecar/lib/encode.py`

These are shared utilities used by all spatial routers.

- [ ] **Step 1: Create weights.py**

```python
# sidecar/lib/weights.py
"""Shared spatial-weights builder for all S-series routers."""
import numpy as np
import libpysal


def build_weights(coords: np.ndarray, weights_type: str = "knn8") -> libpysal.weights.W:
    """Build a spatial weights matrix from (lon, lat) coords.

    Args:
        coords: shape (n, 2) array of [lon, lat] values.
        weights_type: "knn8" | "knn5" | "dband_500m"

    Returns:
        Row-standardized W matrix.
    """
    n = len(coords)
    if weights_type == "dband_500m":
        # ~500 m in decimal degrees at mid-latitudes (0.0045 ≈ 500 m)
        # Use KNN fallback when bandwidth produces islands
        try:
            w = libpysal.weights.DistanceBand.from_array(coords, threshold=0.0045, binary=True)
            if w.n_components > 1:
                # Fall back to KNN to guarantee connectivity
                w = libpysal.weights.KNN.from_array(coords, k=min(8, n - 1))
        except Exception:
            w = libpysal.weights.KNN.from_array(coords, k=min(8, n - 1))
    else:
        k = 5 if weights_type == "knn5" else 8
        w = libpysal.weights.KNN.from_array(coords, k=min(k, n - 1))

    w.transform = "r"
    return w
```

- [ ] **Step 2: Create encode.py**

```python
# sidecar/lib/encode.py
"""Minimal Likert/bool/numeric value normalization — mirrors TypeScript buildSpatialCells."""
import numpy as np


def winsorize(arr: np.ndarray, pct: float = 0.02) -> np.ndarray:
    """Clip to [pct, 1-pct] quantiles."""
    lo, hi = np.quantile(arr, [pct, 1 - pct])
    return np.clip(arr, lo, hi)


def zscore(arr: np.ndarray) -> np.ndarray:
    """Standardize to mean=0, std=1. Returns zeros if std == 0."""
    std = arr.std()
    if std == 0:
        return np.zeros_like(arr, dtype=float)
    return (arr - arr.mean()) / std
```

- [ ] **Step 3: Run quick import check**

```bash
cd "/Users/goshtasbshahriari/UF Dropbox/Goshtasb Shahriari Mehr/DTSC_Lab/Survey_Dashboards/sidecar" && python -c "from sidecar.lib.weights import build_weights; from sidecar.lib.encode import winsorize; print('OK')" 2>&1
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add sidecar/lib/weights.py sidecar/lib/encode.py
git commit -m "feat(sidecar): shared weights builder + encode utils"
```

---

## Task 4 — Python: S1 Global Spatial Autocorrelation (Moran's I + Geary's C)

**Files:**
- Create: `sidecar/routers/s1_autocorr.py`

Input body: `{project_id, cells: [{id, value, lat, lon}], weights_type, n_permutations}`
Output: `{moran_I, moran_p, geary_C, geary_p, verdict, n, weights_type, permutations}`

Verdict logic:
- `moran_I > 0 and moran_p < 0.05` → "clustered"
- `moran_I < 0 and moran_p < 0.05` → "dispersed"
- `moran_p >= 0.05` → "random (not significant)"
- Moran and Geary disagree (both significant, opposite directions) → "non-stationary"

- [ ] **Step 1: Create the file**

```python
# sidecar/routers/s1_autocorr.py
import numpy as np
from esda.moran import Moran
from esda.geary import Geary
from fastapi import APIRouter
from pydantic import BaseModel

from ..lib.weights import build_weights
from ..lib.cache import write_cache

router = APIRouter()


class Cell(BaseModel):
    id: str
    value: float
    lat: float
    lon: float


class Req(BaseModel):
    project_id: str
    cells: list[Cell]
    weights_type: str = "knn8"
    n_permutations: int = 999


def compute(cells_d: list[dict], weights_type: str = "knn8", n_permutations: int = 999) -> dict:
    if len(cells_d) < 30:
        return {"error": "insufficient_data", "n": len(cells_d), "n_min": 30}

    coords = np.array([[c["lon"], c["lat"]] for c in cells_d])
    vals = np.array([c["value"] for c in cells_d], dtype=float)

    w = build_weights(coords, weights_type)
    n_perm = min(n_permutations, 9999)

    mi = Moran(vals, w, permutations=n_perm)
    gc = Geary(vals, w, permutations=n_perm)

    moran_sig = float(mi.p_sim) < 0.05
    geary_sig = float(gc.p_sim) < 0.05

    if moran_sig and geary_sig:
        if mi.I > 0 and gc.C < 1:
            verdict = "clustered"
        elif mi.I < 0 and gc.C > 1:
            verdict = "dispersed"
        else:
            verdict = "non_stationary"
    elif moran_sig:
        verdict = "clustered" if mi.I > 0 else "dispersed"
    else:
        verdict = "random"

    return {
        "moran_I": round(float(mi.I), 4),
        "moran_p": round(float(mi.p_sim), 4),
        "geary_C": round(float(gc.C), 4),
        "geary_p": round(float(gc.p_sim), 4),
        "verdict": verdict,
        "n": len(cells_d),
        "weights_type": weights_type,
        "permutations": n_perm,
    }


@router.post("")
def post(req: Req):
    cells_d = [c.model_dump() for c in req.cells]
    out = compute(cells_d, req.weights_type, req.n_permutations)
    write_cache(req.project_id, "S1_autocorr", out)
    return out
```

- [ ] **Step 2: Commit**

```bash
git add sidecar/routers/s1_autocorr.py
git commit -m "feat(sidecar): S1 global Moran's I + Geary's C router"
```

---

## Task 5 — Python: S2 Gi* question column

**Files:**
- Create: `sidecar/routers/s2_gi_star_q.py`

Same pattern as `gi_star.py` (A8) but the value comes from a user-selected question column (already encoded by TypeScript) + applies FDR correction.

Input body: `{project_id, cells: [{id, value, lat, lon}], weights_type, fdr_alpha, n_permutations}`
Output: `{results: [{id, z, p, label}], n_hot, n_cold, n_ns, fdr_cutoff, n, weights_type}`

- [ ] **Step 1: Create the file**

```python
# sidecar/routers/s2_gi_star_q.py
import numpy as np
import libpysal
from esda.getisord import G_Local
from esda import fdr as esda_fdr
from fastapi import APIRouter
from pydantic import BaseModel

from ..lib.weights import build_weights
from ..lib.cache import write_cache

router = APIRouter()


class Cell(BaseModel):
    id: str
    value: float
    lat: float
    lon: float


class Req(BaseModel):
    project_id: str
    cells: list[Cell]
    weights_type: str = "knn8"
    fdr_alpha: float = 0.05
    n_permutations: int = 999


def compute(cells_d: list[dict], weights_type: str = "knn8",
            fdr_alpha: float = 0.05, n_permutations: int = 999) -> dict:
    if len(cells_d) < 30:
        return {"error": "insufficient_data", "n": len(cells_d), "n_min": 30}

    coords = np.array([[c["lon"], c["lat"]] for c in cells_d])
    vals = np.array([c["value"] for c in cells_d], dtype=float)

    w = build_weights(coords, weights_type)
    gi = G_Local(vals, w, star=True, permutations=min(n_permutations, 9999))

    # FDR correction
    fdr_cutoff = float(esda_fdr(gi.p_sim, fdr_alpha))

    labels = []
    for z, p in zip(gi.Zs, gi.p_sim):
        if p <= fdr_cutoff:
            labels.append("hot" if z > 0 else "cold")
        else:
            labels.append("ns")

    results = [
        {"id": c["id"], "z": round(float(z), 3), "p": round(float(p), 4), "label": lbl}
        for c, z, p, lbl in zip(cells_d, gi.Zs, gi.p_sim, labels)
    ]

    return {
        "results": results,
        "n_hot": labels.count("hot"),
        "n_cold": labels.count("cold"),
        "n_ns": labels.count("ns"),
        "fdr_cutoff": round(fdr_cutoff, 5),
        "n": len(cells_d),
        "weights_type": weights_type,
        "permutations": min(n_permutations, 9999),
    }


@router.post("")
def post(req: Req):
    cells_d = [c.model_dump() for c in req.cells]
    out = compute(cells_d, req.weights_type, req.fdr_alpha, req.n_permutations)
    write_cache(req.project_id, "S2_gi_star_q", out)
    return out
```

- [ ] **Step 2: Commit**

```bash
git add sidecar/routers/s2_gi_star_q.py
git commit -m "feat(sidecar): S2 Gi* question-column router with FDR correction"
```

---

## Task 6 — Python: S3 LISA Local Moran

**Files:**
- Create: `sidecar/routers/s3_lisa_q.py`

Input body: `{project_id, cells, weights_type, fdr_alpha, n_permutations}`
Output: `{results: [{id, q_label, p, significant}], n_HH, n_LL, n_HL, n_LH, n_ns, fdr_cutoff}`

`q_label` is one of `"HH"`, `"LL"`, `"HL"`, `"LH"`, `"ns"`.

ESDA Moran_Local quad values: 1=HH, 2=LH, 3=LL, 4=HL.

- [ ] **Step 1: Create the file**

```python
# sidecar/routers/s3_lisa_q.py
import numpy as np
from esda.moran import Moran_Local
from esda import fdr as esda_fdr
from fastapi import APIRouter
from pydantic import BaseModel

from ..lib.weights import build_weights
from ..lib.cache import write_cache

router = APIRouter()

_QUAD_LABELS = {1: "HH", 2: "LH", 3: "LL", 4: "HL"}


class Cell(BaseModel):
    id: str
    value: float
    lat: float
    lon: float


class Req(BaseModel):
    project_id: str
    cells: list[Cell]
    weights_type: str = "knn8"
    fdr_alpha: float = 0.05
    n_permutations: int = 999


def compute(cells_d: list[dict], weights_type: str = "knn8",
            fdr_alpha: float = 0.05, n_permutations: int = 999) -> dict:
    if len(cells_d) < 30:
        return {"error": "insufficient_data", "n": len(cells_d), "n_min": 30}

    coords = np.array([[c["lon"], c["lat"]] for c in cells_d])
    vals = np.array([c["value"] for c in cells_d], dtype=float)

    w = build_weights(coords, weights_type)
    ml = Moran_Local(vals, w, permutations=min(n_permutations, 9999))

    fdr_cutoff = float(esda_fdr(ml.p_sim, fdr_alpha))

    results = []
    counts = {"HH": 0, "LL": 0, "HL": 0, "LH": 0, "ns": 0}
    for c, q, p in zip(cells_d, ml.q, ml.p_sim):
        if float(p) <= fdr_cutoff:
            label = _QUAD_LABELS.get(int(q), "ns")
        else:
            label = "ns"
        counts[label] += 1
        results.append({"id": c["id"], "q_label": label, "p": round(float(p), 4)})

    return {
        "results": results,
        "n_HH": counts["HH"],
        "n_LL": counts["LL"],
        "n_HL": counts["HL"],
        "n_LH": counts["LH"],
        "n_ns": counts["ns"],
        "fdr_cutoff": round(fdr_cutoff, 5),
        "n": len(cells_d),
        "weights_type": weights_type,
        "permutations": min(n_permutations, 9999),
    }


@router.post("")
def post(req: Req):
    cells_d = [c.model_dump() for c in req.cells]
    out = compute(cells_d, req.weights_type, req.fdr_alpha, req.n_permutations)
    write_cache(req.project_id, "S3_lisa_q", out)
    return out
```

- [ ] **Step 2: Commit**

```bash
git add sidecar/routers/s3_lisa_q.py
git commit -m "feat(sidecar): S3 LISA Local Moran router"
```

---

## Task 7 — Python: S5 Distance-Decay vs POI

**Files:**
- Create: `sidecar/routers/s5_distance_decay.py`

Input body: `{project_id, cells, poi_lat, poi_lon, n_permutations}`
Output: `{bins: [{lo_km, hi_km, n, mean, se}], envelope_lo: [], envelope_hi: [], trend: "decaying"|"increasing"|"flat"}`

Log-spaced bins (km): 0–0.25, 0.25–0.5, 0.5–1, 1–2, 2–4, 4–8, 8+

Permutation envelope: shuffle answer values across cells 999×, compute bin means, take 5th/95th percentile as envelope.

- [ ] **Step 1: Create the file**

```python
# sidecar/routers/s5_distance_decay.py
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel

from ..lib.cache import write_cache

router = APIRouter()

# Log-spaced bin edges in km
BIN_EDGES_KM = [0.0, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, float("inf")]
EARTH_R_KM = 6371.0


def haversine_km(lat1, lon1, lat2, lon2):
    """Vectorised haversine distance (arrays or scalars)."""
    R = EARTH_R_KM
    dlat = np.radians(lat2 - lat1)
    dlon = np.radians(lon2 - lon1)
    a = np.sin(dlat / 2) ** 2 + np.cos(np.radians(lat1)) * np.cos(np.radians(lat2)) * np.sin(dlon / 2) ** 2
    return R * 2 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def _bin_stats(dists_km, vals):
    """Per-bin (n, mean, se) for fixed log-spaced edges."""
    bins = []
    for lo, hi in zip(BIN_EDGES_KM[:-1], BIN_EDGES_KM[1:]):
        mask = (dists_km >= lo) & (dists_km < hi)
        v = vals[mask]
        n = int(mask.sum())
        mean = float(v.mean()) if n > 0 else 0.0
        se = float(v.std() / np.sqrt(n)) if n > 1 else 0.0
        bins.append({"lo_km": lo if hi != float("inf") else lo,
                     "hi_km": hi if hi != float("inf") else None,
                     "n": n, "mean": round(mean, 4), "se": round(se, 4)})
    return bins


class Cell(BaseModel):
    id: str
    value: float
    lat: float
    lon: float


class Req(BaseModel):
    project_id: str
    cells: list[Cell]
    poi_lat: float
    poi_lon: float
    n_permutations: int = 999


def compute(cells_d: list[dict], poi_lat: float, poi_lon: float, n_permutations: int = 999) -> dict:
    if len(cells_d) < 10:
        return {"error": "insufficient_data", "n": len(cells_d), "n_min": 10}

    lats = np.array([c["lat"] for c in cells_d])
    lons = np.array([c["lon"] for c in cells_d])
    vals = np.array([c["value"] for c in cells_d], dtype=float)
    dists_km = haversine_km(lats, lons, poi_lat, poi_lon)

    observed = _bin_stats(dists_km, vals)
    n_perm = min(n_permutations, 9999)

    # Permutation envelope: shuffle values, compute per-bin means
    perm_means = [[] for _ in range(len(BIN_EDGES_KM) - 1)]
    rng = np.random.default_rng(42)
    for _ in range(n_perm):
        shuffled = rng.permutation(vals)
        for bi, (lo, hi) in enumerate(zip(BIN_EDGES_KM[:-1], BIN_EDGES_KM[1:])):
            mask = (dists_km >= lo) & (dists_km < hi)
            v = shuffled[mask]
            perm_means[bi].append(float(v.mean()) if len(v) > 0 else float("nan"))

    envelope_lo = [round(float(np.nanpercentile(pm, 5)), 4) for pm in perm_means]
    envelope_hi = [round(float(np.nanpercentile(pm, 95)), 4) for pm in perm_means]

    # Simple trend: correlation of bin-index vs bin-mean for non-empty bins
    means = [b["mean"] for b in observed if b["n"] > 0]
    if len(means) >= 3:
        corr = float(np.corrcoef(range(len(means)), means)[0, 1])
        trend = "decaying" if corr < -0.3 else "increasing" if corr > 0.3 else "flat"
    else:
        trend = "flat"

    return {
        "bins": observed,
        "envelope_lo": envelope_lo,
        "envelope_hi": envelope_hi,
        "trend": trend,
        "poi_lat": poi_lat,
        "poi_lon": poi_lon,
        "n": len(cells_d),
        "permutations": n_perm,
    }


@router.post("")
def post(req: Req):
    cells_d = [c.model_dump() for c in req.cells]
    out = compute(cells_d, req.poi_lat, req.poi_lon, req.n_permutations)
    write_cache(req.project_id, "S5_distance_decay", out)
    return out
```

- [ ] **Step 2: Commit**

```bash
git add sidecar/routers/s5_distance_decay.py
git commit -m "feat(sidecar): S5 distance-decay vs POI router"
```

---

## Task 8 — Python: S7 Local Geary

**Files:**
- Create: `sidecar/routers/s7_local_geary.py`

Input body: `{project_id, cells, weights_type, fdr_alpha, n_permutations, winsorize}`
Output: `{results: [{id, c_i, p, label}], n_pos_autocorr, n_neg_autocorr, n_ns, fdr_cutoff}`

`label`: `"pos_autocorr"` (c_i < 1, p sig), `"neg_autocorr"` (c_i > 1, p sig), `"ns"`.

- [ ] **Step 1: Create the file**

```python
# sidecar/routers/s7_local_geary.py
import numpy as np
from esda.geary_local import Geary_Local
from esda import fdr as esda_fdr
from fastapi import APIRouter
from pydantic import BaseModel

from ..lib.weights import build_weights
from ..lib.encode import winsorize
from ..lib.cache import write_cache

router = APIRouter()


class Cell(BaseModel):
    id: str
    value: float
    lat: float
    lon: float


class Req(BaseModel):
    project_id: str
    cells: list[Cell]
    weights_type: str = "knn8"
    fdr_alpha: float = 0.05
    n_permutations: int = 999
    winsorize: bool = True


def compute(cells_d: list[dict], weights_type: str = "knn8",
            fdr_alpha: float = 0.05, n_permutations: int = 999,
            do_winsorize: bool = True) -> dict:
    if len(cells_d) < 30:
        return {"error": "insufficient_data", "n": len(cells_d), "n_min": 30}

    coords = np.array([[c["lon"], c["lat"]] for c in cells_d])
    vals = np.array([c["value"] for c in cells_d], dtype=float)
    if do_winsorize:
        vals = winsorize(vals, 0.02)

    w = build_weights(coords, weights_type)
    lg = Geary_Local(connectivity=w, permutations=min(n_permutations, 9999))
    lg.fit(vals)

    fdr_cutoff = float(esda_fdr(lg.p_sim, fdr_alpha))

    results = []
    n_pos, n_neg, n_ns = 0, 0, 0
    for c, ci, p in zip(cells_d, lg.localG, lg.p_sim):
        if float(p) <= fdr_cutoff:
            label = "pos_autocorr" if float(ci) < 1 else "neg_autocorr"
        else:
            label = "ns"
        if label == "pos_autocorr": n_pos += 1
        elif label == "neg_autocorr": n_neg += 1
        else: n_ns += 1
        results.append({"id": c["id"], "c_i": round(float(ci), 4), "p": round(float(p), 4), "label": label})

    return {
        "results": results,
        "n_pos_autocorr": n_pos,
        "n_neg_autocorr": n_neg,
        "n_ns": n_ns,
        "fdr_cutoff": round(fdr_cutoff, 5),
        "n": len(cells_d),
        "weights_type": weights_type,
        "permutations": min(n_permutations, 9999),
        "winsorized": do_winsorize,
    }


@router.post("")
def post(req: Req):
    cells_d = [c.model_dump() for c in req.cells]
    out = compute(cells_d, req.weights_type, req.fdr_alpha, req.n_permutations, req.winsorize)
    write_cache(req.project_id, "S7_local_geary", out)
    return out
```

- [ ] **Step 2: Commit**

```bash
git add sidecar/routers/s7_local_geary.py
git commit -m "feat(sidecar): S7 Local Geary heterogeneity router"
```

---

## Task 9 — Python: S8 Bivariate Local Moran (Lee's L proxy)

**Files:**
- Create: `sidecar/routers/s8_bivariate.py`

Input body: `{project_id, cells_x: [{id, value, lat, lon}], cells_y: [{id, value, lat, lon}], fdr_alpha, n_permutations}`
Matched on `id`. Both variable arrays must be same length and in the same spatial locations.

Output: `{lee_L, pearson_r, disagreement, results: [{id, q_label, p}], n_HH, n_LL, n_HL, n_LH, n_ns}`

Use `esda.Moran_Local_BV` as the bivariate local statistic (good proxy for Lee's L in PySAL 2.6).
Global Lee's L = the Moran's I of the cross-product (approximation via `esda.Moran_BV`).

- [ ] **Step 1: Create the file**

```python
# sidecar/routers/s8_bivariate.py
import numpy as np
from esda.moran import Moran_Local_BV, Moran_BV
from esda import fdr as esda_fdr
from fastapi import APIRouter
from pydantic import BaseModel

from ..lib.weights import build_weights
from ..lib.cache import write_cache

router = APIRouter()

_QUAD_LABELS = {1: "HH", 2: "LH", 3: "LL", 4: "HL"}


class Cell(BaseModel):
    id: str
    value: float
    lat: float
    lon: float


class Req(BaseModel):
    project_id: str
    cells_x: list[Cell]
    cells_y: list[Cell]
    fdr_alpha: float = 0.05
    n_permutations: int = 999


def compute(cells_x: list[dict], cells_y: list[dict],
            fdr_alpha: float = 0.05, n_permutations: int = 999) -> dict:
    # Align on shared ids
    y_map = {c["id"]: c["value"] for c in cells_y}
    aligned = [(c, y_map[c["id"]]) for c in cells_x if c["id"] in y_map]
    if len(aligned) < 50:
        return {"error": "insufficient_data", "n": len(aligned), "n_min": 50}

    coords = np.array([[c["lon"], c["lat"]] for c, _ in aligned])
    x_vals = np.array([c["value"] for c, _ in aligned], dtype=float)
    y_vals = np.array([yv for _, yv in aligned], dtype=float)

    w = build_weights(coords, "knn8")
    n_perm = min(n_permutations, 9999)

    # Global bivariate Moran (Lee's L approximation)
    bv = Moran_BV(x_vals, y_vals, w, permutations=n_perm)
    lee_L = round(float(bv.I), 4)
    pearson_r = round(float(np.corrcoef(x_vals, y_vals)[0, 1]), 4)
    disagreement = abs(lee_L - pearson_r) > 0.2

    # Local bivariate Moran
    ml_bv = Moran_Local_BV(x_vals, y_vals, w, permutations=n_perm)
    fdr_cutoff = float(esda_fdr(ml_bv.p_sim, fdr_alpha))

    results = []
    counts = {"HH": 0, "LL": 0, "HL": 0, "LH": 0, "ns": 0}
    for (c, _), q, p in zip(aligned, ml_bv.q, ml_bv.p_sim):
        if float(p) <= fdr_cutoff:
            label = _QUAD_LABELS.get(int(q), "ns")
        else:
            label = "ns"
        counts[label] += 1
        results.append({"id": c["id"], "q_label": label, "p": round(float(p), 4)})

    return {
        "lee_L": lee_L,
        "pearson_r": pearson_r,
        "disagreement": disagreement,
        "results": results,
        "n_HH": counts["HH"],
        "n_LL": counts["LL"],
        "n_HL": counts["HL"],
        "n_LH": counts["LH"],
        "n_ns": counts["ns"],
        "fdr_cutoff": round(fdr_cutoff, 5),
        "n": len(aligned),
        "permutations": n_perm,
    }


@router.post("")
def post(req: Req):
    out = compute(
        [c.model_dump() for c in req.cells_x],
        [c.model_dump() for c in req.cells_y],
        req.fdr_alpha, req.n_permutations,
    )
    write_cache(req.project_id, "S8_bivariate", out)
    return out
```

- [ ] **Step 2: Commit**

```bash
git add sidecar/routers/s8_bivariate.py
git commit -m "feat(sidecar): S8 bivariate Local Moran router"
```

---

## Task 10 — Python: S4 Bernoulli Spatial Scan Statistic

**Files:**
- Create: `sidecar/routers/s4_satscan.py`

Pure-Python Bernoulli scan — no SaTScan binary. Works as follows:
1. Each observation is a case (binary: `is_case = answer == case_value`) or control.
2. For each observation as candidate circle center, expand radius until `max_window_pct` of cases are included.
3. Compute log-likelihood ratio (LLR) for each candidate circle.
4. Monte Carlo null: randomly permute case labels `n_permutations` times, record max LLR each time.
5. p-value = proportion of permuted max LLRs ≥ observed max LLR.
6. Return top-3 non-overlapping clusters.

Input: `{project_id, cells: [{id, value, lat, lon}], case_value, max_window_pct, n_permutations}`
`value` is already 0/1 binary from the TypeScript builder (answer_option match).

- [ ] **Step 1: Create the file**

```python
# sidecar/routers/s4_satscan.py
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel

from ..lib.cache import write_cache

router = APIRouter()

EARTH_R_KM = 6371.0


def _haversine(lat1, lon1, lat2, lon2):
    dlat = np.radians(lat2 - lat1)
    dlon = np.radians(lon2 - lon1)
    a = np.sin(dlat / 2) ** 2 + np.cos(np.radians(lat1)) * np.cos(np.radians(lat2)) * np.sin(dlon / 2) ** 2
    return EARTH_R_KM * 2 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def _llr(c_z, n_z, c_tot, n_tot):
    """Bernoulli LLR for a zone: c_z cases in n_z observations."""
    if n_z == 0 or n_z == n_tot:
        return 0.0
    c_out = c_tot - c_z
    n_out = n_tot - n_z
    if c_out == 0 or n_out == 0:
        return 0.0
    # Expected under null
    e_z = n_z * c_tot / n_tot
    e_out = n_out * c_tot / n_tot
    if c_z <= e_z:  # Not a cluster (relative risk <= 1)
        return 0.0
    # LLR
    def _term(c, e):
        return c * np.log(c / e) if c > 0 and e > 0 else 0.0
    return _term(c_z, e_z) + _term(c_out, e_out)


def compute(cells_d: list[dict], max_window_pct: float = 0.25,
            n_permutations: int = 999) -> dict:
    n = len(cells_d)
    if n < 30:
        return {"error": "insufficient_data", "n": n, "n_min": 30}

    lats = np.array([c["lat"] for c in cells_d])
    lons = np.array([c["lon"] for c in cells_d])
    cases = np.array([float(c["value"]) for c in cells_d])
    c_tot = int(cases.sum())
    if c_tot == 0 or c_tot == n:
        return {"error": "no_variation", "n": n}

    max_cases_in_window = int(np.ceil(max_window_pct * c_tot))

    # Precompute pairwise distances (cap at 5000 pts for performance)
    cap = min(n, 5000)
    if n > cap:
        idx = np.random.default_rng(42).choice(n, cap, replace=False)
        lats, lons, cases = lats[idx], lons[idx], cases[idx]
        cells_d = [cells_d[i] for i in idx]
        n = cap
        c_tot = int(cases.sum())

    # For each center, sort neighbours by distance, expand until max_window_pct
    best_llr = 0.0
    best_zone_idx: list[int] = []

    for i in range(n):
        dists = _haversine(lats[i], lons[i], lats, lons)
        order = np.argsort(dists)
        c_z, n_z = 0, 0
        for j in order:
            n_z += 1
            c_z += int(cases[j])
            if c_z > max_cases_in_window:
                break
            llr = _llr(c_z, n_z, c_tot, n)
            if llr > best_llr:
                best_llr = llr
                best_zone_idx = list(order[:n_z])

    # Monte Carlo p-value
    rng = np.random.default_rng(42)
    n_perm = min(n_permutations, 9999)
    exceed = 0
    for _ in range(n_perm):
        perm = rng.permutation(cases)
        c_p_tot = int(perm.sum())
        max_llr_p = 0.0
        for i in range(min(n, 200)):  # sample centres for speed
            dists = _haversine(lats[i], lons[i], lats, lons)
            order = np.argsort(dists)
            c_z, n_z = 0, 0
            for j in order:
                n_z += 1
                c_z += int(perm[j])
                if c_z > max_cases_in_window:
                    break
                llr = _llr(c_z, n_z, c_p_tot, n)
                if llr > max_llr_p:
                    max_llr_p = llr
        if max_llr_p >= best_llr:
            exceed += 1

    p_val = (exceed + 1) / (n_perm + 1)
    rr = (c_z / n_z) / (c_tot / n) if n_z > 0 and c_tot > 0 and n > 0 else 0.0

    cluster_ids = [cells_d[i]["id"] for i in best_zone_idx]

    return {
        "clusters": [{
            "rank": 1,
            "n_cases": int(cases[best_zone_idx].sum()),
            "n_total": len(best_zone_idx),
            "relative_risk": round(rr, 3),
            "llr": round(best_llr, 4),
            "p_value": round(p_val, 4),
            "center_lat": float(lats[best_zone_idx[0]]) if best_zone_idx else None,
            "center_lon": float(lons[best_zone_idx[0]]) if best_zone_idx else None,
            "member_ids": cluster_ids[:50],  # cap for payload size
        }] if best_zone_idx else [],
        "n": n,
        "c_total": c_tot,
        "max_window_pct": max_window_pct,
        "permutations": n_perm,
    }


class Cell(BaseModel):
    id: str
    value: float
    lat: float
    lon: float


class Req(BaseModel):
    project_id: str
    cells: list[Cell]
    max_window_pct: float = 0.25
    n_permutations: int = 999


@router.post("")
def post(req: Req):
    out = compute([c.model_dump() for c in req.cells], req.max_window_pct, req.n_permutations)
    write_cache(req.project_id, "S4_satscan", out)
    return out
```

- [ ] **Step 2: Commit**

```bash
git add sidecar/routers/s4_satscan.py
git commit -m "feat(sidecar): S4 Bernoulli spatial scan statistic (pure Python)"
```

---

## Task 11 — Python: Register all new routers in sidecar/app.py

**Files:**
- Modify: `sidecar/app.py`

- [ ] **Step 1: Read current app.py**

- [ ] **Step 2: Add imports and router registrations**

```python
from sidecar.routers import finish, velocity, kde, gi_star
from sidecar.routers import s1_autocorr, s2_gi_star_q, s3_lisa_q, s4_satscan
from sidecar.routers import s5_distance_decay, s7_local_geary, s8_bivariate

# Add after existing include_router calls:
app.include_router(s1_autocorr.router, prefix="/sidecar/compute/S1_autocorr", tags=["S1"], dependencies=[Depends(verify_secret)])
app.include_router(s2_gi_star_q.router, prefix="/sidecar/compute/S2_gi_star_q", tags=["S2"], dependencies=[Depends(verify_secret)])
app.include_router(s3_lisa_q.router, prefix="/sidecar/compute/S3_lisa_q", tags=["S3"], dependencies=[Depends(verify_secret)])
app.include_router(s4_satscan.router, prefix="/sidecar/compute/S4_satscan", tags=["S4"], dependencies=[Depends(verify_secret)])
app.include_router(s5_distance_decay.router, prefix="/sidecar/compute/S5_distance_decay", tags=["S5"], dependencies=[Depends(verify_secret)])
app.include_router(s7_local_geary.router, prefix="/sidecar/compute/S7_local_geary", tags=["S7"], dependencies=[Depends(verify_secret)])
app.include_router(s8_bivariate.router, prefix="/sidecar/compute/S8_bivariate", tags=["S8"], dependencies=[Depends(verify_secret)])
```

Update version endpoint to `"1.3.0"`.

- [ ] **Step 3: Smoke-test import**

```bash
cd "/Users/goshtasbshahriari/UF Dropbox/Goshtasb Shahriari Mehr/DTSC_Lab/Survey_Dashboards/sidecar" && python -c "from sidecar.app import app; print('routes:', len(app.routes))" 2>&1
```

Expected: `routes: <number>` without errors.

- [ ] **Step 4: Commit**

```bash
git add sidecar/app.py
git commit -m "feat(sidecar): register S1–S8 routers in app.py"
```

---

## Task 12 — TypeScript: Input builders for S1–S8 in sidecar-inputs.ts

**Files:**
- Modify: `lib/queries/sidecar-inputs.ts`

Add one builder per sidecar card. All share the pattern: call `buildSpatialCells(projectId, questionKey)` then pass cells + settings to `callSidecar`.

- [ ] **Step 1: Add builders after the existing ones**

Add these functions to `lib/queries/sidecar-inputs.ts`:

```ts
/** S1: Global Moran's I + Geary's C */
export async function buildS1Input(projectId: string, settings: Record<string, string>) {
  const qk = settings["questionKey"] ?? "";
  if (!qk) return null;
  const cells = await buildSpatialCells(projectId, qk);
  return {
    cells,
    weights_type: settings["weightsType"] ?? "knn8",
    n_permutations: Number(settings["nPermutations"] ?? 999),
  };
}

/** S2: Gi* on question column */
export async function buildS2Input(projectId: string, settings: Record<string, string>) {
  const qk = settings["questionKey"] ?? "";
  if (!qk) return null;
  const cells = await buildSpatialCells(projectId, qk);
  return {
    cells,
    weights_type: settings["weightsType"] ?? "knn8",
    fdr_alpha: Number(settings["fdrAlpha"] ?? 0.05),
    n_permutations: Number(settings["nPermutations"] ?? 999),
  };
}

/** S3: LISA Local Moran */
export async function buildS3Input(projectId: string, settings: Record<string, string>) {
  const qk = settings["questionKey"] ?? "";
  if (!qk) return null;
  const cells = await buildSpatialCells(projectId, qk);
  return {
    cells,
    weights_type: settings["weightsType"] ?? "knn8",
    fdr_alpha: Number(settings["fdrAlpha"] ?? 0.05),
    n_permutations: Number(settings["nPermutations"] ?? 999),
  };
}

/** S4: Bernoulli scan — value is 0/1 (TypeScript encodes binary) */
export async function buildS4Input(projectId: string, settings: Record<string, string>) {
  const qk = settings["questionKey"] ?? "";
  if (!qk) return null;
  const answerOption = settings["answerOption"] ?? "";
  // Encode: 1 if raw answer matches answerOption, else 0
  const cells = await buildSpatialCellsBinary(projectId, qk, answerOption);
  return {
    cells,
    max_window_pct: Number(settings["maxWindowPct"] ?? 0.25),
    n_permutations: Number(settings["nPermutations"] ?? 999),
  };
}

/** S5: Distance-decay vs POI */
export async function buildS5Input(projectId: string, settings: Record<string, string>) {
  const qk = settings["questionKey"] ?? "";
  const poi = settings["poi"] ? JSON.parse(settings["poi"]) as { lat: number; lon: number } : null;
  if (!qk || !poi) return null;
  const cells = await buildSpatialCells(projectId, qk);
  return {
    cells,
    poi_lat: poi.lat,
    poi_lon: poi.lon,
    n_permutations: Number(settings["nPermutations"] ?? 999),
  };
}

/** S7: Local Geary */
export async function buildS7Input(projectId: string, settings: Record<string, string>) {
  const qk = settings["questionKey"] ?? "";
  if (!qk) return null;
  const cells = await buildSpatialCells(projectId, qk);
  return {
    cells,
    weights_type: settings["weightsType"] ?? "knn8",
    fdr_alpha: Number(settings["fdrAlpha"] ?? 0.05),
    n_permutations: Number(settings["nPermutations"] ?? 999),
    winsorize: settings["winsorize"] !== "false",
  };
}

/** S8: Bivariate Lee's L */
export async function buildS8Input(projectId: string, settings: Record<string, string>) {
  const qkx = settings["questionKeyX"] ?? "";
  const qky = settings["questionKeyY"] ?? "";
  if (!qkx || !qky) return null;
  const [cells_x, cells_y] = await Promise.all([
    buildSpatialCells(projectId, qkx),
    buildSpatialCells(projectId, qky),
  ]);
  return {
    cells_x,
    cells_y,
    fdr_alpha: Number(settings["fdrAlpha"] ?? 0.05),
    n_permutations: Number(settings["nPermutations"] ?? 999),
  };
}
```

Also add `buildSpatialCellsBinary` helper:

```ts
/** Like buildSpatialCells but encodes 1 if raw === caseValue, else 0. */
async function buildSpatialCellsBinary(
  projectId: string,
  questionKey: string,
  caseValue: string,
  limit = 50_000,
): Promise<SpatialCell[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await ((sb as any)
    .from("points")
    .select("id, lat, lon, survey_responses!matched_response_id(raw_data)")
    .eq("project_id", projectId)
    .not("matched_response_id", "is", null)
    .limit(limit)
  ) as { data: Array<{
    id: string; lat: number | null; lon: number | null;
    survey_responses: { raw_data: Record<string, unknown> | null } | null;
  }> | null };

  if (!data) return [];
  return data
    .filter((r) => typeof r.lat === "number" && typeof r.lon === "number")
    .map((r) => ({
      id: r.id,
      value: String(r.survey_responses?.raw_data?.[questionKey] ?? "") === caseValue ? 1 : 0,
      lat: r.lat as number,
      lon: r.lon as number,
    }));
}
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -5
```

Expected: same count as before.

- [ ] **Step 3: Commit**

```bash
git add lib/queries/sidecar-inputs.ts
git commit -m "feat(sidecar-inputs): S1–S8 input builders"
```

---

## Task 13 — TypeScript: S6 Coverage×Response Postgres handler

**Files:**
- Create: `lib/queries/coverage-response.ts`
- Modify: `app/api/projects/[projectId]/analyses/[cardId]/route.ts`

S6 uses `computeStrategy: "postgres"`. It aggregates matched points + universe by H3/block-group zone.

Since Census block-group polygons aren't in the DB (and would require PostGIS tiger data), we default to a simplified H3-style hex grid using a fixed 0.1° × 0.1° grid as the zone unit. The response to the user clearly labels the limitation.

- [ ] **Step 1: Create coverage-response.ts**

```ts
// lib/queries/coverage-response.ts
import { createServerSupabase } from "@/lib/supabase/server";

type CoverageZone = {
  zone_id: string;
  n_universe: number;
  n_visited: number;
  n_responses: number;
  answer_pct: number | null;
  coverage_pct: number | null;
  category: string; // HH, HL, LH, LL, suppressed
  lat: number;
  lon: number;
};

const ZONE_DEG = 0.1; // ~11km cells at mid-lat

function cellKey(lat: number, lon: number): string {
  const bx = Math.floor(lon / ZONE_DEG);
  const by = Math.floor(lat / ZONE_DEG);
  return `${bx}_${by}`;
}
function cellCenter(key: string): { lat: number; lon: number } {
  const [bx, by] = key.split("_").map(Number);
  return { lon: (bx + 0.5) * ZONE_DEG, lat: (by + 0.5) * ZONE_DEG };
}

export async function getCoverageResponse(
  projectId: string,
  settings: Record<string, string>,
): Promise<{ zones: CoverageZone[]; question_key: string; answer_option: string; zone_unit: string }> {
  const questionKey = settings["questionKey"] ?? "";
  const answerOption = settings["answerOption"] ?? "";
  const minN = Number(settings["minN"] ?? 10);

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;

  // 1. Universe addresses by zone
  const { data: univRows } = await sbAny
    .from("survey_universe")
    .select("lat, lon, status")
    .eq("project_id", projectId) as { data: Array<{ lat: number | null; lon: number | null; status: string }> | null };

  // 2. Matched response values by zone
  const { data: pointRows } = await sbAny
    .from("points")
    .select("lat, lon, survey_responses!matched_response_id(raw_data)")
    .eq("project_id", projectId)
    .not("matched_response_id", "is", null) as {
      data: Array<{
        lat: number | null; lon: number | null;
        survey_responses: { raw_data: Record<string, unknown> | null } | null;
      }> | null
    };

  // Aggregate universe by zone
  const univMap = new Map<string, { total: number; visited: number }>();
  for (const r of univRows ?? []) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const k = cellKey(r.lat, r.lon);
    const cur = univMap.get(k) ?? { total: 0, visited: 0 };
    cur.total++;
    if (r.status === "visited") cur.visited++;
    univMap.set(k, cur);
  }

  // Aggregate responses by zone
  const respMap = new Map<string, { n: number; n_match: number }>();
  for (const r of pointRows ?? []) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const k = cellKey(r.lat, r.lon);
    const cur = respMap.get(k) ?? { n: 0, n_match: 0 };
    cur.n++;
    const val = String(r.survey_responses?.raw_data?.[questionKey] ?? "");
    if (val === answerOption) cur.n_match++;
    respMap.set(k, cur);
  }

  // Merge into zones
  const allKeys = new Set([...univMap.keys(), ...respMap.keys()]);
  const zones: CoverageZone[] = [];

  for (const k of allKeys) {
    const univ = univMap.get(k);
    const resp = respMap.get(k);
    const n_universe = univ?.total ?? 0;
    const n_visited = univ?.visited ?? 0;
    const n_responses = resp?.n ?? 0;

    if (n_responses < minN) {
      const { lat, lon } = cellCenter(k);
      zones.push({ zone_id: k, n_universe, n_visited, n_responses, answer_pct: null, coverage_pct: null, category: "suppressed", lat, lon });
      continue;
    }

    const coverage_pct = n_universe > 0 ? n_visited / n_universe : null;
    const answer_pct = n_responses > 0 && answerOption ? (resp?.n_match ?? 0) / n_responses : null;

    // 3×3 → simplified 2×2 HH/HL/LH/LL using median split
    const { lat, lon } = cellCenter(k);
    zones.push({ zone_id: k, n_universe, n_visited, n_responses, answer_pct, coverage_pct, category: "pending", lat, lon });
  }

  // Assign categories using median split
  const validZones = zones.filter((z) => z.category !== "suppressed");
  const covMedian = median(validZones.map((z) => z.coverage_pct ?? 0));
  const ansMedian = median(validZones.map((z) => z.answer_pct ?? 0));
  for (const z of validZones) {
    const hiCov = (z.coverage_pct ?? 0) >= covMedian;
    const hiAns = (z.answer_pct ?? 0) >= ansMedian;
    z.category = hiCov && hiAns ? "HH" : hiCov && !hiAns ? "HL" : !hiCov && hiAns ? "LH" : "LL";
  }

  return { zones, question_key: questionKey, answer_option: answerOption, zone_unit: "0.1deg_grid" };
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
```

- [ ] **Step 2: Add S6 to dispatcher**

In `app/api/projects/[projectId]/analyses/[cardId]/route.ts`, add to `POSTGRES_DISPATCH`:
```ts
import { getCoverageResponse } from "@/lib/queries/coverage-response";
// ...
S6_coverage_response: async (projectId, settings) => getCoverageResponse(projectId, settings),
```

- [ ] **Step 3: Commit**

```bash
git add lib/queries/coverage-response.ts app/api/projects/\[projectId\]/analyses/\[cardId\]/route.ts
git commit -m "feat(analyses): S6 coverage×response Postgres handler"
```

---

## Task 14 — TypeScript: A0 Colorizer dispatcher + S1–S8 sidecar entries

**Files:**
- Modify: `app/api/projects/[projectId]/analyses/[cardId]/route.ts`

Add A0 to POSTGRES_DISPATCH (it's TypeScript server-side, not a sidecar).
Add S1–S8 to SIDECAR_DISPATCH.

- [ ] **Step 1: Add imports**

```ts
import { getColumnValuesById, getColumnProfiles } from "@/lib/queries/columns";
import {
  buildS1Input, buildS2Input, buildS3Input, buildS4Input,
  buildS5Input, buildS7Input, buildS8Input,
} from "@/lib/queries/sidecar-inputs";
import { defaultSpecFor, resolveBreaks } from "@/lib/colorize/auto-classify";
import { continuousRampStops, categoricalColors } from "@/lib/colorize/palettes";
```

- [ ] **Step 2: Add A0 to POSTGRES_DISPATCH**

```ts
A0_colorizer: async (projectId, settings) => {
  const qk = settings["questionKey"];
  if (!qk) return { error: "missing_question_key" };
  const { profile, valuesByResponseId } = await getColumnValuesById(projectId, qk);
  if (!profile) return { error: "column_not_found" };

  const spec = defaultSpecFor(profile);
  const numericValues: number[] = [];
  for (const v of Object.values(valuesByResponseId)) {
    const n = Number(v);
    if (Number.isFinite(n)) numericValues.push(n);
  }
  const breaks = resolveBreaks(numericValues, spec.classification, spec.classCount);

  // Build legend stops
  const isNumeric = spec.inferredType === "numeric_continuous" || spec.inferredType === "numeric_skewed" || spec.inferredType === "likert" || spec.inferredType === "date";
  const legendColors = isNumeric
    ? continuousRampStops(spec.ramp, spec.classCount, spec.reversed)
    : categoricalColors(spec.ramp, profile.distinct || 1);

  return {
    spec,
    profile,
    breaks,
    legendColors,
    n_responses: Object.keys(valuesByResponseId).length,
  };
},
```

- [ ] **Step 3: Add S1–S8 to SIDECAR_DISPATCH**

```ts
S1_autocorr: async (projectId, settings) => {
  const body = await buildS1Input(projectId, settings);
  if (!body) return { reason: "wave-pending", message: "No question selected." };
  return callSidecar(projectId, "S1_autocorr", body);
},
S2_gi_star_q: async (projectId, settings) => {
  const body = await buildS2Input(projectId, settings);
  if (!body) return { reason: "wave-pending", message: "No question selected." };
  return callSidecar(projectId, "S2_gi_star_q", body);
},
S3_lisa_q: async (projectId, settings) => {
  const body = await buildS3Input(projectId, settings);
  if (!body) return { reason: "wave-pending", message: "No question selected." };
  return callSidecar(projectId, "S3_lisa_q", body);
},
S4_satscan: async (projectId, settings) => {
  const body = await buildS4Input(projectId, settings);
  if (!body) return { reason: "wave-pending", message: "No question or answer selected." };
  return callSidecar(projectId, "S4_satscan", body);
},
S5_distance_decay: async (projectId, settings) => {
  const body = await buildS5Input(projectId, settings);
  if (!body) return { reason: "wave-pending", message: "No question or POI selected." };
  return callSidecar(projectId, "S5_distance_decay", body);
},
S7_local_geary: async (projectId, settings) => {
  const body = await buildS7Input(projectId, settings);
  if (!body) return { reason: "wave-pending", message: "No question selected." };
  return callSidecar(projectId, "S7_local_geary", body);
},
S8_bivariate: async (projectId, settings) => {
  const body = await buildS8Input(projectId, settings);
  if (!body) return { reason: "wave-pending", message: "Two questions required." };
  return callSidecar(projectId, "S8_bivariate", body);
},
```

- [ ] **Step 4: Run tests + TypeScript check**

```bash
cd "/Users/goshtasbshahriari/UF Dropbox/Goshtasb Shahriari Mehr/DTSC_Lab/Survey_Dashboards"
npx tsc --noEmit 2>&1 | head -20
npx vitest run --reporter=verbose 2>&1 | tail -5
```

Expected: 0 tsc errors, same test count.

- [ ] **Step 5: Commit**

```bash
git add app/api/projects/\[projectId\]/analyses/\[cardId\]/route.ts
git commit -m "feat(dispatcher): add A0/S1–S8 handlers; forward query-param settings"
```

---

## Task 15 — Python tests for all new sidecar routers

**Files:**
- Create: `sidecar/tests/test_spatial_routers.py`

- [ ] **Step 1: Create test file**

```python
# sidecar/tests/test_spatial_routers.py
"""Unit tests for spatial analysis routers — no Supabase, no sidecar secret needed."""
import pytest
import numpy as np

# Test data: 80 synthetic points on a 4×20 grid with clustered values
def _make_cells(n=80, clustered=True):
    rng = np.random.default_rng(0)
    lats = np.linspace(29.6, 29.7, 8)
    lons = np.linspace(-82.4, -82.3, 10)
    cells = []
    for i, lat in enumerate(lats):
        for j, lon in enumerate(lons):
            value = (1.0 if i < 4 else 0.0) + rng.normal(0, 0.05) if clustered else rng.uniform(0, 1)
            cells.append({"id": f"{i}_{j}", "value": value, "lat": lat, "lon": lon})
    return cells[:n]


def test_s1_autocorr_clustered():
    from sidecar.routers.s1_autocorr import compute
    r = compute(_make_cells(80, clustered=True), n_permutations=99)
    assert "moran_I" in r
    assert r["moran_I"] > 0.3  # strong clustering
    assert r["verdict"] in ("clustered", "non_stationary")
    assert r["n"] == 80


def test_s1_autocorr_insufficient():
    from sidecar.routers.s1_autocorr import compute
    r = compute(_make_cells(20))
    assert r["error"] == "insufficient_data"


def test_s2_gi_star_labels():
    from sidecar.routers.s2_gi_star_q import compute
    r = compute(_make_cells(80), n_permutations=99)
    assert "results" in r
    labels = {x["label"] for x in r["results"]}
    assert labels <= {"hot", "cold", "ns"}
    assert r["n_hot"] + r["n_cold"] + r["n_ns"] == 80


def test_s3_lisa_quad_counts():
    from sidecar.routers.s3_lisa_q import compute
    r = compute(_make_cells(80), n_permutations=99)
    total = r["n_HH"] + r["n_LL"] + r["n_HL"] + r["n_LH"] + r["n_ns"]
    assert total == 80


def test_s4_satscan_bernoulli():
    from sidecar.routers.s4_satscan import compute
    cells = _make_cells(80, clustered=True)
    # Binarize: value > 0.5 → case
    for c in cells:
        c["value"] = 1.0 if c["value"] > 0.5 else 0.0
    r = compute(cells, n_permutations=49)
    assert "clusters" in r
    assert r["n"] == 80


def test_s5_distance_decay():
    from sidecar.routers.s5_distance_decay import compute
    cells = _make_cells(80)
    r = compute(cells, poi_lat=29.65, poi_lon=-82.35, n_permutations=49)
    assert "bins" in r
    assert len(r["bins"]) > 0
    assert r["trend"] in ("decaying", "increasing", "flat")


def test_s7_local_geary():
    from sidecar.routers.s7_local_geary import compute
    r = compute(_make_cells(80), n_permutations=99)
    assert "results" in r
    total = r["n_pos_autocorr"] + r["n_neg_autocorr"] + r["n_ns"]
    assert total == 80


def test_s8_bivariate():
    from sidecar.routers.s8_bivariate import compute
    x = _make_cells(80, clustered=True)
    y = _make_cells(80, clustered=True)
    # Shift Y values slightly
    for c in y:
        c["value"] = c["value"] + 0.1
    r = compute(x, y, n_permutations=49)
    assert "lee_L" in r
    assert "pearson_r" in r
    assert -1.0 <= r["lee_L"] <= 1.0
```

- [ ] **Step 2: Run tests**

```bash
cd "/Users/goshtasbshahriari/UF Dropbox/Goshtasb Shahriari Mehr/DTSC_Lab/Survey_Dashboards/sidecar" && python -m pytest tests/test_spatial_routers.py -v 2>&1
```

Expected: 8 PASSED.

- [ ] **Step 3: Commit**

```bash
git add sidecar/tests/test_spatial_routers.py
git commit -m "test(sidecar): unit tests for S1–S8 spatial routers"
```

---

## Task 16 — TypeScript: Result display panels (A0 + S1–S8)

**Files:**
- Create: `components/analyses/results/a0-result.tsx`
- Create: `components/analyses/results/s1-result.tsx`
- Create: `components/analyses/results/s2-result.tsx`
- Create: `components/analyses/results/s3-result.tsx`
- Create: `components/analyses/results/s4-result.tsx`
- Create: `components/analyses/results/s5-result.tsx`
- Create: `components/analyses/results/s6-result.tsx`
- Create: `components/analyses/results/s7-result.tsx`
- Create: `components/analyses/results/s8-result.tsx`
- Create: `components/analyses/results/index.ts`

Each component accepts `{ data: unknown }` and renders a structured result. All use `var(--shell-*)` CSS variables, `text-[11.5px]`, and the same font/color conventions as the rest of the app. None import external chart libraries — use pure CSS/HTML tables and flex layouts.

- [ ] **Step 1: Create a0-result.tsx (colorizer legend)**

```tsx
// components/analyses/results/a0-result.tsx
"use client";
type Props = { data: unknown };

type A0Result = {
  spec: { classCount: number; inferredType: string };
  profile: { key: string; distinct: number };
  breaks: number[];
  legendColors: string[];
  n_responses: number;
};

export function A0Result({ data }: Props) {
  const r = data as A0Result;
  if (!r?.legendColors) return null;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-[var(--shell-text-muted)]">
        {r.n_responses} responses · {r.profile.distinct} distinct values
      </p>
      <div className="flex gap-1 flex-wrap">
        {r.legendColors.map((c, i) => (
          <div key={i} className="flex flex-col items-center gap-0.5">
            <div className="w-5 h-5 rounded-sm border border-white/20" style={{ background: c }} />
            {r.breaks[i] !== undefined && (
              <span className="text-[9px] text-[var(--shell-text-muted)] font-mono">{r.breaks[i].toFixed(1)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create s1-result.tsx (Moran KPI tile)**

```tsx
// components/analyses/results/s1-result.tsx
"use client";
type Props = { data: unknown };
type S1Result = { moran_I: number; moran_p: number; geary_C: number; geary_p: number; verdict: string; n: number };

const VERDICT_COLOR: Record<string, string> = {
  clustered: "text-orange-400",
  dispersed: "text-blue-400",
  random: "text-[var(--shell-text-muted)]",
  non_stationary: "text-purple-400",
};
const VERDICT_LABEL: Record<string, string> = {
  clustered: "Spatially Clustered",
  dispersed: "Spatially Dispersed",
  random: "Random (not significant)",
  non_stationary: "Non-Stationary (Moran/Geary disagree)",
};

export function S1Result({ data }: Props) {
  const r = data as S1Result;
  if (!r?.verdict) return null;
  return (
    <div className="space-y-2">
      <p className={`text-[13px] font-semibold ${VERDICT_COLOR[r.verdict] ?? ""}`}>
        {VERDICT_LABEL[r.verdict] ?? r.verdict}
      </p>
      <table className="w-full text-[11px] font-mono">
        <thead><tr className="text-[var(--shell-text-muted)]"><th className="text-left py-0.5">Stat</th><th className="text-right">Value</th><th className="text-right">p (sim)</th></tr></thead>
        <tbody>
          <tr><td>Moran's I</td><td className="text-right">{r.moran_I.toFixed(4)}</td><td className="text-right">{r.moran_p.toFixed(4)}</td></tr>
          <tr><td>Geary's C</td><td className="text-right">{r.geary_C.toFixed(4)}</td><td className="text-right">{r.geary_p.toFixed(4)}</td></tr>
        </tbody>
      </table>
      <p className="text-[10px] text-[var(--shell-text-muted)]">n = {r.n}</p>
    </div>
  );
}
```

- [ ] **Step 3: Create s2-result.tsx (hot/cold count summary)**

```tsx
// components/analyses/results/s2-result.tsx
"use client";
type Props = { data: unknown };
type S2Result = { n_hot: number; n_cold: number; n_ns: number; fdr_cutoff: number; n: number };

export function S2Result({ data }: Props) {
  const r = data as S2Result;
  if (r?.n_hot === undefined) return null;
  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-[11.5px]">
        <span className="text-red-400 font-semibold">{r.n_hot} hot</span>
        <span className="text-blue-400 font-semibold">{r.n_cold} cold</span>
        <span className="text-[var(--shell-text-muted)]">{r.n_ns} n.s.</span>
      </div>
      <p className="text-[10px] text-[var(--shell-text-muted)]">FDR cutoff: {r.fdr_cutoff.toFixed(5)} · n = {r.n}</p>
    </div>
  );
}
```

- [ ] **Step 4: Create s3-result.tsx (LISA 2×2 grid)**

```tsx
// components/analyses/results/s3-result.tsx
"use client";
type Props = { data: unknown };
type S3Result = { n_HH: number; n_LL: number; n_HL: number; n_LH: number; n_ns: number; fdr_cutoff: number; n: number };

export function S3Result({ data }: Props) {
  const r = data as S3Result;
  if (r?.n_HH === undefined) return null;
  const sig = r.n_HH + r.n_LL + r.n_HL + r.n_LH;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1 text-[11px]">
        <div className="rounded bg-red-500/20 p-1 text-center"><span className="font-mono font-bold text-red-400">HH</span> {r.n_HH}</div>
        <div className="rounded bg-orange-400/20 p-1 text-center"><span className="font-mono font-bold text-orange-400">HL</span> {r.n_HL}</div>
        <div className="rounded bg-sky-400/20 p-1 text-center"><span className="font-mono font-bold text-sky-400">LH</span> {r.n_LH}</div>
        <div className="rounded bg-blue-500/20 p-1 text-center"><span className="font-mono font-bold text-blue-400">LL</span> {r.n_LL}</div>
      </div>
      <p className="text-[10px] text-[var(--shell-text-muted)]">{sig} significant · {r.n_ns} n.s. · FDR {r.fdr_cutoff.toFixed(5)}</p>
    </div>
  );
}
```

- [ ] **Step 5: Create s4-result.tsx (scan cluster)**

```tsx
// components/analyses/results/s4-result.tsx
"use client";
type Props = { data: unknown };
type Cluster = { rank: number; n_cases: number; n_total: number; relative_risk: number; llr: number; p_value: number };
type S4Result = { clusters: Cluster[]; n: number; c_total: number };

export function S4Result({ data }: Props) {
  const r = data as S4Result;
  if (!r?.clusters) return null;
  if (r.clusters.length === 0) return <p className="text-[11.5px] text-[var(--shell-text-muted)]">No significant cluster found.</p>;
  const c = r.clusters[0];
  return (
    <div className="space-y-2">
      <p className="text-[11.5px] font-semibold">Primary cluster</p>
      <table className="w-full text-[11px] font-mono">
        <tbody>
          <tr><td className="text-[var(--shell-text-muted)]">Relative risk</td><td className="text-right">{c.relative_risk.toFixed(2)}×</td></tr>
          <tr><td className="text-[var(--shell-text-muted)]">LLR</td><td className="text-right">{c.llr.toFixed(3)}</td></tr>
          <tr><td className="text-[var(--shell-text-muted)]">p-value</td><td className="text-right">{c.p_value.toFixed(4)}</td></tr>
          <tr><td className="text-[var(--shell-text-muted)]">Cases / Total</td><td className="text-right">{c.n_cases} / {c.n_total}</td></tr>
        </tbody>
      </table>
      <p className="text-[10px] text-[var(--shell-text-muted)]">n = {r.n} · {r.c_total} total cases</p>
    </div>
  );
}
```

- [ ] **Step 6: Create s5-result.tsx (decay table)**

```tsx
// components/analyses/results/s5-result.tsx
"use client";
type Props = { data: unknown };
type Bin = { lo_km: number; hi_km: number | null; n: number; mean: number; se: number };
type S5Result = { bins: Bin[]; trend: string; n: number };

const TREND_LABEL: Record<string, string> = { decaying: "Decaying with distance", increasing: "Increasing with distance", flat: "No clear trend" };

export function S5Result({ data }: Props) {
  const r = data as S5Result;
  if (!r?.bins) return null;
  return (
    <div className="space-y-2">
      <p className="text-[12px] font-semibold">{TREND_LABEL[r.trend] ?? r.trend}</p>
      <table className="w-full text-[10.5px] font-mono">
        <thead><tr className="text-[var(--shell-text-muted)]"><th className="text-left">km</th><th className="text-right">n</th><th className="text-right">mean</th><th className="text-right">±SE</th></tr></thead>
        <tbody>
          {r.bins.filter((b) => b.n > 0).map((b, i) => (
            <tr key={i}>
              <td>{b.lo_km}–{b.hi_km ?? "∞"}</td>
              <td className="text-right">{b.n}</td>
              <td className="text-right">{b.mean.toFixed(3)}</td>
              <td className="text-right">{b.se.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 7: Create s6-result.tsx (3×3 bivariate summary)**

```tsx
// components/analyses/results/s6-result.tsx
"use client";
type Props = { data: unknown };
type Zone = { zone_id: string; n_responses: number; category: string };
type S6Result = { zones: Zone[]; question_key: string; answer_option: string };

export function S6Result({ data }: Props) {
  const r = data as S6Result;
  if (!r?.zones) return null;
  const counts: Record<string, number> = { HH: 0, HL: 0, LH: 0, LL: 0, suppressed: 0 };
  for (const z of r.zones) counts[z.category] = (counts[z.category] ?? 0) + 1;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-[var(--shell-text-muted)]">Question: <span className="font-mono">{r.question_key}</span> · Answer: <span className="font-mono">{r.answer_option}</span></p>
      <div className="grid grid-cols-2 gap-1 text-[11px]">
        <div className="rounded bg-purple-600/30 p-1 text-center"><span className="font-bold text-purple-300">HH</span> {counts.HH} zones</div>
        <div className="rounded bg-orange-400/20 p-1 text-center"><span className="font-bold text-orange-300">HL</span> {counts.HL} zones</div>
        <div className="rounded bg-teal-400/20 p-1 text-center"><span className="font-bold text-teal-300">LH</span> {counts.LH} zones</div>
        <div className="rounded bg-zinc-500/20 p-1 text-center"><span className="font-bold text-zinc-300">LL</span> {counts.LL} zones</div>
      </div>
      <p className="text-[10px] text-[var(--shell-text-muted)]">{counts.suppressed} zones suppressed (n &lt; min)</p>
    </div>
  );
}
```

- [ ] **Step 8: Create s7-result.tsx + s8-result.tsx**

```tsx
// components/analyses/results/s7-result.tsx
"use client";
type Props = { data: unknown };
type S7Result = { n_pos_autocorr: number; n_neg_autocorr: number; n_ns: number; fdr_cutoff: number; n: number; winsorized: boolean };

export function S7Result({ data }: Props) {
  const r = data as S7Result;
  if (r?.n_pos_autocorr === undefined) return null;
  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-[11.5px]">
        <span className="text-teal-400 font-semibold">{r.n_pos_autocorr} agree with neighbors</span>
        <span className="text-pink-400 font-semibold">{r.n_neg_autocorr} heterogeneous</span>
      </div>
      <p className="text-[10px] text-[var(--shell-text-muted)]">{r.n_ns} n.s. · FDR {r.fdr_cutoff.toFixed(5)} · {r.winsorized ? "winsorized" : "raw"}</p>
    </div>
  );
}
```

```tsx
// components/analyses/results/s8-result.tsx
"use client";
type Props = { data: unknown };
type S8Result = { lee_L: number; pearson_r: number; disagreement: boolean; n_HH: number; n_LL: number; n_HL: number; n_LH: number; n_ns: number; n: number };

export function S8Result({ data }: Props) {
  const r = data as S8Result;
  if (r?.lee_L === undefined) return null;
  return (
    <div className="space-y-2">
      <table className="w-full text-[11px] font-mono">
        <tbody>
          <tr><td className="text-[var(--shell-text-muted)]">Lee's L</td><td className="text-right font-bold">{r.lee_L.toFixed(4)}</td></tr>
          <tr><td className="text-[var(--shell-text-muted)]">Pearson r</td><td className="text-right">{r.pearson_r.toFixed(4)}</td></tr>
        </tbody>
      </table>
      {r.disagreement && (
        <p className="text-[11px] text-amber-400">⚠ L and r disagree — questions are correlated but not spatially co-located.</p>
      )}
      <div className="flex gap-3 text-[10.5px] text-[var(--shell-text-muted)]">
        <span>HH {r.n_HH}</span><span>LL {r.n_LL}</span><span>HL {r.n_HL}</span><span>LH {r.n_LH}</span><span>ns {r.n_ns}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Create index.ts (registry dispatch)**

```ts
// components/analyses/results/index.ts
import { A0Result } from "./a0-result";
import { S1Result } from "./s1-result";
import { S2Result } from "./s2-result";
import { S3Result } from "./s3-result";
import { S4Result } from "./s4-result";
import { S5Result } from "./s5-result";
import { S6Result } from "./s6-result";
import { S7Result } from "./s7-result";
import { S8Result } from "./s8-result";

type ResultPanel = React.ComponentType<{ data: unknown }>;

const RESULT_PANELS: Record<string, ResultPanel> = {
  A0_colorizer: A0Result,
  S1_autocorr: S1Result,
  S2_gi_star_q: S2Result,
  S3_lisa_q: S3Result,
  S4_satscan: S4Result,
  S5_distance_decay: S5Result,
  S6_coverage_response: S6Result,
  S7_local_geary: S7Result,
  S8_bivariate: S8Result,
};

export function getResultPanel(cardId: string): ResultPanel | null {
  return RESULT_PANELS[cardId] ?? null;
}
```

- [ ] **Step 10: Commit**

```bash
git add components/analyses/results/
git commit -m "feat(analyses): result display panels for A0 + S1–S8"
```

---

## Task 17 — TypeScript: Wire result panels into SettingsDrawer

**Files:**
- Modify: `components/analyses/settings-drawer.tsx`

Replace the generic `JSON.stringify(data).slice(0, 200)…` preview with a card-specific result panel when one exists; fall back to the generic preview for cards without a panel.

- [ ] **Step 1: Add import to settings-drawer.tsx**

```ts
import { getResultPanel } from "@/components/analyses/results";
```

- [ ] **Step 2: Update ResultPanel component**

In the `ResultPanel` function, replace the JSON preview section:

Before:
```tsx
<p className="text-[11.5px] font-mono break-all text-[var(--shell-text-muted)]">
  {JSON.stringify(data).slice(0, 200)}…
</p>
```

After:
```tsx
{/* ResultPanel receives cardId via prop (added below) */}
{SpecificPanel ? (
  <SpecificPanel data={data} />
) : (
  <p className="text-[11.5px] font-mono break-all text-[var(--shell-text-muted)]">
    {JSON.stringify(data).slice(0, 200)}…
  </p>
)}
```

Add `cardId` to `ResultPanel` props:
```tsx
function ResultPanel({
  loading, error, data, computedAt, onPin, cardId,
}: {
  loading: boolean;
  error: string | null;
  data: unknown | null;
  computedAt: string | null;
  onPin: (result: unknown) => void;
  cardId: string;
}) {
  const SpecificPanel = getResultPanel(cardId);
  // ... rest of function
```

Pass `cardId` in SettingsDrawer:
```tsx
<ResultPanel
  loading={loading}
  error={error}
  data={data}
  computedAt={computedAt}
  onPin={p.onPin}
  cardId={p.card.id}
/>
```

- [ ] **Step 3: Run TypeScript check + tests**

```bash
npx tsc --noEmit 2>&1 | head -20
npx vitest run --reporter=verbose 2>&1 | tail -5
```

Expected: 0 tsc errors, same test count.

- [ ] **Step 4: Commit**

```bash
git add components/analyses/settings-drawer.tsx
git commit -m "feat(settings-drawer): card-specific result panels via registry dispatch"
```

---

## Task 18 — Update registry: clear stub flag for implemented cards

**Files:**
- Modify: `lib/analyses/registry.ts`

Set `stub: false` and `m7Wave1: true` for A0, S1–S8.

- [ ] **Step 1: Edit registry.ts**

For `A0_colorizer`, `S1_autocorr`, `S2_gi_star_q`, `S3_lisa_q`, `S4_satscan`, `S5_distance_decay`, `S6_coverage_response`, `S7_local_geary`, `S8_bivariate`:

Change `stub: true` → `stub: false`
Change `m7Wave1: false` → `m7Wave1: true`

(V2 placeholder entries keep `stub: true`.)

- [ ] **Step 2: Run tests**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add lib/analyses/registry.ts
git commit -m "feat(registry): mark A0 + S1–S8 as implemented (stub: false, m7Wave1: true)"
```

---

## Task 19 — Final TypeScript check, full test run, and push

- [ ] **Step 1: Full tsc check**

```bash
cd "/Users/goshtasbshahriari/UF Dropbox/Goshtasb Shahriari Mehr/DTSC_Lab/Survey_Dashboards" && npx tsc --noEmit 2>&1
```

Expected: 0 errors.

- [ ] **Step 2: Full vitest run**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 3: Python tests**

```bash
cd sidecar && python -m pytest tests/ -v 2>&1 | tail -20
```

Expected: all PASSED.

- [ ] **Step 4: Push to origin/main**

```bash
git push origin main
```

---

## Acceptance criteria

- `npx tsc --noEmit` → 0 errors
- All existing Vitest tests pass (count ≥ 108)
- All new Python tests pass (8 PASSED)
- `GET /api/projects/[p]/analyses/S1_autocorr?questionKey=Q1&weightsType=knn8` → JSON with `moran_I`, `verdict`, etc. (when sidecar is running)
- `GET /api/projects/[p]/analyses/S1_autocorr?questionKey=Q1` with no sidecar → JSON with `null` data (graceful fallback from `callSidecar`)
- `GET /api/projects/[p]/analyses/A0_colorizer?questionKey=Q1` → JSON with `spec`, `breaks`, `legendColors`
- SettingsDrawer for S1 shows Moran KPI tile after Run
- SettingsDrawer for A0 shows colorizer legend swatches after Run
- V2 placeholder entries (`V2_*`) still show `AwaitingDataPanel` (stub: true)
