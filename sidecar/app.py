# sidecar/app.py
from fastapi import FastAPI
from sidecar.routers import finish, velocity, kde, gi_star

app = FastAPI(title="FieldSurvey sidecar")

app.include_router(finish.router, prefix="/sidecar/compute/A21_finish",      tags=["A21"])
app.include_router(velocity.router, prefix="/sidecar/compute/A25_velocity",  tags=["A25"])
app.include_router(kde.router, prefix="/sidecar/compute/A11_kde",            tags=["A11"])
app.include_router(gi_star.router, prefix="/sidecar/compute/A8_gi_star",     tags=["A8"])


@app.get("/sidecar/healthz")
def healthz():
    return {"ok": True}


@app.get("/sidecar/version")
def version():
    return {"version": "1.0.0"}
