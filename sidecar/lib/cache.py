# sidecar/lib/cache.py
from datetime import datetime, timezone

from .supabase_client import admin_client


def write_cache(project_id: str, key: str, payload: dict) -> None:
    """Upsert a sidecar payload into the shared dashboard_cache table.

    The Next.js wrapper in `lib/queries/sidecar.ts` reads from this same row
    via (project_id, data_type) and treats anything younger than 15 min as
    fresh. NOTE: `data_type` has a CHECK constraint in migration 005 — a
    follow-up migration must widen it to admit the sidecar card ids
    (A21_finish, A25_velocity, A11_kde, A8_gi_star) before this can succeed
    against prod. Until then this write will raise; the dispatcher handles
    that and falls back to returning null.
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
