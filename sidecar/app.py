# sidecar/app.py
from fastapi import Depends, FastAPI
from sidecar.lib.auth import verify_secret
from sidecar.routers import finish, velocity, kde, gi_star
from sidecar.routers import s1_autocorr, s2_gi_star_q, s3_lisa_q, s4_satscan
from sidecar.routers import s5_distance_decay, s7_local_geary, s8_bivariate
from sidecar.routers import a6_ngrams, a35_straight_line, a43_raking, a46_segment_diff

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
app.include_router(s1_autocorr.router, prefix="/sidecar/compute/S1_autocorr", tags=["S1"], dependencies=[Depends(verify_secret)])
app.include_router(s2_gi_star_q.router, prefix="/sidecar/compute/S2_gi_star_q", tags=["S2"], dependencies=[Depends(verify_secret)])
app.include_router(s3_lisa_q.router, prefix="/sidecar/compute/S3_lisa_q", tags=["S3"], dependencies=[Depends(verify_secret)])
app.include_router(s4_satscan.router, prefix="/sidecar/compute/S4_satscan", tags=["S4"], dependencies=[Depends(verify_secret)])
app.include_router(s5_distance_decay.router, prefix="/sidecar/compute/S5_distance_decay", tags=["S5"], dependencies=[Depends(verify_secret)])
app.include_router(s7_local_geary.router, prefix="/sidecar/compute/S7_local_geary", tags=["S7"], dependencies=[Depends(verify_secret)])
app.include_router(s8_bivariate.router, prefix="/sidecar/compute/S8_bivariate", tags=["S8"], dependencies=[Depends(verify_secret)])
app.include_router(a6_ngrams.router, prefix="/sidecar/compute/A6_text_ngrams", tags=["A6"], dependencies=[Depends(verify_secret)])
app.include_router(a35_straight_line.router, prefix="/sidecar/compute/A35_straight_line", tags=["A35"], dependencies=[Depends(verify_secret)])
app.include_router(a43_raking.router, prefix="/sidecar/compute/A43_raking_diag", tags=["A43"], dependencies=[Depends(verify_secret)])
app.include_router(a46_segment_diff.router, prefix="/sidecar/compute/A46_segment_diff", tags=["A46"], dependencies=[Depends(verify_secret)])


@app.get("/sidecar/healthz")
def healthz():
    return {"ok": True}


@app.get("/sidecar/version")
def version():
    return {"version": "1.3.0"}
