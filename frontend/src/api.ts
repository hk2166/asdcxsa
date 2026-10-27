// Types mirror the JSON returned by backend/app/analysis.py. All power values are MW.

export type Summary = {
  n: number;
  mae: number; // mean absolute error
  rmse: number;
  bias: number; // mean of (forecast - actual); positive = over-forecast
  wape: number; // total absolute error / total actual
  p10: number;
  p50: number;
  p90: number;
  within_1gw: number; // share of hours with |error| <= 1000 MW
};

export type Hour = {
  time: string; // start of the hour, ISO UTC
  forecast: number | null;
  expected: number | null; // forecast corrected for recent bias
  low: number | null;
  high: number | null;
  actual: number | null; // half hour starting at `time`
  actual_half: number | null; // half hour starting 30 min later
};

export type DayView = {
  day: string;
  gate_closure: string;
  runs_used: string[];
  band: { error_p10: number; error_p50: number; error_p90: number; days: number } | null;
  hours: Hour[];
  totals_mwh: Record<"forecast" | "expected" | "low" | "high", number | null>;
  outcome: Summary;
};

export type DayRow = {
  day: string; // delivery day, YYYY-MM-DD
  mae: number | null;
  bias: number | null; // mean of (forecast - actual)
  forecast_mwh: number | null;
  actual_mwh: number | null;
};

export type Accuracy = {
  summary: Summary;
  adjusted_summary: Summary;
  naive_summary: Summary; // "wind stays as it is at decision time", same hours
  band_coverage: number | null;
  days: DayRow[];
  timeline: { time: string; forecast: number | null; expected: number | null; actual: number | null }[];
  by_level: { from_mw: number; to_mw: number; n: number; mean_error: number; mae: number }[];
  histogram: { from_mw: number; to_mw: number; count: number }[];
  by_horizon: { from_h: number; to_h: number; n: number; mae: number }[];
  decision_horizon_h: [number, number] | null;
};

export type Meta = {
  delivery_days: string[];
  gates: { time: string; label: string }[];
  source: string;
};

// One request per URL for the life of the page. The data never changes, so a view
// that was shown (or prefetched) once opens instantly the next time.
const requests = new Map<string, Promise<unknown>>();

function get<T>(path: string): Promise<T> {
  let request = requests.get(path) as Promise<T> | undefined;
  if (!request) {
    request = fetch(path).then(async (res) => {
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    });
    request.catch(() => requests.delete(path)); // a failed request is retried next time
    requests.set(path, request);
  }
  return request;
}

/** Start loading in the background; errors surface when the view itself asks. */
export const prefetch = (load: () => Promise<unknown>) => void load().catch(() => {});

export const api = {
  meta: () => get<Meta>("/api/meta"),
  day: (day: string, gate: string) => get<DayView>(`/api/day/${day}?gate=${gate}`),
  accuracy: (gate: string) => get<Accuracy>(`/api/accuracy?gate=${gate}`),
};
