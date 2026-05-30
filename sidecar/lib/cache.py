# sidecar/lib/cache.py
from datetime import datetime, timezone

from .supabase_client import admin_client


def write_cache(project_id: str, key: str, payload: dict) -> None:
    """Upsert a sidecar payload into the shared dashboard_cache table.

    The Next.js wrapper in `lib/queries/sidecar.ts` reads from this same row
    via `(project_id, key)` and treats anything younger than 15 min as fresh.
    """
    sb = admin_client()
    sb.table("dashboard_cache").upsert(
        {
            "project_id": project_id,
            "key": key,
            "payload": payload,
            "computed_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="project_id,key",
    ).execute()
