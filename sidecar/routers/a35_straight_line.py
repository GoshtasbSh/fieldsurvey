# sidecar/routers/a35_straight_line.py
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel
from ..lib.cache import write_cache

router = APIRouter()

class Row(BaseModel):
    response_id: str
    values: list[float | None]

class Req(BaseModel):
    project_id: str
    rows: list[Row]
    question_keys: list[str]
    threshold: float = 0.8
    min_questions: int = 3

def compute(rows_d: list[dict], question_keys: list[str], threshold: float = 0.8, min_questions: int = 3) -> dict:
    if len(question_keys) < min_questions:
        return {"error": "insufficient_questions", "n_questions": len(question_keys), "n_min": min_questions}
    if len(rows_d) < 5:
        return {"error": "insufficient_data", "n": len(rows_d)}
    flagged = []
    for row in rows_d:
        vals = [v for v in row["values"] if v is not None]
        if len(vals) < min_questions:
            continue
        arr = np.array(vals)
        unique, counts = np.unique(arr, return_counts=True)
        modal_count = int(counts.max())
        score = modal_count / len(vals)
        if score >= threshold:
            modal_val = float(unique[counts.argmax()])
            flagged.append({"response_id": row["response_id"], "score": round(score, 3), "modal_value": modal_val, "n_answered": len(vals)})
    flagged.sort(key=lambda x: x["score"], reverse=True)
    return {"flagged": flagged, "n_flagged": len(flagged), "n_total": len(rows_d), "pct_flagged": round(len(flagged) / max(len(rows_d), 1), 4), "threshold": threshold, "n_questions": len(question_keys)}

@router.post("")
def post(req: Req):
    rows_d = [r.model_dump() for r in req.rows]
    out = compute(rows_d, req.question_keys, req.threshold, req.min_questions)
    write_cache(req.project_id, "A35_straight_line", out)
    return out
