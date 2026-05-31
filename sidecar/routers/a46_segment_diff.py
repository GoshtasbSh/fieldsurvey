# sidecar/routers/a46_segment_diff.py
import numpy as np
from scipy import stats
from fastapi import APIRouter
from pydantic import BaseModel
from ..lib.cache import write_cache

router = APIRouter()

class Row(BaseModel):
    response_id: str
    group_value: str
    question_values: dict[str, str | float | None]

class Req(BaseModel):
    project_id: str
    rows: list[Row]
    group_key: str
    fdr_alpha: float = 0.05
    min_n: int = 10

def _fdr_bh(pvals: list[float], alpha: float) -> list[float]:
    n = len(pvals)
    if n == 0:
        return []
    order = np.argsort(pvals)
    ranked = np.empty(n)
    ranked[order] = np.arange(1, n + 1)
    adj = np.array(pvals) * n / ranked
    for i in range(n - 2, -1, -1):
        adj[order[i]] = min(adj[order[i]], adj[order[i + 1]])
    return [min(float(v), 1.0) for v in adj]

def compute(rows_d: list[dict], fdr_alpha: float = 0.05, min_n: int = 10) -> dict:
    if len(rows_d) < 2 * min_n:
        return {"error": "insufficient_data", "n": len(rows_d)}
    groups = list({r["group_value"] for r in rows_d})
    if len(groups) < 2:
        return {"error": "single_group"}
    all_keys = set()
    for r in rows_d:
        all_keys.update(r["question_values"].keys())
    results = []
    for qk in all_keys:
        group_vals: dict[str, list] = {g: [] for g in groups}
        for r in rows_d:
            v = r["question_values"].get(qk)
            if v is not None and v != "":
                group_vals[r["group_value"]].append(v)
        valid_groups = {g: vals for g, vals in group_vals.items() if len(vals) >= min_n}
        if len(valid_groups) < 2:
            continue
        group_lists = list(valid_groups.values())
        try:
            numeric_vals = [[float(v) for v in lst] for lst in group_lists]
            stat, p = stats.mannwhitneyu(numeric_vals[0], numeric_vals[1], alternative="two-sided")
            test = "mann_whitney"
            effect = abs(np.mean(numeric_vals[0]) - np.mean(numeric_vals[1]))
        except (ValueError, TypeError):
            all_cats = sorted({str(v) for lst in group_lists for v in lst})
            contingency = [[lst.count(c) for c in all_cats] for lst in group_lists]
            try:
                chi2, p, *_ = stats.chi2_contingency(contingency)
                test = "chi_square"
                effect = float(chi2)
            except Exception:
                continue
        results.append({"question_key": qk, "test": test, "p_raw": round(float(p), 5), "effect": round(float(effect), 4)})
    if not results:
        return {"comparisons": [], "n_tests": 0, "n_significant": 0}
    p_raws = [r["p_raw"] for r in results]
    p_adjs = _fdr_bh(p_raws, fdr_alpha)
    for r, p_adj in zip(results, p_adjs):
        r["p_fdr"] = round(p_adj, 5)
        r["significant"] = p_adj < fdr_alpha
    results.sort(key=lambda x: x["p_fdr"])
    return {"comparisons": results, "n_tests": len(results), "n_significant": sum(1 for r in results if r["significant"]), "fdr_alpha": fdr_alpha, "groups": groups}

@router.post("")
def post(req: Req):
    rows_d = [r.model_dump() for r in req.rows]
    out = compute(rows_d, req.fdr_alpha, req.min_n)
    write_cache(req.project_id, "A46_segment_diff", out)
    return out
