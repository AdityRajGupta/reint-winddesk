"""Cutoff / latest-run rule and the hourly -> half-hour mapping."""

from datetime import date

import pytest

from backend.store import DayMissing
from conftest import make_fixture_store


def test_latest_run_rule_and_cap(store):
    runs = store.runs_for_day(date(2026, 1, 15))
    published = [r.published_iso for r in runs]
    assert published == [
        "2026-01-14T17:00:00Z",  # exactly at cutoff: included, and latest
        "2026-01-14T15:30:00Z",
        "2026-01-14T11:30:00Z",
        "2026-01-14T09:30:00Z",  # 4-run cap stops here
    ]
    assert "2026-01-14T18:30:00Z" not in published  # after cutoff
    assert "2026-01-13T22:30:00Z" not in published  # 5th candidate, capped


def test_cutoff_is_configurable():
    store = make_fixture_store(cutoff="12:00")
    runs = store.runs_for_day(date(2026, 1, 15))
    assert runs[0].published_iso == "2026-01-14T11:30:00Z"


def test_hourly_value_held_for_both_half_hours(store):
    day = store.day("2026-01-15")
    latest = day["runs"][0]
    assert latest["published"] == "2026-01-14T17:00:00Z"
    assert latest["values"] == [100] * 48  # hourly 100 held across half-hours
    assert day["times"] == [f"{h:02d}:{m:02d}" for h in range(24) for m in (0, 30)]
    assert day["kpis"] == {
        "forecast_gwh": 2.4,
        "actual_gwh": 3.6,
        "mae_mw": 50,
        "bias_mw": 50,
        "rmse_mw": 50,
        "largest_shortfall_mw": 50,
        "largest_shortfall_time": "00:00",
    }
    assert day["table"][0] == {"time": "00:00", "forecast": 100, "actual": 150,
                               "error": 50, "position": "surplus"}
    assert len(day["table"]) == 48
    assert any("hourly" in n for n in day["notes"])


def test_day_missing(store):
    with pytest.raises(DayMissing):
        store.day("2026-01-17")  # no actuals in fixture
    with pytest.raises(DayMissing):
        store.day("not-a-date")
    with pytest.raises(DayMissing):
        store.month_summary("2026-02")
