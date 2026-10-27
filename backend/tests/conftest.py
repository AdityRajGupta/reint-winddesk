"""Shared fixture: two January delivery days with hand-built Elexon rows.

Day 2026-01-15 (D-1 = 2026-01-14, cutoff 17:00):
  actuals: constant 150 MW every half-hour.
  runs (hourly values for 2026-01-15, constant per run):
    2026-01-14T18:30 -> 500  (AFTER cutoff: must be excluded)
    2026-01-14T17:00 -> 100  (exactly at cutoff: must be INCLUDED, latest)
    2026-01-14T15:30 -> 200
    2026-01-14T11:30 -> 300
    2026-01-14T09:30 -> 400
    2026-01-13T22:30 -> 600  (5th candidate: excluded by the 4-run cap)
  Expected served runs (latest first): 17:00, 15:30, 11:30, 09:30.
  Expected KPIs on latest (100 MW vs 150 MW actual): MAE 50, bias 50,
  RMSE 50, forecast 2.4 GWh, actual 3.6 GWh, largest shortfall +50 at 00:00
  (no negative error exists, so the minimum error is reported).

Day 2026-01-16: actuals constant 200 MW; one run 2026-01-15T15:30 -> 200 MW
(hourly for 2026-01-16), so all errors are 0.
"""

import pytest

from backend.store import DataStore


def _actual_rows(day, value):
    return [
        {"settlementDate": day, "settlementPeriod": p, "generation": value}
        for p in range(1, 49)
    ]


def _run_rows(published, day, hourly_value):
    return [
        {"publishTime": published,
         "startTime": f"{day}T{h:02d}:00:00Z",
         "generation": hourly_value}
        for h in range(24)
    ]


def make_fixture_store(cutoff="17:00"):
    actuals = _actual_rows("2026-01-15", 150) + _actual_rows("2026-01-16", 200)
    forecasts = []
    for published, value in [
        ("2026-01-14T18:30:00Z", 500),
        ("2026-01-14T17:00:00Z", 100),
        ("2026-01-14T15:30:00Z", 200),
        ("2026-01-14T11:30:00Z", 300),
        ("2026-01-14T09:30:00Z", 400),
        ("2026-01-13T22:30:00Z", 600),
    ]:
        forecasts += _run_rows(published, "2026-01-15", value)
    forecasts += _run_rows("2026-01-15T15:30:00Z", "2026-01-16", 200)
    return DataStore(actuals, forecasts, source="snapshot", cutoff_raw=cutoff)


@pytest.fixture
def store():
    return make_fixture_store()
