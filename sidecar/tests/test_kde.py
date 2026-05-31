from sidecar.routers.kde import compute


def test_kde_returns_grid():
    pts = [
        (0.0, 0.0),
        (0.01, 0.01),
        (0.02, 0.01),
        (0.03, 0.02),
        (0.04, 0.03),
        (0.05, 0.04),
        (0.0, 0.0),
        (0.01, 0.0),
    ]
    out = compute(pts, bandwidth=0.05, grid_size=16)
    assert out["bandwidth"] == 0.05
    assert out["grid_size"] == 16
    assert out["n"] == len(pts)
    assert len(out["values"]) > 0


def test_kde_empty_below_threshold():
    out = compute([(0.0, 0.0)], bandwidth=0.01, grid_size=16)
    assert out["n"] == 0
    assert out["grid"] == []
    assert out["values"] == []
