"""
V2 Emerging Hot Spot Analysis — Temporal Gi* + Mann-Kendall trend classification.

Algorithm
---------
1. Group response-point pairs by time bucket (day / week / month).
2. For each time step with ≥5 rows, compute local Gi* z-scores via esda G_Local.
3. For each unique location build a Gi* z-score time series across all steps.
4. Apply the Mann-Kendall trend test (scipy.stats.kendalltau) to each series.
5. Classify each location into one of 13 ESRI-style Emerging Hot Spot categories.

References
----------
Getis & Ord (1992) Gi* statistic
Mann (1945) / Kendall (1975) non-parametric monotonic trend test
ArcGIS Pro "Emerging Hot Spot Analysis" classification logic
"""
import numpy as np
from scipy import stats
import libpysal
from esda.getisord import G_Local
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel

from ..lib.cache import write_cache

router = APIRouter()

# ── ESRI-style category labels ──────────────────────────────────────────────
_NH  = "New Hot Spot"
_CsH = "Consecutive Hot Spot"
_IH  = "Intensifying Hot Spot"
_PH  = "Persistent Hot Spot"
_DH  = "Diminishing Hot Spot"
_SH  = "Sporadic Hot Spot"
_OscH = "Oscillating Hot Spot"
_HistH = "Historical Hot Spot"
_NC  = "New Cold Spot"
_CsC = "Consecutive Cold Spot"
_IC  = "Intensifying Cold Spot"
_PC  = "Persistent Cold Spot"
_DC  = "Diminishing Cold Spot"
_SC  = "Sporadic Cold Spot"
_OscC = "Oscillating Cold Spot"
_HistC = "Historical Cold Spot"
_NP  = "No Pattern"

CATEGORY_COLORS = {
    _NH: "#d73027", _CsH: "#f46d43", _IH: "#fdae61", _PH: "#fee090",
    _DH: "#ffeda0", _SH: "#ffd700", _OscH: "#fd8d3c", _HistH: "#fecc5c",
    _NC: "#4575b4", _CsC: "#74add1", _IC: "#abd9e9", _PC: "#e0f3f8",
    _DC: "#d0e4f0", _SC: "#a6bddb", _OscC: "#2c7fb8", _HistC: "#a8ddb5",
    _NP: "#888888",
}


def _parse_dt(val) -> Optional[datetime]:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.replace(tzinfo=timezone.utc) if val.tzinfo is None else val
    try:
        s = str(val).replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _bucket_key(dt: datetime, mode: str) -> tuple:
    if mode == "day":
        return (dt.year, dt.month, dt.day)
    elif mode == "month":
        return (dt.year, dt.month)
    else:  # week (default)
        iso = dt.isocalendar()
        return (iso[0], iso[1])


def _classify(z_vals: np.ndarray, sig_vals: np.ndarray) -> str:
    """
    Classify a location from its z-score series and per-step significance.
    sig_vals: boolean array, True if significant at p<0.05 that step.
    """
    n = len(z_vals)
    if n < 3:
        return _NP

    hot = (z_vals > 0) & sig_vals
    cold = (z_vals < 0) & sig_vals
    last_hot = bool(hot[-1])
    last_cold = bool(cold[-1])
    hot_pct = float(hot.sum()) / n
    cold_pct = float(cold.sum()) / n

    # Mann-Kendall trend over the raw z series
    tau, p_mk = stats.kendalltau(np.arange(n), z_vals)
    sig_trend = p_mk < 0.05

    if last_hot:
        if not hot[:-1].any():
            return _NH
        if hot_pct >= 0.90:
            if sig_trend and tau > 0:
                return _IH
            return _PH
        if hot_pct >= 0.50:
            if sig_trend and tau > 0:
                return _IH
            return _OscH
        if cold.any():
            return _OscH
        return _SH
    elif last_cold:
        if not cold[:-1].any():
            return _NC
        if cold_pct >= 0.90:
            if sig_trend and tau < 0:
                return _IC
            return _PC
        if cold_pct >= 0.50:
            if sig_trend and tau < 0:
                return _IC
            return _OscC
        if hot.any():
            return _OscC
        return _SC
    else:
        # Not significant at last step
        if hot_pct > 0 and cold_pct == 0:
            return _HistH
        if cold_pct > 0 and hot_pct == 0:
            return _HistC
        if hot_pct > 0 or cold_pct > 0:
            return _OscH if hot_pct > cold_pct else _OscC
        return _NP


