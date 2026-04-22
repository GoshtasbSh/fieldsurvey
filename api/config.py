"""GET /api/config — public Supabase client config for the browser.

Returns SUPABASE_URL + SUPABASE_ANON_KEY. Safe to expose: the anon key is
protected by Row Level Security on the Supabase side. Service role key is
NEVER returned here.
"""
from http.server import BaseHTTPRequestHandler
import os

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import json_response


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        json_response(self, 200, {
            "supabase_url": os.environ.get("SUPABASE_URL", ""),
            "supabase_anon_key": os.environ.get("SUPABASE_ANON_KEY", ""),
        })
