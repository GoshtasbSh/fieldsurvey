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
        if label == "pos_autocorr":
            n_pos += 1
        elif label == "neg_autocorr":
            n_neg += 1
        else:
            n_ns += 1
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
