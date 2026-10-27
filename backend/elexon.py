"""Live Elexon BMRS client (national GB wind only).

Endpoints (probed, not assumed):
  - FUELHH:  settlementDateFrom/settlementDateTo + fuelType=WIND.
    Half-hourly rows; one settlement day = 48 rows (settlementPeriod 1..48).
    Wide date windows are rejected (400), so fetch in <=7-day chunks.
  - WINDFOR: publishDateTimeFrom/publishDateTimeTo. Without these filters
    the API returns only the latest published run, so always pass a window.
    Rows are HOURLY (one value per hour, ~8 runs/day, each run spans ~72h).
    See backend/store.py for how hourly values map onto half-hours.

No API key is required for these public datasets.
"""

import os
from datetime import date, timedelta

import httpx

BASE = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
FETCH_FROM = date(2025, 12, 30)
FETCH_TO = date(2026, 2, 1)  # inclusive; covers edge runs for Jan delivery days


def make_client():
    """Build an httpx client that works both in this sandbox (egress proxy
    with its own CA bundle, and bracketed IPv6 entries in no_proxy that
    httpx cannot parse) and on a normal machine (no proxy env -> direct,
    default verification)."""
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    verify = os.environ.get("SSL_CERT_FILE") or True
    return httpx.Client(proxy=proxy, trust_env=False, verify=verify, timeout=120)


def _get(client, dataset, params):
    r = client.get(f"{BASE}/{dataset}", params={"format": "json", **params})
    r.raise_for_status()
    return r.json()["data"]


def fetch_fuelhh(client, start=FETCH_FROM, end=FETCH_TO):
    rows = {}
    day = start
    while day <= end:
        chunk_end = min(day + timedelta(days=6), end)
        for row in _get(
            client,
            "FUELHH",
            {
                "settlementDateFrom": day.isoformat(),
                "settlementDateTo": chunk_end.isoformat(),
                "fuelType": "WIND",
            },
        ):
            rows[(row["settlementDate"], row["settlementPeriod"])] = row
        day = chunk_end + timedelta(days=1)
    return list(rows.values())


def fetch_windfor(client, start=FETCH_FROM, end=FETCH_TO):
    rows = {}
    day = start
    while day <= end:
        chunk_end = min(day + timedelta(days=6), end + timedelta(days=1))
        for row in _get(
            client,
            "WINDFOR",
            {
                "publishDateTimeFrom": f"{day.isoformat()}T00:00:00Z",
                "publishDateTimeTo": f"{chunk_end.isoformat()}T00:00:00Z",
            },
        ):
            rows[(row["publishTime"], row["startTime"])] = row
        day = chunk_end
    return list(rows.values())


def fetch_all():
    """Return (actual_rows, forecast_rows) fetched live from Elexon."""
    with make_client() as client:
        return fetch_fuelhh(client), fetch_windfor(client)
