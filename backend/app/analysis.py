"""Forecast selection and accuracy maths. Pure functions, no I/O.

The key rule: a buying decision for delivery day D is made at gate closure
on D-1 (e.g. 09:20 UK time). The forecast used is, for each hour of D, the
newest forecast published at or before that moment. Nothing published
later is ever used, so the numbers show what the trader really had.

Error = forecast - actual. Positive means wind was over-forecast (less wind
turned up than expected, so more power had to be bought).
"""

import math
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from .data import Dataset, Run

LONDON = ZoneInfo("Europe/London")
HOUR = timedelta(hours=1)
HALF_HOUR = timedelta(minutes=30)

BAND_DAYS = 14  # history used for the uncertainty band
BAND_MIN_POINTS = 24 * 7  # need at least a week of errors to show a band


@dataclass(frozen=True)
class HourPoint:
    time: datetime  # start of the delivery hour (UTC)
    forecast: float | None  # MW, the forecast available at gate closure
    published: datetime | None  # when that forecast was published
    actual: float | None  # MW, metered outturn for the half hour starting at `time`


def gate_closure(day: date, gate: time) -> datetime:
    """When the decision for `day` is made: `gate` (UK time) on the day before."""
    return datetime.combine(day - timedelta(days=1), gate, tzinfo=LONDON).astimezone(UTC)


def delivery_hours(day: date) -> list[datetime]:
    """Start of each hour in the UK calendar day (23 or 25 hours on clock-change days)."""
    t = datetime.combine(day, time(0), tzinfo=LONDON).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=1), time(0), tzinfo=LONDON).astimezone(UTC)
    hours = []
    while t < end:
        hours.append(t)
        t += HOUR
    return hours


def latest_before(runs: list[Run], cutoff: datetime) -> Run | None:
    """Newest forecast published at or before `cutoff`. `runs` is sorted by publish time."""
    i = bisect_right(runs, cutoff, key=lambda r: r.published)
    return runs[i - 1] if i else None


def decision_forecast(data: Dataset, day: date, gate: time) -> list[HourPoint]:
    cutoff = gate_closure(day, gate)
    points = []
    for t in delivery_hours(day):
        run = latest_before(data.forecasts.get(t, []), cutoff)
        points.append(
            HourPoint(
                time=t,
                forecast=run.mw if run else None,
                published=run.published if run else None,
                actual=data.actuals.get(t),
            )
        )
    return points


