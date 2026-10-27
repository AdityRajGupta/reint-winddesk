"""Endpoint smoke tests against the fixture store, plus the 503 path."""

import os

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from conftest import make_fixture_store


@pytest.fixture
def client():
    return TestClient(create_app(store=make_fixture_store()))


def test_health_and_config(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "source": "snapshot",
                        "actual_days": 2, "forecast_runs": 7}
    r = client.get("/api/config")
    assert r.status_code == 200
    assert r.json()["cutoff"] == "17:00"
    assert "D-1" in r.json()["cutoff_note"]


def test_day_endpoint(client):
    r = client.get("/api/days/2026-01-15")
    assert r.status_code == 200
    body = r.json()
    assert body["date"] == "2026-01-15"
    assert body["cutoff"] == "17:00"
    assert body["latest_run_published"] == "2026-01-14T17:00:00Z"
    assert len(body["runs"]) == 4
    assert len(body["actual"]) == 48
    assert len(body["times"]) == 48
    assert body["kpis"]["mae_mw"] == 50


def test_month_summary(client):
    r = client.get("/api/months/2026-01/summary")
    assert r.status_code == 200
    body = r.json()
    assert body["month"] == "2026-01"
    assert [d["date"] for d in body["days"]] == ["2026-01-15", "2026-01-16"]
    jan16 = body["days"][1]
    assert jan16["mae_mw"] == 0 and jan16["bias_mw"] == 0 and jan16["rmse_mw"] == 0


def test_404s(client):
    assert client.get("/api/days/2026-01-17").status_code == 404
    assert client.get("/api/days/nope").status_code == 404
    assert client.get("/api/months/2026-02/summary").status_code == 404


def test_no_data_gives_503(monkeypatch):
    monkeypatch.setenv("SNAPSHOT_PATH", "/tmp/winddesk-no-such-snapshot.json")
    monkeypatch.delenv("ELEXON_LIVE", raising=False)
    app = create_app()
    c = TestClient(app, raise_server_exceptions=False)
    r = c.get("/api/health")
    assert r.status_code == 503
    assert "snapshot" in r.json()["detail"].lower()
    assert c.get("/api/days/2026-01-15").status_code == 503
