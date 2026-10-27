# WindDesk — GB day-ahead wind intelligence

A web app for a UK energy utility team that buys power on the day-ahead
market. It answers two questions for every January 2026 delivery day:

1. **What is the latest wind forecast available when the decision is made?**
   Decisions are made one day before delivery (D-1). The app shows the
   latest usable forecast run plus earlier runs, so the desk can see how
   the forecast evolved.
2. **How accurate were those forecasts?** MAE, bias and RMSE in MW,
   daily totals in GWh, signed half-hour errors, and the largest
   shortfall — the extra power that would have had to be procured beyond
   wind.

**Scope (per the brief):** national-level wind only, Elexon data only,
purchase decisions in January 2026 only. No demand series exists in this
scope, so panels that would need demand ("left to buy", "safety buffer")
honestly show "–" instead of invented numbers.

**Live app:** _(link added when deployed on Vercel)_

**AI tools disclosure (required by the brief):** this application was
built with AI assistance (Muse, including subagents for the backend and
frontend builds). All Elexon data is real published data, all metrics are
computed from it in code, and the backend is covered by unit tests.

## Data — read this before judging the numbers

- **Actuals:** Elexon BMRS `FUELHH`, `fuelType=WIND`, half-hourly
  (48 values per settlement day).
- **Forecasts:** Elexon BMRS `WINDFOR`. **WINDFOR is published HOURLY by
  Elexon, not half-hourly** (~8 runs/day, each run spanning ~72 hours).
  To serve 48-point half-hour series, each hourly value is **held for its
  two half-hours** (e.g. the 15:00 forecast fills 15:00 and 15:30). No
  interpolation, no smoothing — the half-hour values are exactly the
  published hourly values, repeated twice. Every day response states
  this in its `notes`.
- **Snapshot:** `backend/data/snapshot.json` — real Elexon rows exactly
  as returned (fetch window 2025-12-30 → 2026-02-01, so edge runs for
  1 Jan and 31 Jan are covered). Re-fetch any time with:
  `python backend/scripts/fetch_elexon.py` (from the repo root).
- **Live mode:** set `ELEXON_LIVE=1` and the service fetches from Elexon
  at startup instead. If live fails it falls back to the snapshot; if
  neither exists, data endpoints return **503 with the reason**, and
  `/api/health` returns 503 too.

## Quick start

### Docker (recommended)

```bash
docker compose up --build
# app:    http://localhost:8080
# api:    http://localhost:8000/api/health
```

### Local, backend + frontend separately

```bash
# backend (from the repo root)
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.app:app --reload --port 8000

# frontend (from frontend/)
npm install
npm run dev   # http://localhost:5173 (Vite proxies /api to localhost:8000)
```

### Tests

```bash
python -m pytest backend/tests/ -q   # 15 tests: metric math, cutoff rule,
                                      # hourly→half-hour mapping, API smoke
cd frontend && npm run build         # TypeScript + Vite production build
```

## API

- `GET /api/health` →
  `{"status":"ok","source":"live"|"snapshot","actual_days":n,"forecast_runs":n}`
- `GET /api/config` →
  `{"cutoff":"17:00","cutoff_note":"Decision made D-1; latest usable forecast
  is the latest WINDFOR run published at or before this time on D-1"}`
- `GET /api/months/2026-01/summary` →
  `{"month":"2026-01","days":[{"date","forecast_gwh","actual_gwh","mae_mw",
  "bias_mw","rmse_mw","largest_shortfall_mw","largest_shortfall_time"}]}`
- `GET /api/days/{YYYY-MM-DD}` →
  `{"date","cutoff","latest_run_published","runs":[{"published","label",
  "total_gwh","values":[48]}],"actual":[48],"times":[48 labels],
  "kpis":{...},"table":[{"time","forecast","actual","error","position"}],
  "notes":[...]}`

## Rules

- **Cutoff:** env `CUTOFF_TIME`, default `"17:00"`, UTC, applied on D-1.
  Latest run = greatest `publishTime` <= D-1 cutoff that covers the day.
  Runs are served latest-first, up to 4 (latest + 3 earlier).
- **KPIs on the LATEST run only.** `error = actual - forecast`;
  negative error = shortfall. MAE = mean |error|, bias = mean error,
  RMSE = sqrt(mean error²), over half-hours where both sides exist.
  Daily GWh = sum(MW) × 0.5 / 1000. Largest shortfall = most negative
  error with its time.
- **Missing half-hours:** `null` in series, excluded from metrics, noted
  in `notes`. In `table`, a row with missing data has `error: null` and
  `position: null`; otherwise `position` is `"shortfall"` iff error < 0,
  else `"surplus"`.
- Unknown day/month or a day with no usable run → **404**. No data at
  all → **503** with the reason.

## Files and directories

```
backend/
  app.py            FastAPI app + routes
  store.py          snapshot/live loading, run selection, day/month assembly
  metrics.py        pure metric math (unit-tested)
  elexon.py         live BMRS client (probed parameters, chunked fetching)
  data/snapshot.json  real Elexon rows, 2025-12-30 → 2026-02-01
  scripts/fetch_elexon.py  re-fetch the snapshot from live Elexon
  tests/            pytest: metric math, cutoff rule, endpoint smoke tests
frontend/
  src/App.tsx       full page: header, dock, KPIs, charts, table, methodology
  src/index.css     the reference UI stylesheet, transplanted verbatim
  src/lib/globe.ts  intro globe (3 s, real coastlines) + ambient map canvas
  src/lib/api.ts    backend client (same-origin /api; VITE_API_URL override)
  src/lib/charts.ts ECharts builders (echarts 5.5.0)
  src/lib/format.ts number/time formatting
  Dockerfile        node build → nginx serve
api/index.py        Vercel entry (imports the same FastAPI app)
vercel.json         /api/* rewrite to the serverless function
docker-compose.yml  api (8000) + web (8080)
Dockerfile          python:3.12-slim backend, uvicorn on $PORT
requirements.txt    fastapi, httpx, uvicorn, pytest
```

## Deploy

Vercel: import the repo, `api/index.py` serves the backend as a Python
serverless function (`vercel.json` rewrites `/api/*` to it) and the
frontend builds from `frontend/`. Env vars: `CUTOFF_TIME` (optional),
`ELEXON_LIVE=1` (optional; snapshot mode is recommended — live fetching
on every cold start is slow). Heroku is the fallback if Vercel's Python
runtime proves troublesome.

## Notes and limits

- The day endpoint serves any date present in the snapshot, including
  2026-02-01 (a fetch-window edge); the month summary is intentionally
  January-only per the brief, and the frontend only requests January.
- Forecast runs shown are the latest 4 runs before the cutoff per day;
  the main chart plots the latest 3.
- No Supabase, no Render, no database server: the backend is stateless
  and reads only the JSON snapshot (or live Elexon in live mode).
