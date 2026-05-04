"""GET /api/debug — diagnostic endpoint.

Reports:
- Which SUPABASE_* env vars are present (length only, never the value)
- Whether `supabase` package imports
- Whether the service-role client can read keystone_dashboard_data
- Whether the anon client can read keystone_dashboard_data
- What rows exist in the table
- The Vercel commit SHA of this deployment

Safe to keep public: no secret values are returned, only presence + lengths.
Delete after debugging if you want to be extra careful.
"""
from http.server import BaseHTTPRequestHandler
import os
import sys
import pathlib

sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import json_response, require_auth


def _probe():
    report = {
        "env": {
            "SUPABASE_URL_set": bool(os.environ.get("SUPABASE_URL")),
            # Don't echo any portion of the URL — even the project-id prefix
            # is reconnaissance-useful. Set-only is enough.
            "SUPABASE_ANON_KEY_set": bool(os.environ.get("SUPABASE_ANON_KEY")),
            "SUPABASE_ANON_KEY_length": len(os.environ.get("SUPABASE_ANON_KEY", "")),
            "SUPABASE_SERVICE_ROLE_KEY_set": bool(os.environ.get("SUPABASE_SERVICE_ROLE_KEY")),
            "SUPABASE_SERVICE_ROLE_KEY_length": len(os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")),
            "CRON_SECRET_set": bool(os.environ.get("CRON_SECRET")),
            "VERCEL_GIT_COMMIT_SHA": os.environ.get("VERCEL_GIT_COMMIT_SHA", ""),
            "VERCEL_GIT_COMMIT_REF": os.environ.get("VERCEL_GIT_COMMIT_REF", ""),
        },
        "python_version": sys.version,
        "supabase_import": None,
        "admin_client": None,
        "anon_client": None,
        "admin_query": None,
        "anon_query": None,
        "table_rows": None,
    }

    # Supabase package import check
    try:
        from supabase import create_client
        report["supabase_import"] = "OK"
    except Exception as e:
        report["supabase_import"] = f"FAIL: {type(e).__name__}: {e}"
        return report

    url = os.environ.get("SUPABASE_URL", "")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    anon = os.environ.get("SUPABASE_ANON_KEY", "")

    # Service role client
    if url and service:
        try:
            sb = create_client(url, service)
            report["admin_client"] = "OK"
            try:
                r = sb.table("keystone_dashboard_data").select("data_type, updated_at").execute()
                report["admin_query"] = {
                    "status": "OK",
                    "rows": [row for row in (r.data or [])],
                }
                report["table_rows"] = [row["data_type"] for row in (r.data or [])]
            except Exception as e:
                report["admin_query"] = f"FAIL: {type(e).__name__}: {e}"
        except Exception as e:
            report["admin_client"] = f"FAIL: {type(e).__name__}: {e}"
    else:
        report["admin_client"] = "SKIP: URL or SERVICE_ROLE missing"

    # Anon client
    if url and anon:
        try:
            sb2 = create_client(url, anon)
            report["anon_client"] = "OK"
            try:
                r = sb2.table("keystone_dashboard_data").select("data_type").execute()
                report["anon_query"] = {
                    "status": "OK",
                    "rows_returned": len(r.data or []),
                    "row_types": [row.get("data_type") for row in (r.data or [])],
                }
            except Exception as e:
                report["anon_query"] = f"FAIL: {type(e).__name__}: {e}"
        except Exception as e:
            report["anon_client"] = f"FAIL: {type(e).__name__}: {e}"
    else:
        report["anon_client"] = "SKIP: URL or ANON missing"

    return report


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Diagnostic info reveals env-var presence and Supabase reachability.
        # Even with values masked, that's reconnaissance-useful. Require auth.
        if require_auth(self) is None:
            return  # 401 already written
        try:
            json_response(self, 200, _probe())
        except Exception as e:
            json_response(self, 500, {"error": f"{type(e).__name__}: {e}"})
