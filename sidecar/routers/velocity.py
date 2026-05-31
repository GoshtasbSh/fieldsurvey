# sidecar/routers/velocity.py
import numpy as np
import ruptures as rpt
from fastapi import APIRouter
from pydantic import BaseModel

from ..lib.cache import write_cache

router = APIRouter()


class Req(BaseModel):
    project_id: str
    daily_counts: list[int]
    min_size: int = 5


def compute(daily_counts, min_size=5):
    """PELT change-point detection on a daily-counts series.

    Returns the indices (0-based, into `daily_counts`) where the regime
    changes. Skips the trailing sentinel ruptures appends at len(series).
    """
    if len(daily_counts) < 2 * min_size:
        return {"changepoints": [], "n_breaks": 0, "min_size": min_size}
    signal = np.asarray(daily_counts, dtype=float)
    algo = rpt.Pelt(model="rbf", min_size=min_size).fit(signal)
    pen = max(1.0, len(daily_counts) ** 0.5)
    cps = [int(c) for c in algo.predict(pen=pen)[:-1]]
    return {"changepoints": cps, "n_breaks": len(cps), "min_size": min_size}


@router.post("")
def post(req: Req):
    out = compute(req.daily_counts, req.min_size)
    write_cache(req.project_id, "A25_velocity", out)
    return out
