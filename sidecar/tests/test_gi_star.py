import random

from sidecar.routers.gi_star import compute


def test_gi_star_below_threshold_returns_empty():
    cells = [
        {"id": str(i), "value": v, "lat": 0.0 + i * 0.01, "lon": 0.0}
        for i, v in enumerate([1, 1, 1, 5, 5, 5, 1, 1, 1])
    ]
    out = compute(cells, k=3)
    assert out["results"] == []
    assert out["n"] == 9


def test_gi_star_returns_z_and_p_for_30_plus_cells():
    rng = random.Random(42)
    cells = [
        {
            "id": str(i),
            "value": rng.uniform(0, 10),
            "lat": rng.uniform(29.0, 29.5),
            "lon": rng.uniform(-82.8, -82.4),
        }
        for i in range(40)
    ]
    out = compute(cells, k=5)
    assert len(out["results"]) == 40
    assert all("z" in r and "p" in r for r in out["results"])
    assert out["k"] == 5
    assert out["permutations"] == 999
