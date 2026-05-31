# sidecar/tests/test_spatial_routers.py
"""Unit tests for S1–S8 spatial analysis routers — no Supabase, no sidecar secret."""
import numpy as np
import pytest


def _make_cells(n=80, clustered=True):
    """Synthetic 8×10 grid: clustered=True → upper half has value 1, lower 0."""
    rng = np.random.default_rng(0)
    lats = np.linspace(29.6, 29.7, 8)
    lons = np.linspace(-82.4, -82.3, 10)
    cells = []
    for i, lat in enumerate(lats):
        for j, lon in enumerate(lons):
            if clustered:
                value = (1.0 if i < 4 else 0.0) + rng.normal(0, 0.05)
            else:
                value = rng.uniform(0, 1)
            cells.append({"id": f"{i}_{j}", "value": value, "lat": lat, "lon": lon})
    return cells[:n]


# ── S1 ──────────────────────────────────────────────────────────────────────

def test_s1_autocorr_clustered():
    from sidecar.routers.s1_autocorr import compute
    r = compute(_make_cells(80, clustered=True), n_permutations=99)
    assert "moran_I" in r
    assert r["moran_I"] > 0.3
    assert r["verdict"] in ("clustered", "non_stationary")
    assert r["n"] == 80


def test_s1_autocorr_insufficient():
    from sidecar.routers.s1_autocorr import compute
    r = compute(_make_cells(20))
    assert r["error"] == "insufficient_data"


def test_s1_has_geary():
    from sidecar.routers.s1_autocorr import compute
    r = compute(_make_cells(80), n_permutations=99)
    assert "geary_C" in r
    assert "geary_p" in r


# ── S2 ──────────────────────────────────────────────────────────────────────

def test_s2_gi_star_labels():
    from sidecar.routers.s2_gi_star_q import compute
    r = compute(_make_cells(80), n_permutations=99)
    assert "results" in r
    labels = {x["label"] for x in r["results"]}
    assert labels <= {"hot", "cold", "ns"}
    assert r["n_hot"] + r["n_cold"] + r["n_ns"] == 80


def test_s2_fdr_cutoff_present():
    from sidecar.routers.s2_gi_star_q import compute
    r = compute(_make_cells(80), n_permutations=99)
    assert "fdr_cutoff" in r
    assert 0 <= r["fdr_cutoff"] <= 1


# ── S3 ──────────────────────────────────────────────────────────────────────

def test_s3_lisa_quad_counts():
    from sidecar.routers.s3_lisa_q import compute
    r = compute(_make_cells(80), n_permutations=99)
    total = r["n_HH"] + r["n_LL"] + r["n_HL"] + r["n_LH"] + r["n_ns"]
    assert total == 80


def test_s3_clustered_has_hh():
    from sidecar.routers.s3_lisa_q import compute
    r = compute(_make_cells(80, clustered=True), n_permutations=99)
    assert r["n_HH"] > 0 or r["n_LL"] > 0


# ── S4 ──────────────────────────────────────────────────────────────────────

def test_s4_satscan_structure():
    from sidecar.routers.s4_satscan import compute
    cells = _make_cells(80, clustered=True)
    for c in cells:
        c["value"] = 1.0 if c["value"] > 0.5 else 0.0
    r = compute(cells, n_permutations=49)
    assert "clusters" in r
    assert r["n"] == 80
    assert "c_total" in r


def test_s4_no_variation():
    from sidecar.routers.s4_satscan import compute
    cells = [{"id": str(i), "value": 1.0, "lat": 29.6 + 0.001*i, "lon": -82.3} for i in range(40)]
    r = compute(cells, n_permutations=9)
    assert r.get("error") == "no_variation"


# ── S5 ──────────────────────────────────────────────────────────────────────

def test_s5_decay_bins():
    from sidecar.routers.s5_distance_decay import compute
    cells = _make_cells(80)
    r = compute(cells, poi_lat=29.65, poi_lon=-82.35, n_permutations=49)
    assert "bins" in r
    assert len(r["bins"]) > 0
    assert r["trend"] in ("decaying", "increasing", "flat")


def test_s5_envelope_same_length_as_bins():
    from sidecar.routers.s5_distance_decay import compute
    cells = _make_cells(80)
    r = compute(cells, poi_lat=29.65, poi_lon=-82.35, n_permutations=49)
    assert len(r["envelope_lo"]) == len(r["bins"])
    assert len(r["envelope_hi"]) == len(r["bins"])


# ── S7 ──────────────────────────────────────────────────────────────────────

def test_s7_local_geary_counts():
    from sidecar.routers.s7_local_geary import compute
    r = compute(_make_cells(80), n_permutations=99)
    total = r["n_pos_autocorr"] + r["n_neg_autocorr"] + r["n_ns"]
    assert total == 80
    assert "winsorized" in r


# ── S8 ──────────────────────────────────────────────────────────────────────

def test_s8_bivariate_structure():
    from sidecar.routers.s8_bivariate import compute
    x = _make_cells(80, clustered=True)
    y = [{**c, "value": c["value"] + 0.1} for c in _make_cells(80, clustered=True)]
    r = compute(x, y, n_permutations=49)
    assert "lee_L" in r
    assert "pearson_r" in r
    assert -1.0 <= r["lee_L"] <= 1.0
    total = r["n_HH"] + r["n_LL"] + r["n_HL"] + r["n_LH"] + r["n_ns"]
    assert total == 80


def test_s8_insufficient_data():
    from sidecar.routers.s8_bivariate import compute
    x = _make_cells(20)
    y = _make_cells(20)
    r = compute(x, y, n_permutations=9)
    assert r.get("error") == "insufficient_data"
