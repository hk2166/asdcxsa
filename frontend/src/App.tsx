import { useEffect, useState } from "react";
import { AccuracyView } from "./AccuracyView";
import { api, prefetch, type Meta } from "./api";
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

const CUSTOM = "custom";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:MM, same rule as the API

// The current view lives in the URL (?view=accuracy&gate=09:50&day=2026-01-20) so it can be shared.
const initial = new URLSearchParams(window.location.search);
const initialTab: Tab = initial.get("view") === "accuracy" ? "accuracy" : "decision";
const initialGate = TIME.test(initial.get("gate") ?? "") ? initial.get("gate")! : "09:20";
const initialDay = initial.get("day") ?? "2026-01-15";

// Ask for the first view's data now, alongside /api/meta, instead of after it.
prefetch(initialTab === "accuracy" ? () => api.accuracy(initialGate) : () => api.day(initialDay, initialGate));

export default function App() {
  const [meta, setMeta] = useState<Meta>();
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [gate, setGate] = useState(initialGate);
  const [day, setDay] = useState(initialDay);
  const [customPicked, setCustomPicked] = useState(false);

  useEffect(() => {
    api.meta().then(setMeta, (e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ view: tab, gate, ...(tab === "decision" && { day }) });
    window.history.replaceState(null, "", `?${params}`);
  }, [tab, gate, day]);

  // Load what's likely next (the neighbouring days and the other view) so it opens instantly.
  useEffect(() => {
    if (!meta) return;
    const timer = setTimeout(() => {
      const i = meta.delivery_days.indexOf(day);
      for (const d of [meta.delivery_days[i - 1], meta.delivery_days[i + 1]]) if (d) prefetch(() => api.day(d, gate));
      prefetch(() => api.accuracy(gate));
    }, 300);
    return () => clearTimeout(timer);
  }, [meta, day, gate]);

  // A decision time that isn't an auction gate (from the picker or a shared link) is "custom".
  const atGate = !customPicked && (meta?.gates.some((g) => g.time === gate) ?? true);
  const openDay = (d: string) => {
    setDay(d);
    setTab("decision");
    window.scrollTo({ top: 0 });
  };

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
              <span className="muted">Decision time</span>
              <Segmented
                label="Decision time"
                value={atGate ? gate : CUSTOM}
                onChange={(v) => {
                  setCustomPicked(v === CUSTOM);
                  if (v !== CUSTOM) setGate(v);
                }}
                options={[...meta.gates.map((g) => ({ value: g.time, label: g.label })), { value: CUSTOM, label: "Custom" }]}
              />
              {!atGate && (
                <input
                  className="time-input"
                  type="time"
                  aria-label="Custom decision time, UK time on the day before delivery"
                  value={gate}
                  onChange={(e) => TIME.test(e.target.value) && setGate(e.target.value)}
                />
              )}
            </div>
            {tab === "decision" && (
              <div className="control">
                <span className="muted">Delivery day</span>
                <DayPicker days={meta.delivery_days} day={day} onChange={setDay} />
              </div>
            )}
          </nav>
          <main>
            {tab === "decision" ? (
              <DecisionView day={day} gate={gate} atGate={atGate} />
            ) : (
              <AccuracyView gate={gate} atGate={atGate} onOpenDay={openDay} />
            )}
          </main>
        </>
      )}

      <footer className="muted">
        Source: {meta?.source ?? "Elexon BMRS"}. Times in UK local time. GB day-ahead auctions close the day before delivery:
        EPEX at 09:20, N2EX at 09:50.
      </footer>
    </div>
  );
}
