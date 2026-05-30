import os
from fastapi import Header, HTTPException, status


def verify_secret(x_sidecar_secret: str | None = Header(default=None)):
    """Shared-secret guard for sidecar compute endpoints.

    The Next.js dispatcher sends `x-sidecar-secret: $SIDECAR_SECRET` on every
    POST to `/sidecar/compute/*`. Health (`/sidecar/healthz`) and version
    (`/sidecar/version`) endpoints stay public so Vercel platform probes can
    still reach them.

    If `SIDECAR_SECRET` is unset on the server we reject everything (503) —
    fail-closed beats accidental open access.
    """
    expected = os.environ.get("SIDECAR_SECRET")
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="sidecar not configured",
        )
    if x_sidecar_secret != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid secret",
        )
