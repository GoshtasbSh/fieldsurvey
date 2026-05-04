"""Local↔Vercel parity verification for the IAQ processing pipeline.

Runs the same Qualtrics CSV through both the local FastAPI processor
(`process_iaq_survey` in app.py) and the Vercel-shared processor
(`process_iaq_bytes` in api/_processing.py) and diffs the resulting
analysis blobs. They must match for deploy.

Usage:
    python scripts/verify_parity.py \
        --iaq   data/"Keystone Heights Survey - V1_April 15, 2026_13.25.csv" \
        --contacts data/"Community Survey Contact Data .xlsx"

Exit code 0 means parity holds; non-zero means diff found.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))

# Tolerances
FLOAT_EPS = 1e-6


def _approx(a, b, eps=FLOAT_EPS):
    if isinstance(a, float) and isinstance(b, float):
        if math.isnan(a) and math.isnan(b):
            return True
        return abs(a - b) < eps
    return a == b


def diff_dicts(a, b, path=""):
    """Yield human-readable diff lines between two analysis dicts."""
    if type(a) is not type(b):
        yield f"{path}: type mismatch — {type(a).__name__} vs {type(b).__name__}"
        return
    if isinstance(a, dict):
        ka, kb = set(a), set(b)
        for k in ka - kb:
            yield f"{path}.{k}: only in local"
        for k in kb - ka:
            yield f"{path}.{k}: only in vercel"
        for k in ka & kb:
            yield from diff_dicts(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list):
        if len(a) != len(b):
            yield f"{path}: length differs ({len(a)} vs {len(b)})"
            return
        for i, (x, y) in enumerate(zip(a, b)):
            yield from diff_dicts(x, y, f"{path}[{i}]")
    else:
        if not _approx(a, b):
            yield f"{path}: {a!r} vs {b!r}"


def load_contacts(xlsx_path: Path):
    """Geocode contacts via app.py's process_survey to get a feature list."""
    from app import process_survey  # noqa: F401
    return process_survey(xlsx_path).get("features", [])


def run_vercel(csv_bytes: bytes, contact_features: list):
    from _processing import process_iaq_bytes, load_parcel_index
    parcel_idx = load_parcel_index()
    return process_iaq_bytes(csv_bytes, contact_features, parcel_idx)


def run_local(csv_bytes: bytes):
    """The local app.py uses module-level globals — we have to set them up."""
    import app
    app.survey_data = {"type": "FeatureCollection",
                       "features": load_contacts(args.contacts)}
    iaq_data, iaq_analysis, street_stats, _validation = app.process_iaq_survey(csv_bytes)
    return iaq_data, iaq_analysis, street_stats


def main(args):
    csv_bytes = Path(args.iaq).read_bytes()

    local_geo, local_ana, local_streets = run_local(csv_bytes)

    contact_feats = load_contacts(args.contacts)
    vercel_geo, vercel_ana, vercel_streets, _n_up, _failed = run_vercel(csv_bytes, contact_feats)

    diffs = list(diff_dicts(local_ana, vercel_ana, "analysis")) + \
            list(diff_dicts(local_streets, vercel_streets, "streets"))

    print(f"local features:  {len(local_geo.get('features', []))}")
    print(f"vercel features: {len(vercel_geo.get('features', []))}")
    print(f"diffs found:     {len(diffs)}")

    if diffs:
        for d in diffs[:50]:
            print(f"  - {d}")
        if len(diffs) > 50:
            print(f"  ... and {len(diffs) - 50} more")
        sys.exit(1)

    print("PARITY OK")
    sys.exit(0)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--iaq", required=True, type=Path,
                   help="Qualtrics CSV export")
    p.add_argument("--contacts", required=True, type=Path,
                   help="Community Contact .xlsx")
    args = p.parse_args()
    main(args)
