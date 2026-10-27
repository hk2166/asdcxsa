import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type DayRow } from "./api";
import { dateTime, dayLabel, dayShort, gw, gwAxis, gwh, mw, pct, signedGw, ukDay } from "./format";
import { Card, Failed, Legend, Loading, Stat, Tip, useData, type Series } from "./ui";

const axis = { stroke: "var(--axis)", tick: { fill: "var(--text-muted)", fontSize: 12 } };
const gwTicks = (v: number) => `${v / 1000}`;
const BAR = { fill: "var(--series-forecast)", radius: [4, 4, 0, 0] as [number, number, number, number], maxBarSize: 24 };

const TIMELINE: Series[] = [
  { key: "forecast", label: "Elexon forecast", color: "var(--series-forecast)" },
  { key: "expected", label: "Bias-corrected", color: "var(--series-expected)" },
  { key: "actual", label: "Actual", color: "var(--series-actual)" },
];

/** Axis in 2 GW steps that includes zero and every value (errors can be negative). */
function signedAxis(values: number[]) {
  const step = 2000;
  const lo = Math.min(0, Math.floor(Math.min(...values) / step) * step);
  const hi = Math.max(step, Math.ceil(Math.max(...values) / step) * step);
  return { domain: [lo, hi], ticks: Array.from({ length: (hi - lo) / step + 1 }, (_, i) => lo + i * step) };
}

/** Typical miss of three ways to estimate tomorrow's wind, as bars on one scale. */
function MethodBars({ methods }: { methods: { label: string; note: string; mae: number; color: string }[] }) {
  const max = Math.max(...methods.map((m) => m.mae));
  return (
    <div className="methods">
      {methods.map((m) => (
        <div className="method" key={m.label}>
          <div className="method-label">
            {m.label}
            <span className="muted">{m.note}</span>
          </div>
          <div className="method-track">
            <div className="method-bar" style={{ width: `${(m.mae / max) * 100}%`, background: m.color }} />
          </div>
          <div className="method-value">{gw(m.mae, 2)}</div>
        </div>
      ))}
    </div>
  );
}

