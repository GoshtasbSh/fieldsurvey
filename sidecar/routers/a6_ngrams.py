# sidecar/routers/a6_ngrams.py
import re
from collections import Counter
from fastapi import APIRouter
from pydantic import BaseModel
from ..lib.cache import write_cache

router = APIRouter()

STOPWORDS = {
    "a","an","the","and","or","but","in","on","at","to","for","of","with",
    "is","are","was","were","be","been","being","have","has","had","do","does",
    "did","will","would","could","should","may","might","can","this","that",
    "these","those","it","its","i","we","you","he","she","they","my","our",
    "your","his","her","their","not","no","nor","so","yet","both","either",
    "neither","as","if","then","than","too","very","just","because","while",
    "about","up","out","there","here","when","where","who","which","how",
    "what","all","any","each","more","also","from","by","into","through",
}

def tokenize(text: str) -> list[str]:
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s']", " ", text)
    tokens = [t.strip("'") for t in text.split() if len(t.strip("'")) > 1]
    return [t for t in tokens if t not in STOPWORDS]

def compute(texts: list[str], n_gram: str = "both", max_terms: int = 20) -> dict:
    non_empty = [t for t in texts if t and t.strip()]
    n_text = len(texts)
    pct_empty = round(1 - len(non_empty) / max(n_text, 1), 4)
    if not non_empty:
        return {"error": "no_text", "n_text": n_text, "pct_empty": 1.0}
    all_tokens = [tokenize(t) for t in non_empty]
    unigrams: list[dict] = []
    bigrams: list[dict] = []
    if n_gram in ("1", "both"):
        counter = Counter(tok for toks in all_tokens for tok in toks)
        unigrams = [{"term": t, "count": c, "pct": round(c / max(len(non_empty), 1), 4)} for t, c in counter.most_common(max_terms)]
    if n_gram in ("2", "both"):
        bg_counter: Counter = Counter()
        for toks in all_tokens:
            for i in range(len(toks) - 1):
                bg_counter[(toks[i], toks[i + 1])] += 1
        bigrams = [{"term": f"{a} {b}", "count": c, "pct": round(c / max(len(non_empty), 1), 4)} for (a, b), c in bg_counter.most_common(max_terms)]
    return {"unigrams": unigrams, "bigrams": bigrams, "n_text": n_text, "pct_empty": pct_empty, "n_gram": n_gram}

class Req(BaseModel):
    project_id: str
    texts: list[str]
    n_gram: str = "both"
    max_terms: int = 20

@router.post("")
def post(req: Req):
    out = compute(req.texts, req.n_gram, req.max_terms)
    write_cache(req.project_id, "A6_text_ngrams", out)
    return out