def compute(
    rows: list[dict],
    time_bucket: str = "week",
    n_permutations: int = 99,
) -> dict:
    """
    rows: list of {id, lat, lon, value, created_at}
    Returns: category + Mann-Kendall stats per location + summary counts.
    """
    if not rows:
        return {"error": "no_data", "n": 0}

    # Parse timestamps and assign buckets
    for r in rows:
        dt = _parse_dt(r.get("created_at"))
        r["_dt"] = dt
        r["_bucket"] = _bucket_key(dt, time_bucket) if dt else None

    rows = [r for r in rows if r["_bucket"] is not None]
    if not rows:
        return {"error": "no_timestamps", "n": 0}

    all_buckets = sorted(set(r["_bucket"] for r in rows))
    n_buckets = len(all_buckets)
    bucket_idx = {b: i for i, b in enumerate(all_buckets)}

    if n_buckets < 3:
        return {
            "error": "insufficient_time_steps",
            "n_time_steps": n_buckets,
            "message": (
                f"Need ≥3 time steps; found {n_buckets}. "
                "Try a finer time_bucket (e.g. 'week' or 'day')."
            ),
        }

    # Unique locations (keyed by point id)
    loc_ids = list({r["id"] for r in rows})
    n_locs = len(loc_ids)
    id_to_i = {rid: i for i, rid in enumerate(loc_ids)}
    loc_meta = {}
    for r in rows:
        rid = r["id"]
        if rid not in loc_meta:
            loc_meta[rid] = {"lat": r["lat"], "lon": r["lon"]}

    z_matrix = np.full((n_locs, n_buckets), np.nan)
    p_matrix = np.full((n_locs, n_buckets), np.nan)

    for bucket in all_buckets:
        b_i = bucket_idx[bucket]
        br = [r for r in rows if r["_bucket"] == bucket]
        if len(br) < 5:
            continue

        coords = np.array([[r["lon"], r["lat"]] for r in br])
        values = np.array([float(r["value"]) for r in br])

        k = min(8, len(br) - 1)
        try:
            w = libpysal.weights.KNN(coords, k=k)
            w.transform = "r"
            g = G_Local(values, w, transform="r", permutations=n_permutations, star=True)
            for j, r in enumerate(br):
                li = id_to_i.get(r["id"])
                if li is not None:
                    z_matrix[li, b_i] = float(g.Zs[j])
                    p_matrix[li, b_i] = float(g.p_sim[j])
        except Exception:
            continue

    results = []
    category_counts: dict[str, int] = {}

    for i, rid in enumerate(loc_ids):
        z_row = z_matrix[i, :]
        valid = ~np.isnan(z_row)
        n_valid = int(valid.sum())

        if n_valid < 3:
            cat = _NP
            mk_tau, mk_p = 0.0, 1.0
        else:
            zv = z_row[valid]
            pv = p_matrix[i, valid]
            sig = pv < 0.05
            cat = _classify(zv, sig)
            tau, p_mk = stats.kendalltau(np.arange(len(zv)), zv)
            mk_tau = float(tau) if not np.isnan(tau) else 0.0
            mk_p = float(p_mk) if not np.isnan(p_mk) else 1.0

        category_counts[cat] = category_counts.get(cat, 0) + 1
        meta = loc_meta[rid]
        results.append({
            "id": rid,
            "lat": meta["lat"],
            "lon": meta["lon"],
            "category": cat,
            "color": CATEGORY_COLORS.get(cat, "#888888"),
            "mk_tau": round(mk_tau, 4),
            "mk_p": round(mk_p, 4),
            "n_time_steps_valid": n_valid,
        })

    n_hot = sum(v for k, v in category_counts.items() if "Hot" in k)
    n_cold = sum(v for k, v in category_counts.items() if "Cold" in k)
    n_np = category_counts.get(_NP, 0)

    # Time range string for display
    first_bucket = all_buckets[0]
    last_bucket = all_buckets[-1]
    if time_bucket == "week":
        time_range = f"Week {first_bucket[1]}/{first_bucket[0]} — Week {last_bucket[1]}/{last_bucket[0]}"
    elif time_bucket == "month":
        time_range = f"{first_bucket[0]}-{first_bucket[1]:02d} — {last_bucket[0]}-{last_bucket[1]:02d}"
    else:
        time_range = f"{first_bucket} — {last_bucket}"

    return {
        "results": results,
        "category_counts": dict(sorted(category_counts.items(), key=lambda x: -x[1])),
        "n_time_steps": n_buckets,
        "time_range": time_range,
        "time_bucket": time_bucket,
        "n_hot": n_hot,
        "n_cold": n_cold,
        "n_no_pattern": n_np,
        "n": n_locs,
        "category_colors": CATEGORY_COLORS,
    }


class TemporalCell(BaseModel):
    id: str
    lat: float
    lon: float
    value: float
    created_at: str  # ISO-8601


class Req(BaseModel):
    project_id: str
    rows: list[TemporalCell]
    time_bucket: str = "week"
    n_permutations: int = 99


@router.post("")
def post(req: Req):
    rows_d = [r.model_dump() for r in req.rows]
    out = compute(rows_d, req.time_bucket, req.n_permutations)
    write_cache(req.project_id, "V2_emerging_hot", out)
    return out
