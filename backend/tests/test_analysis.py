"""The rules that make the numbers trustworthy: right forecast, right clock, no peeking."""

import math
from datetime import UTC, date, datetime, time, timedelta

import pytest

from app import analysis as a
from app.data import Dataset, Run


def utc(*args: int) -> datetime:
    return datetime(*args, tzinfo=UTC)


def test_gate_closure_is_uk_time_on_the_day_before():
    assert a.gate_closure(date(2026, 1, 15), time(9, 20)) == utc(2026, 1, 14, 9, 20)
    # Summer: UK time is UTC+1
    assert a.gate_closure(date(2026, 7, 15), time(9, 20)) == utc(2026, 7, 14, 8, 20)


@pytest.mark.parametrize("day, hours", [(date(2026, 1, 15), 24), (date(2026, 3, 29), 23), (date(2026, 10, 25), 25)])
def test_delivery_day_follows_the_uk_clock(day, hours):
    assert len(a.delivery_hours(day)) == hours


def test_uses_newest_forecast_published_by_the_gate_and_nothing_later():
    hour = utc(2026, 1, 15, 12)
    data = Dataset(
        actuals={hour: 900.0},
        forecasts={
            hour: [
                Run(utc(2026, 1, 14, 7, 30), 1000.0),
                Run(utc(2026, 1, 14, 9, 20), 2000.0),  # published exactly at the gate: allowed
                Run(utc(2026, 1, 14, 9, 30), 5000.0),  # 10 minutes too late for EPEX
            ]
        },
    )

    def picked(gate: time) -> a.HourPoint:
        return next(p for p in a.decision_forecast(data, date(2026, 1, 15), gate) if p.time == hour)

    assert picked(time(9, 20)).forecast == 2000.0
    assert picked(time(9, 50)).forecast == 5000.0
    assert picked(time(7, 0)).forecast is None  # nothing published yet


def test_error_band_only_uses_days_known_at_the_gate():
    # Over-forecast by 100 MW on D-15..D-2. D-1 (not yet metered at the gate)
    # and D-16 (outside the window) are off by 10 GW and must be ignored.
    day = date(2026, 1, 20)
    forecasts, actuals = {}, {}
    for back in range(1, 17):
        error = 10_000 if back in (1, 16) else 100
        for t in a.delivery_hours(day - timedelta(days=back)):
            forecasts[t] = [Run(t - timedelta(hours=48), 1000.0 + error)]
            actuals[t] = 1000.0

    band = a.error_band(Dataset(actuals, forecasts), day, time(9, 20))
    assert band == a.Band(100, 100, 100)
    assert band.apply(5000) == (4900, 4900, 4900)


def test_naive_baseline_only_uses_half_hours_finished_by_the_cutoff():
    data = Dataset(
        actuals={
            utc(2026, 1, 14, 8, 30): 800.0,  # 08:30-09:00, finished before a 09:20 decision
            utc(2026, 1, 14, 9, 0): 900.0,  # 09:00-09:30, still running at 09:20
        },
        forecasts={},
    )
    assert a.naive_level(data, utc(2026, 1, 14, 9, 20)) == 800.0
    assert a.naive_level(data, utc(2026, 1, 14, 9, 30)) == 900.0
    # A gap steps back to the last value that exists.
    assert a.naive_level(data, utc(2026, 1, 14, 11, 0)) == 900.0


def test_day_totals_are_energy_in_mwh():
    day = date(2026, 1, 15)
    hours = a.delivery_hours(day)
    actuals = {t + k * a.HALF_HOUR: 1000.0 + 200 * k for t in hours for k in (0, 1)}  # 1000 then 1200 MW
    points = [a.HourPoint(t, 2000.0, None, actuals[t]) for t in hours]
    totals = a.day_totals(Dataset(actuals, {}), points)
    assert totals == {"forecast_mwh": 24 * 2000.0, "actual_mwh": 24 * 1100.0}

    del actuals[hours[5] + a.HALF_HOUR]  # one missing half hour: don't report a partial total
    assert a.day_totals(Dataset(actuals, {}), points)["actual_mwh"] is None


def test_summary_metrics():
    # errors: +10, -10, +30, 0
    s = a.summarize([(110, 100), (90, 100), (130, 100), (100, 100)])
    assert s["mae"] == 12.5
    assert s["bias"] == 7.5
    assert s["rmse"] == pytest.approx(math.sqrt(1100 / 4))
    assert s["wape"] == 50 / 400
    assert s["within_1gw"] == 1.0


def test_quantile_interpolates_like_numpy():
    assert a.quantile([1, 2, 3, 4], 0.5) == 2.5
    assert a.quantile([0, 10], 0.1) == 1
