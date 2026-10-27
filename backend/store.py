"""Data store for WindDesk: loads Elexon rows (snapshot or live) and builds
the per-day series the API serves.

IMPORTANT DATA NOTE (read before judging the numbers):
Elexon publishes WINDFOR forecasts HOURLY, not half-hourly, while FUELHH
actuals are half-hourly. To serve the contract's 48-point half-hour series,
each hourly forecast value is HELD for its two half-hours (e.g. the 15:00
forecast value fills 15:00 and 15:30). No interpolation is done and nothing
is smoothed: the half-hour values are exactly the published hourly values,
repeated twice. This is stated in every day response's `notes`.

Cutoff rule (env CUTOFF_TIME, default "17:00", UTC, applied on D-1):
latest run = the run with the greatest publishTime <= D-1 cutoff that
covers the delivery day. Up to 4 runs are served per day: the latest plus
the 3 next most recent runs before it (all runs span ~72h, so every recent
run covers the day). KPIs are computed on the LATEST run only.
error = actual - forecast; negative error = shortfall.
"""

import json
import os
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional

from . import metrics

TIMES_48 = [f"{h:02d}:{m:02d}" for h in range(24) for m in (0, 30)]
JAN_START = date(2026, 1, 1)
JAN_END = date(2026, 1, 31)
HOURLY_NOTE = (
    "WINDFOR is published hourly by Elexon; each hourly value is held for "
    "its two half-hours (no interpolation)."
)


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _parse_cutoff(raw: str) -> time:
    h, m = raw.strip().split(":")
    return time(int(h), int(m))


class DayMissing(Exception):
    pass


