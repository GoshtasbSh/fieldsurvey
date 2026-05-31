# sidecar/routers/gi_star.py
import libpysal
import numpy as np
from esda.getisord import G_Local
from fastapi import APIRouter
from pydantic import BaseModel

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
    k: int = 5


def compute(cells, k=5):
    """Getis-Ord Gi* with KNN spatial weights + 999 permutations.

    `cells` is a list of dicts (or Pydantic `.model_dump()`s) with `id`,
    `value`, `lat`, `lon`. Returns one z-score + permutation p-value per cell.
    """
    if len(cells) < 30:
        return {"results": [], "k": k, "n": len(cells)}
    coords = np.array([[c["lon"], c["lat"]] for c in cells])
    vals = np.array([c["value"] for c in cells])
    w = libpysal.weights.KNN.from_array(coords, k=min(k, len(cells) - 1))
    w.transform = "r"
    gi = G_Local(vals, w, star=True, permutations=999)
    return {
        "results": [
            {"id": c["id"], "z": float(z), "p": float(p)}
            for c, z, p in zip(cells, gi.Zs, gi.p_sim)
        ],
        "k": k,
        "n": len(cells),
        "permutations": 999,
    }


@router.post("")
def post(req: Req):
    cells_d = [c.model_dump() for c in req.cells]
    out = compute(cells_d, req.k)
    write_cache(req.project_id, "A8_gi_star", out)
    return out
