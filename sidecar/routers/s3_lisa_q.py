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
