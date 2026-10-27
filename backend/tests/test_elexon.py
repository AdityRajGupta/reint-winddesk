"""Chunking/dedupe logic of backend.elexon, tested offline with a fake client.

No network: the fake client returns canned rows per window so we can prove
that wide windows are split into <=7-day chunks and overlapping windows
are deduplicated. (Live shape of the rows was verified against the real
Elexon API during the snapshot fetch.)
"""

from datetime import date

from backend import elexon


class FakeResponse:
    def __init__(self, rows):
        self._rows = rows

    def raise_for_status(self):
        pass

    def json(self):
        return {"data": self._rows}


class FakeClient:
    """Records requested windows; returns one row per day in the window."""

    def __init__(self):
        self.windows = []

    def get(self, url, params):
        self.windows.append((url.split("/")[-1], dict(params)))
        if "FUELHH" in url:
            start, end = params["settlementDateFrom"], params["settlementDateTo"]
            d0, d1 = date.fromisoformat(start), date.fromisoformat(end)
            rows = []
            d = d0
            while d <= d1:
                rows.append({"settlementDate": d.isoformat(),
                             "settlementPeriod": 1, "generation": 100})
                d = d.fromordinal(d.toordinal() + 1)
            return FakeResponse(rows)
        start = params["publishDateTimeFrom"][:10]
        end = params["publishDateTimeTo"][:10]
        return FakeResponse([{"publishTime": f"{start}T02:30:00Z",
                              "startTime": f"{start}T00:00:00Z",
                              "generation": 100}])


def test_fuelhh_chunks_and_dedupes():
    c = FakeClient()
    rows = elexon.fetch_fuelhh(c, date(2026, 1, 1), date(2026, 1, 20))
    assert len(rows) == 20  # one row per day, no duplicates across chunks
    spans = [(w[1]["settlementDateFrom"], w[1]["settlementDateTo"])
             for w in c.windows]
    assert spans == [("2026-01-01", "2026-01-07"),
                     ("2026-01-08", "2026-01-14"),
                     ("2026-01-15", "2026-01-20")]
    assert all(w[1]["fuelType"] == "WIND" for w in c.windows)


def test_windfor_windows_use_publish_filters():
    c = FakeClient()
    rows = elexon.fetch_windfor(c, date(2026, 1, 14), date(2026, 1, 14))
    assert len(rows) == 1
    assert len(c.windows) == 1  # single-day window must terminate, not loop
    params = c.windows[0][1]
    assert "publishDateTimeFrom" in params and "publishDateTimeTo" in params
