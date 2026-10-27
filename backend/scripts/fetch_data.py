"""Download the Elexon wind data the app needs and save it as two small CSVs.

    python backend/scripts/fetch_data.py

Buying decisions made 1-31 Jan 2026 are for delivery days 2 Jan - 1 Feb 2026.
We also pull the two weeks before that: the app's error band for a delivery
day is built from the 14 days the trader had already seen, so 2 Jan needs
data from mid-December.

Uses only the standard library so it runs anywhere Python does.
"""

import csv
import json
import urllib.parse
import urllib.request
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

API = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
DATA_DIR = Path(__file__).resolve().parents[1] / "data"
LONDON = ZoneInfo("Europe/London")

FIRST_DAY = date(2025, 12, 18)  # earliest delivery day (history for the band)
LAST_DAY = date(2026, 2, 1)  # delivery day decided on 31 Jan 2026


def get(dataset: str, **params: str) -> list[dict]:
    url = f"{API}/{dataset}/stream?{urllib.parse.urlencode(params)}"
    for attempt in range(3):  # the API is slow and sometimes drops a request
        try:
            with urllib.request.urlopen(url, timeout=120) as resp:
                return json.load(resp)
        except OSError as err:
            print(f"  retrying {dataset} after: {err}")
            if attempt == 2:
                raise
    return []


def parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def iso(t: datetime) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_actuals() -> list[tuple[str, int]]:
    rows = get(
        "FUELHH",
        settlementDateFrom=FIRST_DAY.isoformat(),
        settlementDateTo=LAST_DAY.isoformat(),
        fuelType="WIND",
    )
    return sorted({(r["startTime"], r["generation"]) for r in rows})


def fetch_forecasts() -> list[tuple[str, str, int]]:
    window_start = datetime.combine(FIRST_DAY, time(0), tzinfo=LONDON)
    window_end = datetime.combine(LAST_DAY + timedelta(days=1), time(0), tzinfo=LONDON)

    # Forecast runs reach ~3 days ahead, so start pulling runs 3 days early.
    # Fetch a week at a time to keep each response small.
    seen: dict[tuple[str, str], int] = {}
    chunk_start = window_start - timedelta(days=3)
    while chunk_start < window_end:
        chunk_end = min(chunk_start + timedelta(days=7), window_end)
        for r in get("WINDFOR", publishDateTimeFrom=iso(chunk_start), publishDateTimeTo=iso(chunk_end)):
            published, target = parse(r["publishTime"]), parse(r["startTime"])
            # Keep forecasts for our delivery window, made before the hour they predict.
            if window_start <= target < window_end and published <= target:
                seen[(r["publishTime"], r["startTime"])] = r["generation"]
        chunk_start = chunk_end
    return sorted((p, s, g) for (p, s), g in seen.items())


def write(name: str, header: list[str], rows: list[tuple]) -> None:
    path = DATA_DIR / name
    with path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)
    print(f"wrote {len(rows):>6} rows -> {path}")


if __name__ == "__main__":
    DATA_DIR.mkdir(exist_ok=True)
    write("actuals.csv", ["start_time", "generation_mw"], fetch_actuals())
    write("forecasts.csv", ["publish_time", "start_time", "generation_mw"], fetch_forecasts())
