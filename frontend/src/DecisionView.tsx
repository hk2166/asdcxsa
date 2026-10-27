import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type DayView } from "./api";
import { clock, dateTime, dayLabel, gw, gwAxis, gwh, hoursMinutes, mw, ukDay } from "./format";
import { Card, Failed, Legend, Loading, Stat, Tip, useData, type Series } from "./ui";

const HALF_HOUR = 30 * 60 * 1000;

const SERIES: Series[] = [
  { key: "band", label: "Likely range (10–90%)", color: "var(--band)", band: true },
  { key: "forecast", label: "Elexon forecast", color: "var(--series-forecast)" },
  { key: "expected", label: "Bias-corrected", color: "var(--series-expected)" },
  { key: "actual", label: "Actual (hindsight)", color: "var(--series-actual)" },
];

/** Hourly forecasts plus half-hourly actuals, on one time axis. */
function chartRows(view: DayView) {
  return view.hours.flatMap((h) => {
    const t = Date.parse(h.time);
    return [
      {
        t,
        forecast: h.forecast,
        expected: h.expected,
        band: h.low != null && h.high != null ? [h.low, h.high] : null,
        actual: h.actual,
      },
      { t: t + HALF_HOUR, actual: h.actual_half },
    ];
  });
}

export function DecisionView({ day, gate, atGate }: { day: string; gate: string; atGate: boolean }) {
  const { data, error } = useData(() => api.day(day, gate), `${day}@${gate}`);
  const [hindsight, setHindsight] = useState(true);
  if (error) return <Failed error={error} />;
  if (!data) return <Loading />;

  const gateAt = Date.parse(data.gate_closure);
  const run = data.runs_used.at(-1);
  const uncovered = data.hours.filter((h) => h.forecast == null).length;
  // Energy actually delivered: each half-hour average MW x 0.5 h.
  const actualMwh = data.hours.every((h) => h.actual != null && h.actual_half != null)
    ? data.hours.reduce((sum, h) => sum + ((h.actual ?? 0) + (h.actual_half ?? 0)) / 2, 0)
    : null;
  const series = SERIES.filter((s) => hindsight || s.key !== "actual");
  const peak = Math.max(...data.hours.flatMap((h) => [h.high, h.forecast, h.actual, h.actual_half].map((v) => v ?? 0)));

  return (
    <>
      <p className="lede">
        Buying for <strong>{dayLabel(data.day)}</strong>. {atGate ? "At gate closure on" : "Deciding on"}{" "}
        <strong>{dateTime(gateAt)}</strong> the newest wind forecast was published at{" "}
        <strong>{run ? (ukDay(run) === ukDay(gateAt) ? clock(run) : dateTime(run)) : "–"}</strong>
        {run && <> ({hoursMinutes(gateAt - Date.parse(run))} old)</>}.
      </p>
      {uncovered > 0 && (
        <p className="notice">
          No forecast published by then reaches {uncovered} of the day’s {data.hours.length} hours, so those hours and the
          day totals are left blank. Elexon’s runs don’t always look that far ahead.
        </p>
      )}

      <div className="stats">
        <Stat label="Elexon forecast" value={gwh(data.totals_mwh.forecast)} note="Wind energy for the day, as published" />
        <Stat
          label="Bias-corrected"
          value={gwh(data.totals_mwh.expected)}
          note={
            data.band &&
            (data.band.error_p50 >= 0
              ? `Takes off ${gw(data.band.error_p50)} an hour, the typical over-forecast of the last ${data.band.days} days`
              : `Adds ${gw(-data.band.error_p50)} an hour, the typical under-forecast of the last ${data.band.days} days`)
          }
        />
        <Stat
          label="Low case"
          value={gwh(data.totals_mwh.low)}
          note="Wind beat this in 9 of 10 recent hours. Size cover against it."
        />
        {hindsight && (
          <Stat
            label="What actually came"
            value={gwh(actualMwh)}
            note={data.outcome.n > 0 && <>Forecast missed by {gw(data.outcome.mae)} per hour on average</>}
          />
        )}
      </div>

      <Card
        title="Wind generation by hour"
        subtitle="Forecast available at gate closure, with the range recent errors suggest. GB transmission-metered wind, UK time."
      >
        <div className="chart-head">
          <Legend series={series} />
          <label className="toggle">
            <input type="checkbox" checked={hindsight} onChange={(e) => setHindsight(e.target.checked)} />
            Show actual
          </label>
        </div>
        <div className="chart" style={{ height: 340 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartRows(data)} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                ticks={data.hours.filter((_, i) => i % 3 === 0).map((h) => Date.parse(h.time))}
                tickFormatter={clock}
                stroke="var(--axis)"
                tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              />
              <YAxis
                {...gwAxis(peak)}
                tickFormatter={(v: number) => `${v / 1000}`}
                width={48}
                stroke="var(--axis)"
                tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                label={{ value: "GW", position: "insideTopLeft", offset: 0, dy: -4, fill: "var(--text-muted)", fontSize: 12 }}
              />
              <Tooltip
                cursor={{ stroke: "var(--axis)" }}
                content={(p) => <Tip {...p} title={(t) => clock(t as number)} value={(v) => `${mw(v)} MW`} />}
              />
              <Area dataKey="band" name="Likely range" fill="var(--band)" stroke="none" connectNulls isAnimationActive={false} />
              <Line dataKey="forecast" name="Elexon forecast" stroke="var(--series-forecast)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              <Line dataKey="expected" name="Bias-corrected" stroke="var(--series-expected)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              {hindsight && (
                <Line dataKey="actual" name="Actual" stroke="var(--series-actual)" strokeWidth={2} dot={false} isAnimationActive={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <details className="card table-card">
        <summary>Hourly numbers (MW)</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Hour</th>
                <th>Forecast</th>
                <th>Bias-corrected</th>
                <th>Low</th>
                <th>High</th>
                {hindsight && <th>Actual</th>}
                {hindsight && <th>Error</th>}
              </tr>
            </thead>
            <tbody>
              {data.hours.map((h) => (
                <tr key={h.time}>
                  <td>{clock(h.time)}</td>
                  <td>{mw(h.forecast)}</td>
                  <td>{mw(h.expected)}</td>
                  <td>{mw(h.low)}</td>
                  <td>{mw(h.high)}</td>
                  {hindsight && <td>{mw(h.actual)}</td>}
                  {hindsight && <td>{h.forecast != null && h.actual != null ? mw(h.forecast - h.actual) : "–"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
