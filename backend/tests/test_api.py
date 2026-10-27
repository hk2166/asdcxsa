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


def test_rejects_bad_input():
    assert client.get("/api/day/2026-03-01").status_code == 404
    assert client.get("/api/accuracy", params={"gate": "9am"}).status_code == 422
