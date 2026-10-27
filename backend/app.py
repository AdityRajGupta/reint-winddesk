"""WindDesk backend: UK day-ahead wind intelligence (REint challenge).

Serves Elexon BMRS national wind data for January 2026 delivery days.
Data source: shipped JSON snapshot by default (backend/data/snapshot.json);
set ELEXON_LIVE=1 to fetch live from Elexon at startup instead (falls back
to the snapshot if live fails). No database server, no Supabase, no Render.

Cutoff: env CUTOFF_TIME (default "17:00"), applied on D-1 in UTC.
"""

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .store import DayMissing, load

CUTOFF_NOTE = (
    "Decision made D-1; latest usable forecast is the latest WINDFOR run "
    "published at or before this time on D-1"
)


def create_app(store=None):
    app = FastAPI(title="WindDesk backend",
                  description="Elexon BMRS national wind actuals (FUELHH) and "
                              "forecasts (WINDFOR) for January 2026.")
    # The page and the API run on different origins (e.g. :8080 vs :8000 in
    # Docker, or any separately hosted frontend). Without this, the browser
    # receives the API's reply but refuses to hand it to the page, and the
    # frontend reports "Could not reach" even though the server logged 200.
    # Public read-only data, no auth, so any origin may read it.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    state = {"store": store, "error": None}
    if store is None:
        state["store"], state["error"] = load()

    def require_store():
        if state["store"] is None:
            raise HTTPException(status_code=503, detail=state["error"])
        return state["store"]

    @app.get("/api/health")
    def health():
        if state["store"] is None:
            raise HTTPException(status_code=503,
                                detail=state["error"])
        return state["store"].health()

    @app.get("/api/config")
    def config():
        cutoff = os.environ.get("CUTOFF_TIME", "17:00")
        return {"cutoff": cutoff, "cutoff_note": CUTOFF_NOTE}

    @app.get("/api/months/{month}/summary")
    def month_summary(month: str):
        store = require_store()
        try:
            return store.month_summary(month)
        except DayMissing as exc:
            raise HTTPException(status_code=404, detail=str(exc))

    @app.get("/api/days/{day}")
    def day(day: str):
        store = require_store()
        try:
            return store.day(day)
        except DayMissing as exc:
            raise HTTPException(status_code=404, detail=str(exc))

    return app


app = create_app()
