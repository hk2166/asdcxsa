import { useEffect, useState, type ReactNode } from "react";
import type { TooltipContentProps } from "recharts";

/** Load data whenever `key` changes. Keeps showing the old data while the new loads (no flicker). */
export function useData<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setState({ data }),
      (err) => live && setState((s) => ({ ...s, error: String(err) })),
    );
    return () => {
      live = false;
    };
  }, [key]); // `load` is a new function every render, so `key` decides when to refetch
  return state;
}

export function Stat({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function Card({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      {subtitle && <p className="card-subtitle">{subtitle}</p>}
      {children}
    </section>
  );
}

export type Series = { key: string; label: string; color: string; band?: boolean };

export function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="legend">
      {series.map((s) => (
        <li key={s.key}>
          <span className={s.band ? "key key-band" : "key"} style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

type TipProps = TooltipContentProps & {
  title: (label: unknown) => string;
  value: (v: number) => string;
};

/** One tooltip listing every series at the hovered point. Values lead, labels follow. */
export function Tip({ active, payload, label, title, value }: TipProps) {
  if (!active || !payload?.length) return null;
  const blank = (v: unknown) => v == null || (Array.isArray(v) && v.some((x) => x == null));
  const rows = payload.filter((p) => !blank(p.value));
  return (
    <div className="tooltip">
      <div className="tooltip-title">{title(label)}</div>
      {rows.map((p) => (
        <div className="tooltip-row" key={String(p.dataKey)}>
          <span className="key" style={{ background: p.color }} />
          <strong>{Array.isArray(p.value) ? p.value.map((v) => value(Number(v))).join(" – ") : value(Number(p.value))}</strong>
          <span>{p.name}</span>
        </div>
      ))}
    </div>
  );
}

export const Loading = () => <p className="muted">Loading…</p>;
export const Failed = ({ error }: { error: string }) => <p className="error">Couldn’t load data: {error}</p>;
