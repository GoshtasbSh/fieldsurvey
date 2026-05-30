# sidecar/routers/finish.py
from datetime import date, timedelta

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel

from ..lib.cache import write_cache

router = APIRouter()


class Req(BaseModel):
    project_id: str
    history: list[int]
    target: int
    start: str  # ISO date string YYYY-MM-DD
    sims: int = 10_000


def compute(history, target, start, sims=10_000, seed=1337):
    """Bootstrap Monte Carlo finish-date forecaster.

    Draws daily-count samples with replacement from `history` until the
    cumulative sum reaches `target`. Returns p50/p75/p90 days-out + dates.
    """
    rng = np.random.default_rng(seed)
    hist = np.asarray([h for h in history if h >= 0], dtype=int)
    if len(hist) == 0 or target <= 0:
        return {
            "p50_days": None,
            "p75_days": None,
            "p90_days": None,
            "p50_date": None,
            "p75_date": None,
            "p90_date": None,
            "sims": sims,
            "history_window": int(len(hist)),
        }
    days = np.zeros(sims, dtype=int)
    for s in range(sims):
        cum, d = 0, 0
        while cum < target and d < 365 * 5:
            cum += int(rng.choice(hist))
            d += 1
        days[s] = d
    p50 = int(np.percentile(days, 50))
    p75 = int(np.percentile(days, 75))
    p90 = int(np.percentile(days, 90))
    start_d = date.fromisoformat(start)
    return {
        "p50_days": p50,
        "p75_days": p75,
        "p90_days": p90,
        "p50_date": (start_d + timedelta(days=p50)).isoformat(),
        "p75_date": (start_d + timedelta(days=p75)).isoformat(),
        "p90_date": (start_d + timedelta(days=p90)).isoformat(),
        "sims": sims,
        "history_window": int(len(hist)),
    }


@router.post("")
def post(req: Req):
    out = compute(req.history, req.target, req.start, req.sims)
    write_cache(req.project_id, "A21_finish", out)
    return out
