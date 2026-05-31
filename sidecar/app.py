# sidecar/app.py
from fastapi import Depends, FastAPI
from sidecar.lib.auth import verify_secret
from sidecar.routers import finish, velocity, kde, gi_star

app = FastAPI(title="FieldSurvey sidecar")

# Compute endpoints require x-sidecar-secret. /sidecar/healthz and
# /sidecar/version stay public for platform probes.
app.include_router(
    finish.router,
    prefix="/sidecar/compute/A21_finish",
    tags=["A21"],
    dependencies=[Depends(verify_secret)],
)
app.include_router(
    velocity.router,
    prefix="/sidecar/compute/A25_velocity",
    tags=["A25"],
    dependencies=[Depends(verify_secret)],
)
app.include_router(
    kde.router,
    prefix="/sidecar/compute/A11_kde",
    tags=["A11"],
    dependencies=[Depends(verify_secret)],
)
app.include_router(
    gi_star.router,
    prefix="/sidecar/compute/A8_gi_star",
    tags=["A8"],
    dependencies=[Depends(verify_secret)],
)


@app.get("/sidecar/healthz")
def healthz():
    return {"ok": True}


@app.get("/sidecar/version")
def version():
    return {"version": "1.0.0"}
