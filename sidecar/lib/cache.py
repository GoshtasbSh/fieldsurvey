# sidecar/lib/cache.py
from datetime import datetime, timezone

from .supabase_client import admin_client


def write_cache(project_id: str, key: str, payload: dict) -> None:
    """Upsert a sidecar payload into the shared dashboard_cache table.

    The Next.js wrapper in `lib/queries/sidecar.ts` reads from this same row
    via (project_id, data_type) and treats anything younger than 15 min as
    fresh. Cache CHECK constraint widened in
    supabase/migrations/017_sidecar_cache_keys.sql.
    """
    sb = admin_client()
    sb.table("dashboard_cache").upsert(
        {
            "project_id": project_id,
            "data_type": key,
            "payload": payload,
            "computed_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="project_id,data_type",
    ).execute()