export function AccuracyView({ gate, atGate, onOpenDay }: { gate: string; atGate: boolean; onOpenDay: (day: string) => void }) {
  const { data, error } = useData(() => api.accuracy(gate), gate);
  if (error) return <Failed error={error} />;
  if (!data) return <Loading />;

  const s = data.summary;
  const adj = data.adjusted_summary;
  const naive = data.naive_summary;
  const timeline = data.timeline.map((r) => ({ ...r, t: Date.parse(r.time) }));
  const mondays = timeline.filter((r) => new Date(r.t).getUTCDay() === 1 && new Date(r.t).getUTCHours() === 0).map((r) => r.t);
  const [h0, h1] = data.decision_horizon_h ?? [0, 0];
  const timelineMax = Math.max(...timeline.flatMap((r) => [r.forecast ?? 0, r.actual ?? 0]));

  return (
    <>
      <p className="lede">
        Every buying decision in January 2026 ({atGate ? "gate closure" : "decided at"} {gate} UK time on the day before),
        checked against what the meters recorded.
      </p>

      <div className="hero card">
        <div className="hero-value">{signedGw(s.bias)}</div>
        <div>
          <p className="hero-text">
            The forecast you buy against <strong>over-stated wind by {gw(s.bias)} an hour</strong> on average. Taken at
            face value, it leaves you short.
          </p>
          <p className="muted">
            Correcting it with the previous two weeks’ error cuts the typical miss from {gw(s.mae)} to {gw(adj.mae)} (
            {pct(1 - adj.mae / s.mae)} better), using only data available on the day.
          </p>
        </div>
      </div>

      <div className="stats">
        <Stat label="Typical miss (MAE)" value={gw(s.mae, 2)} note={`RMSE ${gw(s.rmse, 2)}`} />
        <Stat label="Miss as share of wind" value={pct(s.wape)} note="Total absolute error ÷ total wind (WAPE)" />
        <Stat label="Hours within ±1 GW" value={pct(s.within_1gw)} note={`of ${s.n} hours`} />
        <Stat label="Bias-corrected miss" value={gw(adj.mae, 2)} note={`Bias left: ${signedGw(adj.bias)}`} />
        <Stat
          label="Range reliability"
          value={pct(data.band_coverage)}
          note="of hours landed inside the 10–90% range (target 80%)"
        />
      </div>

      <Card
        title="What the forecast is worth"
        subtitle={`Typical miss (MAE) of three ways to estimate tomorrow’s wind, scored on the same ${s.n} hours.`}
      >
        <MethodBars
          methods={[
            { label: "Naive guess", note: "wind stays as it is at decision time", mae: naive.mae, color: "var(--text-muted)" },
            { label: "Elexon forecast", note: "newest run at decision time", mae: s.mae, color: "var(--series-forecast)" },
            { label: "Bias-corrected", note: "minus the last two weeks’ median error", mae: adj.mae, color: "var(--series-expected)" },
          ]}
        />
        <p className="muted method-summary">
          Elexon’s forecast cuts the naive guess’s miss by <strong>{pct(1 - s.mae / naive.mae)}</strong>. Correcting its
          bias takes off another {pct(1 - adj.mae / s.mae)}.
        </p>
      </Card>

      <Card title="Forecast at decision time vs actual, January 2026" subtitle="Each point is one delivery hour. Click to open that day.">
        <Legend series={TIMELINE} />
        <div className="chart clickable" style={{ height: 300 }}>
          <ResponsiveContainer>
            <LineChart
              data={timeline}
              margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
              onClick={(e) => typeof e.activeLabel === "number" && onOpenDay(ukDay(e.activeLabel))}
            >
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={mondays} tickFormatter={dayShort} {...axis} />
              <YAxis {...gwAxis(timelineMax)} tickFormatter={gwTicks} width={40} {...axis} />
              <Tooltip
                cursor={{ stroke: "var(--axis)" }}
                content={(p) => <Tip {...p} title={(t) => dateTime(t as number)} value={(v) => `${mw(v)} MW`} />}
              />
              {TIMELINE.map((x) => (
                <Line key={x.key} dataKey={x.key} name={x.label} stroke={x.color} strokeWidth={x.key === "actual" ? 2 : 1.5} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Day by day" subtitle="Average error for each delivery day (forecast − actual). Click a bar to open that day.">
        <div className="chart clickable" style={{ height: 220 }}>
          <ResponsiveContainer>
            <BarChart
              data={data.days}
              margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
              onClick={(e) => {
                const row = data.days[Number(e.activeIndex)];
                if (row) onOpenDay(row.day);
              }}
            >
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="day" tickFormatter={dayShort} interval={2} {...axis} />
              <YAxis {...signedAxis(data.days.map((d) => d.bias ?? 0))} tickFormatter={gwTicks} width={40} {...axis} />
              <ReferenceLine y={0} stroke="var(--axis)" />
              <Tooltip
                cursor={{ fill: "var(--hover)" }}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as DayRow | undefined;
                  if (!active || !row) return null;
                  return (
                    <div className="tooltip">
                      <div className="tooltip-title">{dayLabel(row.day)} · click to open</div>
                      <div className="tooltip-row"><strong>{signedGw(row.bias)}</strong><span>average error</span></div>
                      <div className="tooltip-row"><strong>{gwh(row.forecast_mwh)}</strong><span>forecast</span></div>
                      <div className="tooltip-row"><strong>{gwh(row.actual_mwh)}</strong><span>actual</span></div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="bias" name="average error" radius={3} maxBarSize={24} isAnimationActive={false}>
                {data.days.map((d) => (
                  <Cell key={d.day} fill={(d.bias ?? 0) >= 0 ? "var(--series-forecast)" : "var(--series-actual)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="axis-note">Delivery day · blue: less wind than forecast · orange: more</p>
      </Card>

      <div className="grid-2">
        <Card title="Over-forecasting grows with wind" subtitle="Average error (forecast − actual) by forecast level. Positive = less wind arrived than forecast.">
          <div className="chart" style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={data.by_level} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="from_mw" tickFormatter={(v: number) => `${v / 1000}–${v / 1000 + 3}`} {...axis} />
                <YAxis {...gwAxis(Math.max(...data.by_level.map((r) => r.mean_error)))} tickFormatter={gwTicks} width={40} {...axis} />
                <ReferenceLine y={0} stroke="var(--axis)" />
                <Tooltip
                  cursor={{ fill: "var(--hover)" }}
                  content={(p) => (
                    <Tip
                      {...p}
                      title={(v) => {
                        const row = data.by_level.find((r) => r.from_mw === v);
                        return `Forecast ${Number(v) / 1000}–${Number(v) / 1000 + 3} GW · ${row?.n ?? 0} hours`;
                      }}
                      value={(v) => signedGw(v)}
                    />
                  )}
                />
                <Bar dataKey="mean_error" name="average error" {...BAR} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="axis-note">Forecast level (GW)</p>
        </Card>

        <Card title="Error vs hours ahead" subtitle="Typical miss of every forecast run for the same hours. Shaded: where day-ahead decisions sit.">
          <div className="chart" style={{ height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={data.by_horizon.map((r) => ({ ...r, mid: r.from_h + 1.5 }))} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <ReferenceArea x1={h0} x2={h1} fill="var(--band)" stroke="none" />
                <XAxis dataKey="mid" type="number" domain={[0, "dataMax"]} ticks={[0, 12, 24, 36, 48, 60]} {...axis} />
                <YAxis {...gwAxis(Math.max(...data.by_horizon.map((r) => r.mae)))} tickFormatter={gwTicks} width={40} {...axis} />
                <Tooltip
                  cursor={{ stroke: "var(--axis)" }}
                  content={(p) => <Tip {...p} title={(m) => `${Number(m) - 1.5}–${Number(m) + 1.5} h ahead`} value={(v) => gw(v, 2)} />}
                />
                <Line dataKey="mae" name="typical miss" stroke="var(--series-forecast)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="axis-note">Hours between publication and delivery</p>
        </Card>
      </div>

      <Card
        title="How big the misses are"
        subtitle={
          <>
            Hours by error size, in 0.5 GW steps. The middle 80% of hours fall between {signedGw(s.p10)} and{" "}
            {signedGw(s.p90)}; faded bars are the 20% outside that.
          </>
        }
      >
        <div className="chart" style={{ height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={data.histogram} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="from_mw" tickFormatter={gwTicks} {...axis} />
              <YAxis width={40} {...axis} />
              <Tooltip
                cursor={{ fill: "var(--hover)" }}
                content={(p) => (
                  <Tip {...p} title={(v) => `Error ${signedGw(Number(v))} to ${signedGw(Number(v) + 500)}`} value={(v) => `${v} hours`} />
                )}
              />
              <Bar dataKey="count" name="hours" {...BAR} isAnimationActive={false}>
                {data.histogram.map((b) => (
                  <Cell key={b.from_mw} fill={b.to_mw > s.p10 && b.from_mw < s.p90 ? "var(--series-forecast)" : "var(--series-muted)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="axis-note">Error, forecast − actual (GW)</p>
      </Card>

      <Card title="How these numbers are made">
        <ul className="notes">
          <li>
            Decision for delivery day D is made at gate closure on D−1 (or your own decision time). For each hour of D we
            take the newest Elexon forecast (WINDFOR) published at or before that moment. Nothing published later is used.
          </li>
          <li>Actual = metered GB wind (FUELHH, fuel type WIND) for the half hour starting on the forecast hour.</li>
          <li>
            Range and bias correction use errors from days D−15 to D−2, the last two weeks fully metered when the
            decision is made.
          </li>
          <li>
            Naive guess = the last metered half hour that had finished at decision time, held flat across the delivery
            day. Any forecast worth paying for should beat it.
          </li>
          <li>Over-forecasting is largest in high wind, which matches wind farms being curtailed when the grid is full.</li>
        </ul>
      </Card>
    </>
  );
}
