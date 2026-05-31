# sidecar/tests/test_medium_routers.py
def test_a6_ngrams_basic():
    from sidecar.routers.a6_ngrams import compute
    r = compute(["clean water is important", "road safety matters", "clean water supply", "more parks needed", "clean air quality"], n_gram="both", max_terms=10)
    assert "unigrams" in r
    assert r["unigrams"][0]["term"] == "clean"
    assert r["n_text"] == 5

def test_a6_empty():
    from sidecar.routers.a6_ngrams import compute
    r = compute(["", "", ""], n_gram="1")
    assert r["error"] == "no_text"

def test_a6_bigrams():
    from sidecar.routers.a6_ngrams import compute
    r = compute(["clean water clean water clean water"] * 5, n_gram="2")
    assert len(r["bigrams"]) > 0
    assert r["bigrams"][0]["term"] == "clean water"

def test_a35_detects_straightliner():
    from sidecar.routers.a35_straight_line import compute
    rows = [{"response_id": str(i), "values": [3.0, 3.0, 3.0, 3.0, 3.0]} for i in range(10)]
    rows += [{"response_id": str(i+10), "values": [1.0, 3.0, 5.0, 2.0, 4.0]} for i in range(10)]
    r = compute(rows, question_keys=["q1","q2","q3","q4","q5"], threshold=0.8)
    assert r["n_flagged"] == 10

def test_a35_insufficient_questions():
    from sidecar.routers.a35_straight_line import compute
    rows = [{"response_id": "1", "values": [3.0, 3.0]}]
    r = compute(rows, question_keys=["q1","q2"], threshold=0.8, min_questions=3)
    assert r["error"] == "insufficient_questions"

def test_a35_no_straightliners():
    from sidecar.routers.a35_straight_line import compute
    import random; random.seed(42)
    rows = [{"response_id": str(i), "values": [float(random.randint(1,5)) for _ in range(5)]} for i in range(30)]
    r = compute(rows, question_keys=["q1","q2","q3","q4","q5"], threshold=0.99)
    assert "n_flagged" in r

def test_a43_raking_basic():
    from sidecar.routers.a43_raking import compute
    groups = ["A"] * 30 + ["B"] * 10 + ["C"] * 20
    r = compute(groups, trim_cap=5.0)
    assert "cv" in r and "effective_n" in r and r["n_groups"] == 3

def test_a43_single_group():
    from sidecar.routers.a43_raking import compute
    r = compute(["A"] * 20)
    assert r.get("error") == "single_group"

def test_a46_segment_diff_basic():
    from sidecar.routers.a46_segment_diff import compute
    rows = []
    for i in range(30):
        rows.append({"response_id": str(i), "group_value": "A", "question_values": {"q1": float(i % 5 + 1), "q2": float(i % 3)}})
    for i in range(30):
        rows.append({"response_id": str(i+30), "group_value": "B", "question_values": {"q1": float((i % 5 + 3) % 5 + 1), "q2": float(i % 3)}})
    r = compute(rows, fdr_alpha=0.05, min_n=10)
    assert "comparisons" in r and r["n_tests"] >= 1

def test_a46_single_group():
    from sidecar.routers.a46_segment_diff import compute
    rows = [{"response_id": str(i), "group_value": "A", "question_values": {"q1": 1.0}} for i in range(20)]
    r = compute(rows)
    assert r.get("error") == "single_group"
