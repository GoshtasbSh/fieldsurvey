"""GET /api/analysis — precomputed analysis blob.

Query params:
  ?type=contact (default)  → community-contact analysis (status summary + street stats)
  ?type=iaq                → IAQ aggregated stats + street_stats + validation
  ?meta=1                  → latest snapshot label + date for header badge
                             (returned regardless of `type`)
Cache: public, max-age=30 except meta which is no-store.
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import (
    load_cached, json_response, supabase_admin, supabase_anon,
)


def _latest_version(sb, dtype: str):
    try:
        r = (sb.table("keystone_analysis_versions")
               .select("id, label, n_points, created_at")
               .eq("data_type", dtype)
               .order("created_at", desc=True)
               .limit(1)
               .execute())
        return r.data[0] if r.data else None
    except Exception:
        return None


def _meta_payload():
    sb = supabase_admin() or supabase_anon()
    if not sb:
        return {"contact": None, "iaq": None}
    return {
        "contact": _latest_version(sb, "community_contact"),
        "iaq":     _latest_version(sb, "iaq_survey"),
    }


def _iaq_analysis_payload():
    payload = load_cached("iaq_survey")
    if not payload or not isinstance(payload, dict):
        return {"loaded": False}
    out = {"loaded": True}
    for k in ("analysis", "street_stats", "validation"):
        if k in payload:
            out[k] = payload[k]
    # Back-compat: lift analysis keys to top level
    if "analysis" in payload and isinstance(payload["analysis"], dict):
        for k, v in payload["analysis"].items():
            out.setdefault(k, v)
    return out


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        qs = parse_qs(urlparse(self.path).query)
        is_meta = (qs.get("meta", ["0"])[0] or "").lower() in ("1", "true", "yes")
        kind    = (qs.get("type", ["contact"])[0] or "contact").lower()

        if is_meta:
            json_response(self, 200, _meta_payload(), cache="no-store")
            return
        # NB: no-store on analysis endpoints. The data flips on every
        # CSV upload / daily-refresh, and stale CDN responses produced
        # confusing "I uploaded 64 but the panel shows 71" reports.
        # JSON payload is small (<300 KB typical) so the perf hit from
        # uncached origin reads is negligible vs. the data-correctness
        # bugs caching introduces here.
        if kind == "iaq":
            json_response(self, 200, _iaq_analysis_payload(), cache="no-store")
            return
        # default: community-contact analysis
        data = load_cached("analysis") or {}
        json_response(self, 200, data, cache="no-store")
