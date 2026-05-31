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
    y_map = {c["id"]: c["value"] for c in cells_y}
    aligned = [(c, y_map[c["id"]]) for c in cells_x if c["id"] in y_map]
    if len(aligned) < 50:
        return {"error": "insufficient_data", "n": len(aligned), "n_min": 50}

    coords = np.array([[c["lon"], c["lat"]] for c, _ in aligned])
    x_vals = np.array([c["value"] for c, _ in aligned], dtype=float)
    y_vals = np.array([yv for _, yv in aligned], dtype=float)

    w = build_weights(coords, "knn8")
    n_perm = min(n_permutations, 9999)

    bv = Moran_BV(x_vals, y_vals, w, permutations=n_perm)
    lee_L = round(float(bv.I), 4)
    pearson_r = round(float(np.corrcoef(x_vals, y_vals)[0, 1]), 4)
    disagreement = abs(lee_L - pearson_r) > 0.2

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
