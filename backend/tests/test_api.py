"""Smoke tests against the real January 2026 snapshot."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_day_view():
    body = client.get("/api/day/2026-01-15", params={"gate": "09:20"}).json()
    assert body["gate_closure"] == "2026-01-14T09:20:00Z"
    assert len(body["hours"]) == 24
    assert all(run <= body["gate_closure"] for run in body["runs_used"])  # ISO strings sort as times
    assert body["band"] is not None


def test_accuracy_covers_every_january_decision():
    body = client.get("/api/accuracy").json()
    assert body["summary"]["n"] == 31 * 24
    assert 0.7 < body["band_coverage"] < 0.9  # a 10-90% band should hold ~80% of outcomes
    assert [d["day"] for d in body["days"]][::30] == ["2026-01-02", "2026-02-01"]


def test_forecast_beats_the_naive_baseline():
    body = client.get("/api/accuracy").json()
    assert body["naive_summary"]["n"] == body["summary"]["n"]  # scored on the same hours
    assert body["summary"]["mae"] < body["naive_summary"]["mae"]


def test_any_decision_time_works():
    body = client.get("/api/day/2026-01-15", params={"gate": "16:45"}).json()
    assert body["gate_closure"] == "2026-01-14T16:45:00Z"
    assert client.get("/api/accuracy", params={"gate": "06:00"}).json()["summary"]["n"] == 31 * 24


def test_successful_responses_are_cacheable_and_errors_are_not():
    assert "s-maxage" in client.get("/api/meta").headers["cache-control"]
    assert "s-maxage" not in client.get("/api/day/2026-03-01").headers.get("cache-control", "")


def test_rejects_bad_input():
    assert client.get("/api/day/2026-03-01").status_code == 404
    assert client.get("/api/accuracy", params={"gate": "9am"}).status_code == 422
