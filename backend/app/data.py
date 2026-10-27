"""Load the saved Elexon snapshot (backend/data/*.csv) into memory.

January 2026 is in the past, so the data never changes. Shipping a snapshot
keeps the app fast and independent of Elexon's uptime during a demo.
Refresh it with backend/scripts/fetch_data.py.
"""

import csv
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


@dataclass(frozen=True)
class Run:
    """One forecast value: what a forecast run published at `published` said for an hour."""

    published: datetime
    mw: float


@dataclass(frozen=True)
class Dataset:
    actuals: dict[datetime, float]  # half-hour start (UTC) -> metered wind MW
    forecasts: dict[datetime, list[Run]]  # target hour (UTC) -> forecasts, oldest first


def parse_time(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def load(data_dir: Path = DATA_DIR) -> Dataset:
    with (data_dir / "actuals.csv").open() as f:
        actuals = {parse_time(r["start_time"]): float(r["generation_mw"]) for r in csv.DictReader(f)}

    forecasts: dict[datetime, list[Run]] = defaultdict(list)
    with (data_dir / "forecasts.csv").open() as f:
        for r in csv.DictReader(f):
            forecasts[parse_time(r["start_time"])].append(Run(parse_time(r["publish_time"]), float(r["generation_mw"])))
    for runs in forecasts.values():
        runs.sort(key=lambda r: r.published)  # analysis.latest_before relies on this order

    return Dataset(actuals, dict(forecasts))
