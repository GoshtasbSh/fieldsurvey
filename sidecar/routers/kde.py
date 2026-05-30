# sidecar/routers/kde.py
import numpy as np
from fastapi import APIRouter
from KDEpy import FFTKDE
from pydantic import BaseModel

from ..lib.cache import write_cache

router = APIRouter()


class Req(BaseModel):
    project_id: str
    points: list[tuple[float, float]]
    bandwidth: float = 0.005  # ~500 m at FL latitudes
    grid_size: int = 64


def compute(points, bandwidth=0.005, grid_size=64):
    """2-D Gaussian FFT KDE over lon/lat samples.

    Returns the grid + density values flattened, plus n and the bandwidth used
    so the client can re-rebuild a raster overlay.
    """
    if len(points) < 5:
        return {
            "grid": [],
            "values": [],
            "bandwidth": bandwidth,
            "grid_size": grid_size,
            "n": 0,
        }
    arr = np.asarray(points, dtype=float)
    grid, vals = FFTKDE(kernel="gaussian", bw=bandwidth).fit(arr).evaluate(
        grid_points=grid_size
    )
    return {
        "grid": grid.tolist(),
        "values": vals.tolist(),
        "bandwidth": bandwidth,
        "grid_size": grid_size,
        "n": int(len(points)),
    }


@router.post("")
def post(req: Req):
    out = compute(req.points, req.bandwidth, req.grid_size)
    write_cache(req.project_id, "A11_kde", out)
    return out
