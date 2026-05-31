# sidecar/routers/s5_distance_decay.py
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel

from ..lib.cache import write_cache

router = APIRouter()

BIN_EDGES_KM = [0.0, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, float("inf")]
EARTH_R_KM = 6371.0


def haversine_km(lat1, lon1, lat2, lon2):
    dlat = np.radians(lat2 - lat1)
    dlon = np.radians(lon2 - lon1)
    a = np.sin(dlat / 2) ** 2 + np.cos(np.radians(lat1)) * np.cos(np.radians(lat2)) * np.sin(dlon / 2) ** 2
    return EARTH_R_KM * 2 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def _bin_stats(dists_km, vals):
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
