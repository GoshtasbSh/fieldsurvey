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
    if n_z == 0 or n_z == n_tot or c_tot == 0:
        return 0.0
    c_out = c_tot - c_z
    n_out = n_tot - n_z
    if c_out == 0 or n_out == 0:
        return 0.0
    e_z = n_z * c_tot / n_tot
    e_out = n_out * c_tot / n_tot
    if c_z <= e_z:
        return 0.0
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

    # Cap at 5000 pts for performance
    cap = min(n, 5000)
    if n > cap:
        idx = np.random.default_rng(42).choice(n, cap, replace=False)
        lats, lons, cases = lats[idx], lons[idx], cases[idx]
        cells_d = [cells_d[i] for i in idx]
        n = cap
        c_tot = int(cases.sum())

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

    # Monte Carlo p-value (sample 200 centres per perm for speed)
    rng = np.random.default_rng(42)
    n_perm = min(n_permutations, 9999)
    exceed = 0
    for _ in range(n_perm):
        perm = rng.permutation(cases)
        c_p_tot = int(perm.sum())
        max_llr_p = 0.0
        for i in range(min(n, 200)):
            dists = _haversine(lats[i], lons[i], lats, lons)
            order = np.argsort(dists)
            c_z2, n_z2 = 0, 0
            for j in order:
                n_z2 += 1
                c_z2 += int(perm[j])
                if c_z2 > max_cases_in_window:
                    break
                llr2 = _llr(c_z2, n_z2, c_p_tot, n)
                if llr2 > max_llr_p:
                    max_llr_p = llr2
        if max_llr_p >= best_llr:
            exceed += 1

    p_val = (exceed + 1) / (n_perm + 1)
    n_z_final = len(best_zone_idx)
    c_z_final = int(cases[best_zone_idx].sum()) if best_zone_idx else 0
    rr = (c_z_final / n_z_final) / (c_tot / n) if n_z_final > 0 and c_tot > 0 else 0.0

    return {
        "clusters": [{
            "rank": 1,
            "n_cases": c_z_final,
            "n_total": n_z_final,
            "relative_risk": round(rr, 3),
            "llr": round(best_llr, 4),
            "p_value": round(p_val, 4),
            "center_lat": float(lats[best_zone_idx[0]]) if best_zone_idx else None,
            "center_lon": float(lons[best_zone_idx[0]]) if best_zone_idx else None,
            "member_ids": [cells_d[i]["id"] for i in best_zone_idx[:50]],
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
