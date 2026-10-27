# WindDesk frontend

Vite + React + TypeScript port of the user's revised final UI
(`~/workspace/user/files/winddesk-v2__2.html`), wired to the WindDesk backend
API. No mock data: every number on screen comes from the API or is computed
from API values. Nothing is deployed from here and nothing is pushed to GitHub.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build into dist/
```

Backend base URL (same-origin `/api` by default — Vite proxies it to
`http://localhost:8000` in dev, Vercel rewrites it to the Python function):

```bash
# only needed to point at a separately hosted backend:
VITE_API_URL=https://your-backend.example.com npm run dev
# or copy .env.example to .env and set VITE_API_URL there
```

## API contract used

- `GET /api/health` → `{"status":"ok","source":"live"|"snapshot","actual_days":n,"forecast_runs":n}`
- `GET /api/config` → `{"cutoff":"17:00","cutoff_note":...}`
- `GET /api/months/2026-01/summary` → month days with forecast/actual GWh,
  MAE, bias, RMSE, largest shortfall + time
- `GET /api/days/{YYYY-MM-DD}` → runs (published/label/total_gwh/values[48]),
  actual[48], times[48], kpis, table[48]

Default day on load is the highest-MAE day from the month summary (never
hardcoded). Main chart shows actual + the latest 3 runs. Revision chart shows
all returned runs vs the actual line. Error bars are actual − forecast;
negative = shortfall. Month-chart bars are clickable and open that day.

## Behaviour notes (deviations from the mockup, all forced by the API)

- **Source strings follow the API.** The mockup's "Sample data — UI review only"
  pill becomes "Live Elexon data · January 2026" (live) or "Elexon snapshot ·
  January 2026" (snapshot); the same source state drives the methodology
  paragraph, the footer line and the ticker's last item. The mockup's own
  "simulated until the API is connected" disclaimer is replaced, since it would
  otherwise be false in the wired app.
- **Countdown** counts to the next occurrence of `/api/config`'s cutoff, with
  the API's `cutoff_note` as its label (fallback: "Day-ahead auction closes in
  (HH:MM UTC)").
- **No 90% band on the main chart.** The mockup's band needs forecast-spread
  data the API does not provide; drawing it from run spread would mislabel it,
  so the band sentence was dropped from the main-chart description.
- **Forecast-age slider selects the focus run.** The mockup's slider drove
  age-curve statistics the API does not provide. Here it picks the run whose
  age at delivery start is closest to the slider value; error chart, detail
  table and row-1 KPIs follow the focus run (recomputed exactly from its 48
  values; the API's per-day KPIs are used verbatim when the focus run is the
  latest run). Default = the latest run's age, so the default view matches the
  mockup. The decision strip names the focus run whenever it is not the latest.
- **Age + histogram panels are computed from all 31 day payloads** (fetched in
  the background after the month summary): mean MAE per age bucket (4/8/12/24/
  36/48 h, empty buckets shown as gaps) and the latest-run forecast-minus-
  actual histogram in 400 MW bins. If that fetch fails, both panels show an
  honest note instead of numbers.
- **"Left to buy" and "Safety buffer" show "–" with a note.** They need demand
  data and forecast-spread data respectively, which the current API does not
  provide. The "What is left to buy" panel likewise shows a note, not a chart.
- **Calendar** colours days by the month summary's latest-run MAE (the mockup
  coloured by age-specific MAE, which the API does not return).
- **No custom cursor.** The revised mockup file contains no cursor element
  (only `cursor:pointer` rules), so none was added.
- **No ThreeUI components, no new sections, no personal name, photo or GitHub
  link anywhere** — the submitted app stays anonymous.
- **Loading / error states:** if the backend is unreachable, a full error panel
  with Retry is shown and no figures are rendered; day-load failures keep the
  previous day visible with a retry note. Numbers are never faked.
- **Intro globe:** ~3 s (the file's `INTRO_SEC = 3` time-scaled timeline),
  real world-atlas coastlines with the file's coarse-polygon fallback, GB
  highlighted, Skip button, reduced-motion support, fallback timer, plus a
  safety net that reveals the page if a canvas frame ever throws. The ambient
  world-map background keeps the 6 UK wind farms. Dark theme is default;
  light theme via the header or dock toggle.
