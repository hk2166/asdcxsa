"""HTTP API. A thin layer: check inputs, call analysis.py, return JSON.

Interactive docs at /docs when running locally.
"""

from datetime import date, time, timedelta
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.staticfiles import StaticFiles

from . import analysis
from .data import Dataset, load

# Decisions made 1-31 Jan 2026 buy power for the following day.
DELIVERY_DAYS = [date(2026, 1, 2) + timedelta(days=i) for i in range(31)]

# Day-ahead auction gate closures on D-1, UK time.
GATES = [
    {"time": "09:20", "label": "EPEX 09:20"},
    {"time": "09:50", "label": "N2EX 09:50"},
]
GateParam = Query("09:20", pattern=r"^([01]\d|2[0-3]):[0-5]\d$", description="Gate closure on D-1, UK time (HH:MM)")

app = FastAPI(title="Wind Forecast Desk API")

# The data is a fixed snapshot, so a response only changes when the app is redeployed.
# Browsers reuse it for an hour; Vercel's CDN keeps it until the next deploy (which clears the CDN).
CACHE = "public, max-age=3600, s-maxage=31536000"


@app.middleware("http")
async def cache_api_responses(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/") and response.status_code == 200:
        response.headers["Cache-Control"] = CACHE
    return response


@lru_cache(maxsize=1)
def dataset() -> Dataset:
    return load()


@app.get("/api/meta")
def meta() -> dict:
    return {
        "delivery_days": [d.isoformat() for d in DELIVERY_DAYS],
        "gates": GATES,
        "source": "Elexon BMRS: WINDFOR (forecast) and FUELHH fuelType=WIND (actual)",
    }


@app.get("/api/day/{day}")
def day(day: date, gate: str = GateParam) -> dict:
    if day not in DELIVERY_DAYS:
        raise HTTPException(404, f"No data for {day}. Delivery days run {DELIVERY_DAYS[0]} to {DELIVERY_DAYS[-1]}.")
    return analysis.day_view(dataset(), day, time.fromisoformat(gate))


@lru_cache(maxsize=32)
def _accuracy(gate: str) -> dict:
    return analysis.accuracy_report(dataset(), DELIVERY_DAYS, time.fromisoformat(gate))


@app.get("/api/accuracy")
def accuracy(gate: str = GateParam) -> dict:
    return _accuracy(gate)


# In Docker the built React app ships in the same container and is served here.
# On Vercel the frontend is served by Vercel's CDN and this folder doesn't exist.
STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
