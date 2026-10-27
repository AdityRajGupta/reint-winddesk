"""Fetch real Elexon BMRS data and save it as backend/data/snapshot.json.

Thin wrapper around backend.elexon (the same client the service uses for
live mode). See backend/elexon.py for endpoint/parameter notes.

Usage (from the repo root):
    python backend/scripts/fetch_elexon.py [--out backend/data/snapshot.json]
"""

import argparse
import json
import sys
from datetime import date

sys.path.insert(0, ".")  # repo root, so `backend` package imports work

from backend.elexon import FETCH_FROM, FETCH_TO, fetch_all  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="backend/data/snapshot.json")
    args = ap.parse_args()

    actuals, forecasts = fetch_all()
    print(f"FUELHH rows: {len(actuals)}")
    print(f"WINDFOR rows: {len(forecasts)}")

    by_day = {}
    for row in actuals:
        by_day.setdefault(row["settlementDate"], []).append(row)
    jan_days = [date(2026, 1, d) for d in range(1, 32)]
    missing = [d.isoformat() for d in jan_days if len(by_day.get(d.isoformat(), [])) != 48]
    if missing:
        print(f"WARNING: days without exactly 48 FUELHH rows: {missing}", file=sys.stderr)

    pub_times = sorted({r["publishTime"] for r in forecasts})
    print(f"WINDFOR distinct runs: {len(pub_times)} "
          f"({pub_times[0] if pub_times else '-'} .. {pub_times[-1] if pub_times else '-'})")

    snapshot = {
        "fetched_from": "Elexon BMRS live API (https://data.elexon.co.uk/bmrs/api/v1/datasets/)",
        "fetch_window": [FETCH_FROM.isoformat(), FETCH_TO.isoformat()],
        "actuals": actuals,
        "forecasts": forecasts,
    }
    with open(args.out, "w") as f:
        json.dump(snapshot, f)
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
