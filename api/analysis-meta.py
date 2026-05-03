"""GET /api/analysis-meta — latest snapshot label + date for the header badge.

Returns the most recent community_contact and iaq_survey version records so
the dashboard can display "Analyzed: Apr 15, 2026" without loading the full
history list.
"""
from http.server import BaseHTTPRequestHandler

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import supabase_admin, supabase_anon, json_response


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        sb = supabase_admin() or supabase_anon()
        if not sb:
            json_response(self, 200, {"contact": None, "iaq": None})
            return
        try:
            def _latest(dtype):
                r = (
                    sb.table("keystone_analysis_versions")
                    .select("id, label, n_points, created_at")
                    .eq("data_type", dtype)
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )
                return r.data[0] if r.data else None

            json_response(self, 200, {
                "contact": _latest("community_contact"),
                "iaq":     _latest("iaq_survey"),
            })
        except Exception as e:
            json_response(self, 500, {"error": str(e)})
