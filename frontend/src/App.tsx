import { useEffect, useState } from "react";
import { AccuracyView } from "./AccuracyView";
import { api, type Meta } from "./api";
import { DecisionView } from "./DecisionView";
import { dayLabel } from "./format";
import { Failed, Loading } from "./ui";

type Tab = "decision" | "accuracy";

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DayPicker({ days, day, onChange }: { days: string[]; day: string; onChange: (d: string) => void }) {
  const i = days.indexOf(day);
  return (
    <div className="day-picker">
      <button aria-label="Previous day" disabled={i <= 0} onClick={() => onChange(days[i - 1])}>‹</button>
      <select aria-label="Delivery day" value={day} onChange={(e) => onChange(e.target.value)}>
        {days.map((d) => (
          <option key={d} value={d}>
            {dayLabel(d)}
          </option>
        ))}
      </select>
      <button aria-label="Next day" disabled={i >= days.length - 1} onClick={() => onChange(days[i + 1])}>›</button>
    </div>
  );
}

// The current view lives in the URL (?view=accuracy&gate=09:50&day=2026-01-20) so it can be shared.
const initial = new URLSearchParams(window.location.search);

export default function App() {
  const [meta, setMeta] = useState<Meta>();
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>(initial.get("view") === "accuracy" ? "accuracy" : "decision");
  const [gate, setGate] = useState(initial.get("gate") ?? "09:20");
  const [day, setDay] = useState(initial.get("day") ?? "2026-01-15");

  useEffect(() => {
    api.meta().then(setMeta, (e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ view: tab, gate, ...(tab === "decision" && { day }) });
    window.history.replaceState(null, "", `?${params}`);
  }, [tab, gate, day]);

  return (
    <div className="app">
      <header>
        <h1>Wind Forecast Desk</h1>
        <p className="muted">GB wind forecasts for day-ahead power buying · decisions made in January 2026</p>
      </header>

      {error && <Failed error={error} />}
      {!meta && !error && <Loading />}
      {meta && (
        <>
          <nav className="controls">
            <Segmented
              label="View"
              value={tab}
              onChange={setTab}
              options={[
                { value: "decision", label: "Decision day" },
                { value: "accuracy", label: "Forecast accuracy" },
              ]}
            />
            <div className="control">
              <span className="muted">Gate closure</span>
              <Segmented label="Gate closure" value={gate} onChange={setGate} options={meta.gates.map((g) => ({ value: g.time, label: g.label }))} />
            </div>
            {tab === "decision" && (
              <div className="control">
                <span className="muted">Delivery day</span>
                <DayPicker days={meta.delivery_days} day={day} onChange={setDay} />
              </div>
            )}
          </nav>
          <main>{tab === "decision" ? <DecisionView day={day} gate={gate} /> : <AccuracyView gate={gate} />}</main>
        </>
      )}

      <footer className="muted">
        Source: {meta?.source ?? "Elexon BMRS"}. Times in UK local time. GB day-ahead auctions close the day before delivery:
        EPEX at 09:20, N2EX at 09:50.
      </footer>
    </div>
  );
}