def naive_level(data: Dataset, cutoff: datetime) -> float | None:
    """The 'wind stays as it is now' guess: the last metered half hour that had ended by `cutoff`.

    A baseline any forecast should beat. Like the forecast, it only uses what was known at the time.
    """
    t = cutoff.replace(minute=cutoff.minute // 30 * 30, second=0, microsecond=0) - HALF_HOUR
    for _ in range(48):  # step back past any gap, up to a day
        if t in data.actuals:
            return data.actuals[t]
        t -= HALF_HOUR
    return None


def paired(points: list[HourPoint]) -> list[tuple[float, float]]:
    """(forecast, actual) for hours where both are known."""
    return [(p.forecast, p.actual) for p in points if p.forecast is not None and p.actual is not None]


def quantile(sorted_values: list[float], q: float) -> float:
    """Linear-interpolated quantile, same as numpy's default."""
    pos = (len(sorted_values) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def summarize(pairs: list[tuple[float, float]]) -> dict:
    """Headline accuracy numbers for a set of (forecast, actual) pairs."""
    if not pairs:
        return {"n": 0}
    errors = sorted(f - a for f, a in pairs)
    n = len(errors)
    abs_sum = sum(abs(e) for e in errors)
    return {
        "n": n,
        "mae": abs_sum / n,
        "rmse": math.sqrt(sum(e * e for e in errors) / n),
        "bias": sum(errors) / n,
        # Weighted absolute % error: total miss / total wind. Unlike MAPE it
        # doesn't blow up in calm hours when actual wind is near zero.
        "wape": abs_sum / sum(a for _, a in pairs),
        "p10": quantile(errors, 0.10),
        "p50": quantile(errors, 0.50),
        "p90": quantile(errors, 0.90),
        "within_1gw": sum(abs(e) <= 1000 for e in errors) / n,
    }


@dataclass(frozen=True)
class Band:
    """Percentiles of recent forecast errors (MW), used to adjust and bracket a forecast."""

    p10: float
    p50: float
    p90: float

    def apply(self, forecast: float) -> tuple[float, float, float]:
        """(low, expected, high) wind for a forecast. actual = forecast - error,
        so the high error percentile gives the low end of the range."""
        return max(0.0, forecast - self.p90), forecast - self.p50, forecast - self.p10


def error_band(data: Dataset, day: date, gate: time) -> Band | None:
    """Error percentiles over recent days, using only what was known at the gate.

    At gate closure on D-1 the last fully metered day is D-2, so the band
    uses delivery days D-15 .. D-2. Never looks at D-1 or later.
    """
    errors = []
    for back in range(2, 2 + BAND_DAYS):
        errors += [f - a for f, a in paired(decision_forecast(data, day - timedelta(days=back), gate))]
    if len(errors) < BAND_MIN_POINTS:
        return None
    errors.sort()
    return Band(quantile(errors, 0.10), quantile(errors, 0.50), quantile(errors, 0.90))


def bucket(value: float, width: float) -> float:
    return math.floor(value / width) * width


def day_totals(data: Dataset, points: list[HourPoint]) -> dict:
    """Energy for one delivery day in MWh, or None if any hour is missing."""
    forecasts = [p.forecast for p in points]
    halves = [data.actuals.get(p.time + k * HALF_HOUR) for p in points for k in (0, 1)]
    return {
        "forecast_mwh": None if None in forecasts else sum(forecasts),
        "actual_mwh": None if None in halves else sum(halves) / 2,  # each half hour is 0.5 h at that MW
    }


def accuracy_report(data: Dataset, days: list[date], gate: time) -> dict:
    """Everything the Accuracy page shows, for decisions made at `gate`."""
    points: list[HourPoint] = []
    expected: dict[datetime, float] = {}  # bias-adjusted forecast per hour
    adjusted_pairs: list[tuple[float, float]] = []
    naive_pairs: list[tuple[float, float]] = []
    in_band: list[bool] = []
    daily: list[dict] = []
    for d in days:
        day_points = decision_forecast(data, d, gate)
        points += day_points
        day_pairs = paired(day_points)
        level = naive_level(data, gate_closure(d, gate))
        if level is not None:
            naive_pairs += [(level, a) for _, a in day_pairs]  # same hours the forecast is scored on
        day_summary = summarize(day_pairs)
        daily.append(
            {
                "day": d.isoformat(),
                "mae": day_summary.get("mae"),
                "bias": day_summary.get("bias"),
                **day_totals(data, day_points),
            }
        )
        band = error_band(data, d, gate)
        if not band:
            continue
        for p in day_points:
            if p.forecast is None:
                continue
            low, mid, high = band.apply(p.forecast)
            expected[p.time] = mid
            if p.actual is not None:
                adjusted_pairs.append((mid, p.actual))
                in_band.append(low <= p.actual <= high)
    pairs = paired(points)

    # Over-forecasting grows with wind level, so split errors by forecast size.
    by_level: dict[float, list[float]] = defaultdict(list)
    for f, a in pairs:
        by_level[bucket(f, 3000)].append(f - a)

    histogram: dict[float, int] = defaultdict(int)
    for f, a in pairs:
        histogram[bucket(f - a, 500)] += 1

    # How error shrinks as delivery gets closer, using every forecast run
    # (not just the one picked at the gate) for the same delivery hours.
    targets = {p.time for p in points if p.actual is not None}
    by_horizon: dict[float, list[float]] = defaultdict(list)
    for t in targets:
        for run in data.forecasts.get(t, []):
            hours_ahead = (t - run.published) / HOUR
            by_horizon[bucket(hours_ahead, 3)].append(abs(run.mw - data.actuals[t]))

    used_horizons = [(p.time - p.published) / HOUR for p in points if p.published]

    return {
        "summary": summarize(pairs),
        # Same metrics for the bias-adjusted forecast, and how often the
        # 10-90% band really contained the actual (should be ~80%).
        "adjusted_summary": summarize(adjusted_pairs),
        # The naive 'wind stays as it is' guess, scored on the same hours: what the forecast adds.
        "naive_summary": summarize(naive_pairs),
        "band_coverage": sum(in_band) / len(in_band) if in_band else None,
        "days": daily,
        "timeline": [
            {"time": iso(p.time), "forecast": p.forecast, "expected": expected.get(p.time), "actual": p.actual}
            for p in points
        ],
        "by_level": [
            {
                "from_mw": lo,
                "to_mw": lo + 3000,
                "n": len(errs),
                "mean_error": sum(errs) / len(errs),
                "mae": sum(abs(e) for e in errs) / len(errs),
            }
            for lo, errs in sorted(by_level.items())
        ],
        # Every 500 MW bin from the smallest to the largest error, empty ones included,
        # so the chart's x axis has no silent gaps.
        "histogram": [
            {"from_mw": lo, "to_mw": lo + 500, "count": histogram.get(lo, 0)}
            for lo in range(int(min(histogram, default=0)), int(max(histogram, default=-500)) + 500, 500)
        ],
        "by_horizon": [
            {"from_h": lo, "to_h": lo + 3, "n": len(errs), "mae": sum(errs) / len(errs)}
            for lo, errs in sorted(by_horizon.items())
        ],
        "decision_horizon_h": [min(used_horizons), max(used_horizons)] if used_horizons else None,
    }


def day_view(data: Dataset, day: date, gate: time) -> dict:
    """Everything the Decision page shows for one delivery day."""
    points = decision_forecast(data, day, gate)
    band = error_band(data, day, gate)
    published = sorted({p.published for p in points if p.published})

    hours = []
    for p in points:
        low = expected = high = None
        if band and p.forecast is not None:
            low, expected, high = band.apply(p.forecast)
        hours.append(
            {
                "time": iso(p.time),
                "forecast": p.forecast,
                "expected": expected,
                "low": low,
                "high": high,
                "actual": p.actual,
                # The second half hour's actual, so the chart can show full detail.
                "actual_half": data.actuals.get(p.time + HOUR / 2),
            }
        )

    def total(key: str) -> float | None:
        values = [h[key] for h in hours]
        return None if None in values else sum(values)  # hourly MW summed = MWh

    return {
        "day": day.isoformat(),
        "gate_closure": iso(gate_closure(day, gate)),
        "runs_used": [iso(t) for t in published],
        "band": {"error_p10": band.p10, "error_p50": band.p50, "error_p90": band.p90, "days": BAND_DAYS}
        if band
        else None,
        "hours": hours,
        "totals_mwh": {k: total(k) for k in ("forecast", "expected", "low", "high")},
        "outcome": summarize(paired(points)),
    }


def iso(t: datetime) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
