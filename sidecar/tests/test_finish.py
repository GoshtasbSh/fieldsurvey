from sidecar.routers.finish import compute


def test_returns_p50_p75_p90():
    history = [5] * 30
    result = compute(history, target=100, start="2026-06-01", sims=2000)
    assert result["p50_days"] is not None
    assert 15 <= result["p50_days"] <= 25
    assert result["p90_days"] >= result["p50_days"]


def test_empty_history_returns_nulls():
    result = compute([], target=100, start="2026-06-01", sims=500)
    assert result["p50_days"] is None
    assert result["p50_date"] is None


def test_zero_target_returns_nulls():
    result = compute([5, 5, 5], target=0, start="2026-06-01", sims=500)
    assert result["p50_days"] is None


def test_deterministic_with_seed():
    history = [3, 4, 5, 6, 7]
    r1 = compute(history, target=50, start="2026-06-01", sims=500, seed=42)
    r2 = compute(history, target=50, start="2026-06-01", sims=500, seed=42)
    assert r1["p50_days"] == r2["p50_days"]
    assert r1["p90_days"] == r2["p90_days"]
