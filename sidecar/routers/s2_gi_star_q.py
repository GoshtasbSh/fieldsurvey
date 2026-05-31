# sidecar/routers/s2_gi_star_q.py
import numpy as np
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
