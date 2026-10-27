# Wind Forecast Desk

A web app for a UK utility's day-ahead power buying team. It shows the wind forecast that was available when each buying decision was made, and measures how far that forecast missed, for every decision made in January 2026.

**Live app:** https://asdcxsa.vercel.app  
**Video walkthrough:** https://youtu.be/eQV-dEFT358 (Part 1: client overview, Part 2: technical review)

## What it does

**Decision day.** Pick a delivery day and a decision time: an auction gate (EPEX 09:20, N2EX 09:50) or any custom time on the day before. You see:

- which Elexon forecast run was the newest at that moment, and how old it was
- the hourly forecast, a bias-corrected forecast and a 10–90% likely range
- day totals: forecast, bias-corrected and low-case energy
- optionally, what actually happened, plus an hourly table

**Forecast accuracy.** Every January decision checked against metered output: headline error numbers, how the forecast compares with a naive guess, the month as a time series, error day by day, error by wind level, error by hours ahead, and the spread of misses. Click any day in the month or day-by-day chart to open it in Decision day.

## What January 2026 shows (EPEX gate, 09:20)

| | |
|---|---|
| Average over-forecast (bias) | **+1.75 GW** per hour |
| Typical miss (MAE) / RMSE | 2.02 GW / 2.50 GW |
| Miss as share of wind (WAPE) | 18% |
| Hours within ±1 GW | 26% |
| Over-forecast when the forecast says 18–21 GW | +3.4 GW |
| MAE after bias correction | **1.56 GW** (23% better) |
| Hours inside the 10–90% range | 82% (target 80%) |
| MAE of a naive guess (wind stays as it is) | 4.10 GW: the forecast **halves** it |

- The forecast is worth having: its typical miss is half that of assuming wind stays where it is at decision time.
- The forecast runs high, and most of the error is that bias, not randomness. Even forecasts 0–3 hours ahead miss by 1.7 GW.
- Deciding later barely helps: the typical miss is 2.06 GW deciding at 03:00 on D−1 and still 1.81 GW at 23:00.
- The bias is largest in strong wind, which fits wind farms being curtailed when the grid is full. The data alone can't confirm the cause.
- Subtracting the last two weeks' median error cuts the miss by 23%, using only data available on the day.
- Choosing N2EX (09:50) over EPEX (09:20) gives a fresher forecast run (09:30 vs 07:30) but barely improves accuracy (MAE 2.00 vs 2.02 GW).

## How the numbers are made

- **Decision time.** GB day-ahead auctions close the day before delivery: EPEX at 09:20 and N2EX at 09:50, UK time. For delivery day D, each hour uses the newest `WINDFOR` forecast published at or before gate closure on D−1. Nothing published later is ever used.
- **Actual.** `FUELHH` with `fuelType=WIND`, the half hour starting on the forecast hour. `WINDFOR` is hourly and `FUELHH` half-hourly. Matching on start time, as the brief describes, gave errors within about 1% of the other alignments tested.
- **Error** = forecast − actual. Positive means less wind arrived than forecast.
- **Custom decision time.** Any HH:MM on D−1 works the same way as a gate: the newest forecast published by then. Before about 03:00 on D−1, no published run reaches the last two hours of D yet; those hours are left blank and not scored.
- **Range and bias correction.** For day D we use the errors of delivery days D−15 to D−2. Those are the last 14 days fully metered when the decision is made. The range is the 10th–90th percentile of those errors; the correction subtracts the median.
- **Naive guess.** The last metered half hour that had finished at decision time, held flat across the delivery day. It is scored on the same hours as the forecast, as a baseline any forecast should beat.
- **Scope.** Decisions made 1–31 Jan 2026, so delivery days 2 Jan – 1 Feb (744 hours). Data from 18 Dec onward is loaded only to build the first days' ranges.
- **Assumptions.** A delivery day is the UK calendar day, handled with `Europe/London` so clock changes give 23 or 25 hours. Both datasets cover transmission-metered wind only.

## Run it

**Docker** (one container serving both API and UI):

```bash
docker compose up --build
# open http://localhost:8000
```

