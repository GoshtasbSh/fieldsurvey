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
