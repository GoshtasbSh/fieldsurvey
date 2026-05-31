# sidecar/routers/a43_raking.py
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel
from ..lib.cache import write_cache

router = APIRouter()

class Req(BaseModel):
    project_id: str
    group_values: list[str]
    trim_cap: float = 5.0

def compute(group_values: list[str], trim_cap: float = 5.0) -> dict:
    if len(group_values) < 10:
        return {"error": "insufficient_data", "n": len(group_values)}
    groups, counts = np.unique(group_values, return_counts=True)
    n = len(group_values)
    k = len(groups)
    if k < 2:
        return {"error": "single_group", "n": n}
    target_per_group = n / k
    raw_weights = {g: target_per_group / c for g, c in zip(groups, counts)}
    weights = np.array([min(raw_weights[v], trim_cap) for v in group_values])
    weights = weights / weights.mean()
    cv = float(weights.std() / weights.mean())
    eff_n = float(n / (1 + cv ** 2))
    deff = float(n / eff_n)
    hist_counts, hist_edges = np.histogram(weights, bins=10)
    histogram = [{"lo": round(float(hist_edges[i]), 3), "hi": round(float(hist_edges[i+1]), 3), "count": int(hist_counts[i])} for i in range(len(hist_counts))]
    group_summary = [{"group": str(g), "n": int(c), "weight": round(float(min(raw_weights[g], trim_cap)), 3)} for g, c in zip(groups, counts)]
    return {"cv": round(cv, 4), "effective_n": round(eff_n, 1), "deff": round(deff, 3), "max_weight": round(float(weights.max()), 3), "min_weight": round(float(weights.min()), 3), "n_trimmed": int(sum(1 for v in group_values if raw_weights[v] > trim_cap)), "histogram": histogram, "group_summary": group_summary, "n": n, "n_groups": k, "trim_cap": trim_cap}

@router.post("")
def post(req: Req):
    out = compute(req.group_values, req.trim_cap)
    write_cache(req.project_id, "A43_raking_diag", out)
    return out
