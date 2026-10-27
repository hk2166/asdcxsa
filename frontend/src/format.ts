// Number and time formatting. Every time is shown in UK local time.

const UK = "Europe/London";
type Num = number | null | undefined;

export const gw = (mw: Num, digits = 1) => (mw == null ? "–" : `${(mw / 1000).toFixed(digits)} GW`);
export const signedGw = (mw: Num) => (mw == null ? "–" : `${mw > 0 ? "+" : mw < 0 ? "−" : ""}${gw(Math.abs(mw))}`);
export const gwh = (mwh: Num) => (mwh == null ? "–" : `${Math.round(mwh / 1000).toLocaleString("en-GB")} GWh`);
export const mw = (v: Num) => (v == null ? "–" : Math.round(v).toLocaleString("en-GB"));
export const pct = (x: Num) => (x == null ? "–" : `${Math.round(x * 100)}%`);

const fmt = (options: Intl.DateTimeFormatOptions) => {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: UK, ...options });
  return (t: string | number) => f.format(new Date(t));
};

export const clock = fmt({ hour: "2-digit", minute: "2-digit" }); // 09:20
export const dayLabel = fmt({ weekday: "short", day: "numeric", month: "short" }); // Thu 15 Jan
export const dayShort = fmt({ day: "numeric", month: "short" }); // 15 Jan
export const dateTime = fmt({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Y axis from 0 with round GW steps (Recharts' own picks give 4.5, 9, 13.5...). */
export function gwAxis(maxMw: number) {
  const step = maxMw > 12000 ? 5000 : maxMw > 5000 ? 2000 : 1000;
  const top = Math.max(step, Math.ceil(maxMw / step) * step);
  return { domain: [0, top], ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) };
}

export const hoursMinutes = (ms: number) => {
  const mins = Math.round(ms / 60000);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
};