**Local development** (Python 3.12+, Node 22+):

```bash
# backend: http://localhost:8000, API docs at /docs
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cd backend && uvicorn app.main:app --reload

# frontend, in a second terminal: http://localhost:5173 (proxies /api to :8000)
cd frontend && npm install && npm run dev
```

**Tests and lint:**

```bash
cd backend && pytest && ruff check . && ruff format --check .
cd frontend && npm run build   # includes the TypeScript type check
```

**Refresh the data** from Elexon (public API, no key needed):

```bash
python backend/scripts/fetch_data.py
```

## Deploy (Vercel)

Import the repo in Vercel with no extra settings. `vercel.json` builds the React app as static files and runs `api/index.py` as a Python serverless function that serves the FastAPI app.

## Files and directories

```
backend/
  app/
    analysis.py        Core logic: picks the forecast available at gate closure, error maths, uncertainty range
    data.py            Loads the CSV snapshot into memory
    main.py            FastAPI routes; serves the built UI when it exists (Docker)
  data/
    actuals.csv        FUELHH wind outturn, half-hourly (18 Dec 2025 – 1 Feb 2026)
    forecasts.csv      WINDFOR forecasts: publish time, target hour, MW
  scripts/fetch_data.py  Downloads the two CSVs from the Elexon API
  tests/               Unit tests for the decision rules, plus API smoke tests
  pyproject.toml       pytest and ruff settings
frontend/
  src/
    App.tsx            Layout, view / decision time / day controls (kept in the URL so views can be shared)
    DecisionView.tsx   One delivery day: forecast, range, totals, hourly table
    AccuracyView.tsx   January-wide accuracy analysis
    api.ts             API types, fetch helpers, per-session request cache and prefetch
    format.ts          Number and UK-time formatting
    ui.tsx             Small shared components (stat tile, card, legend, tooltip)
    styles.css         Colour tokens (light and dark) and layout
api/index.py           Vercel serverless entry point, wraps the FastAPI app
demo/                  Scripted build of the demo video (narration, slides, recorder); see demo/README.md
Dockerfile             Two stages: build React, then run FastAPI serving API and UI
docker-compose.yml     `docker compose up` to run locally
vercel.json            Vercel build and routing config
requirements*.txt      Python dependencies (runtime / dev)
.github/workflows/ci.yml  Lint, tests and frontend build on every push
```

## API

| Endpoint | Returns |
|---|---|
| `GET /api/meta` | Delivery days, auction gate presets, data source |
| `GET /api/day/{YYYY-MM-DD}?gate=HH:MM` | Forecast at the decision time for each hour, range, totals, outcome |
| `GET /api/accuracy?gate=HH:MM` | Month-wide metrics, naive-guess comparison, timeline, per-day errors, error by level / hours ahead, histogram |

`gate` is any decision time on D−1, UK time (default 09:20). Successful responses carry `Cache-Control` so browsers and Vercel's CDN reuse them.

## Design choices

- **Snapshot instead of live calls.** January 2026 is history, so a 1 MB CSV snapshot makes the app fast, reproducible and independent of Elexon's uptime; the fetch script rebuilds it.
- **Plain Python for the maths.** About 22k rows fit easily in memory. Standard-library code keeps the Vercel function small and starts quickly, and each step is easy to test and explain.
- **Analysis separate from I/O.** `analysis.py` only does calculations; `main.py` is a thin HTTP layer. The tests cover the rules that matter most: no forecast from after the gate, the UK clock, a range built only from metered days, and a naive baseline that only uses finished half hours.
- **Fast by caching what never changes.** API responses are cached by Vercel's CDN until the next deploy and by the browser for an hour; built assets are cached for good. The function runs in London (`lhr1`), next to the client. The UI requests the first view's data in parallel with `/api/meta`, keeps every response for the session, and preloads the neighbouring days and the other view, so moving around is instant.

## Use of AI tools

Built with help from Claude Code (Anthropic's AI coding assistant) for writing code, exploring the Elexon data and reviewing. The approach, numbers and findings were checked against the data and tests.
