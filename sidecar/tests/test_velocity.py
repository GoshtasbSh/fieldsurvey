from sidecar.routers.velocity import compute


def test_detects_step_change():
    daily = [3] * 10 + [9] * 10
    out = compute(daily, min_size=3)
    assert any(8 < cp < 12 for cp in out["changepoints"])


def test_short_series_returns_no_breaks():
    out = compute([1, 2, 3], min_size=5)
    assert out["changepoints"] == []
    assert out["n_breaks"] == 0


def test_flat_signal_returns_no_breaks():
    out = compute([5] * 30, min_size=5)
    assert out["n_breaks"] == 0
