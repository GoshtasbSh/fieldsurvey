# sidecar/lib/supabase_client.py
import os

from supabase import Client, create_client


def admin_client() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)