class Run:
    def __init__(self, published_iso: str):
        self.published_iso = published_iso
        self.published = _parse_iso(published_iso)
        # date string -> list of 24 hourly values (None when missing)
        self.hourly: Dict[str, List[Optional[float]]] = {}

    def half_hours(self, day: str) -> List[Optional[float]]:
        hours = self.hourly.get(day)
        if hours is None:
            return [None] * 48
        return [hours[i // 2] for i in range(48)]


class DataStore:
    def __init__(self, actual_rows, forecast_rows, source: str, cutoff_raw: str = "17:00"):
        self.source = source
        self.cutoff_raw = cutoff_raw
        self.cutoff = _parse_cutoff(cutoff_raw)
        self.actuals: Dict[str, List[Optional[float]]] = {}
        for row in actual_rows:
            period = row["settlementPeriod"]
            if not 1 <= period <= 48:
                continue
            day = self.actuals.setdefault(row["settlementDate"], [None] * 48)
            day[period - 1] = row["generation"]
        runs: Dict[str, Run] = {}
        for row in forecast_rows:
            run = runs.setdefault(row["publishTime"], Run(row["publishTime"]))
            start = _parse_iso(row["startTime"])
            day = run.hourly.setdefault(start.date().isoformat(), [None] * 24)
            day[start.hour] = row["generation"]
        self.runs: List[Run] = sorted(runs.values(), key=lambda r: r.published)

    # ---- selection ----
    def runs_for_day(self, day: date) -> List[Run]:
        """Up to 4 runs, latest first: latest published <= D-1 cutoff that
        covers the day, plus the 3 next most recent such runs."""
        d_minus_1 = day - timedelta(days=1)
        cutoff_dt = datetime.combine(d_minus_1, self.cutoff, tzinfo=timezone.utc)
        day_str = day.isoformat()
        cands = [r for r in self.runs
                 if r.published <= cutoff_dt and day_str in r.hourly]
        cands.sort(key=lambda r: r.published, reverse=True)
        return cands[:4]

    # ---- responses ----
    def day(self, day_str: str) -> dict:
        try:
            day = date.fromisoformat(day_str)
        except ValueError:
            raise DayMissing(f"invalid date: {day_str}")
        actual = self.actuals.get(day_str)
        runs = self.runs_for_day(day)
        if actual is None:
            raise DayMissing(f"no actuals for {day_str}")
        if not runs:
            raise DayMissing(
                f"no forecast run published at or before D-1 {self.cutoff_raw} "
                f"covering {day_str}"
            )
        latest = runs[0]
        latest_series = latest.half_hours(day_str)
        kpis = metrics.kpis(latest_series, actual, TIMES_48)
        table = []
        for t, f, a in zip(TIMES_48, latest_series, actual):
            err = (a - f) if (f is not None and a is not None) else None
            pos = None if err is None else ("shortfall" if err < 0 else "surplus")
            table.append({"time": t, "forecast": f, "actual": a,
                          "error": err, "position": pos})
        notes = [HOURLY_NOTE]
        if any(v is None for v in latest_series) or any(v is None for v in actual):
            notes.append("Some half-hours are missing in the source data; "
                         "they are null and excluded from all metrics.")
        run_payloads = []
        for r in runs:
            series = r.half_hours(day_str)
            n = (day - r.published.date()).days
            label = f"D-{n} {r.published.strftime('%H:%M')}" if n >= 1 \
                else f"Same day {r.published.strftime('%H:%M')}"
            run_payloads.append({
                "published": r.published_iso,
                "label": label,
                "total_gwh": metrics.gwh(series),
                "values": series,
            })
        return {
            "date": day_str,
            "cutoff": self.cutoff_raw,
            "latest_run_published": latest.published_iso,
            "runs": run_payloads,
            "actual": actual,
            "times": TIMES_48,
            "kpis": kpis,
            "table": table,
            "notes": notes,
        }

    def month_summary(self, month: str) -> dict:
        if month != "2026-01":
            raise DayMissing(f"no data for month {month} (only 2026-01 is in scope)")
        days = []
        d = JAN_START
        while d <= JAN_END:
            ds = d.isoformat()
            actual = self.actuals.get(ds)
            runs = self.runs_for_day(d)
            if actual is not None and runs:
                k = metrics.kpis(runs[0].half_hours(ds), actual, TIMES_48)
                days.append({"date": ds, **k})
            d += timedelta(days=1)
        return {"month": month, "days": days}

    # ---- health ----
    def health(self) -> dict:
        jan_days = sum(1 for ds in self.actuals if JAN_START.isoformat() <= ds <= JAN_END.isoformat())
        return {
            "status": "ok",
            "source": self.source,
            "actual_days": jan_days,
            "forecast_runs": len(self.runs),
        }


def snapshot_path() -> Path:
    env = os.environ.get("SNAPSHOT_PATH")
    if env:
        return Path(env)
    return Path(__file__).parent / "data" / "snapshot.json"


def load_snapshot(path: Path) -> DataStore:
    with open(path) as f:
        snap = json.load(f)
    return DataStore(snap["actuals"], snap["forecasts"], source="snapshot",
                     cutoff_raw=os.environ.get("CUTOFF_TIME", "17:00"))


def load() -> "tuple[Optional[DataStore], Optional[str]]":
    """Return (store, error). Live is attempted only when ELEXON_LIVE=1;
    otherwise the shipped snapshot is used. If neither works, error explains why."""
    cutoff = os.environ.get("CUTOFF_TIME", "17:00")
    if os.environ.get("ELEXON_LIVE") == "1":
        try:
            from .elexon import fetch_all
            actual_rows, forecast_rows = fetch_all()
            return DataStore(actual_rows, forecast_rows, source="live",
                             cutoff_raw=cutoff), None
        except Exception as exc:  # fall through to snapshot
            live_error = f"live Elexon fetch failed ({exc}); "
        else:
            live_error = ""
    else:
        live_error = ""
    path = snapshot_path()
    if path.exists():
        try:
            return load_snapshot(path), None
        except Exception as exc:
            return None, f"{live_error}snapshot {path} unreadable ({exc})"
    return None, (f"{live_error}no live data and no snapshot found at {path}. "
                  "Set ELEXON_LIVE=1 with network access, or run "
                  "backend/scripts/fetch_elexon.py to create the snapshot.")
