// WindDesk backend API contract (see README). No mock data lives here:
// every number on screen comes from these endpoints or is computed from them.

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  '';
// Empty means same-origin: the browser calls /api/... on whatever host serves
// the app. Locally, Vite proxies /api to localhost:8000 (see vite.config.ts);
// on Vercel, /api/* is rewritten to the Python function. Set VITE_API_URL only
// to point at a separately hosted backend.

export interface Health {
  status: string;
  source: 'live' | 'snapshot';
  actual_days: number;
  forecast_runs: number;
}

export interface Config {
  cutoff: string; // "HH:MM" UTC, e.g. "17:00"
  cutoff_note?: string;
}

export interface MonthDay {
  date: string; // YYYY-MM-DD
  forecast_gwh: number;
  actual_gwh: number;
  mae_mw: number;
  bias_mw: number;
  rmse_mw: number;
  largest_shortfall_mw: number;
  largest_shortfall_time: string;
}

export interface MonthSummary {
  month: string; // "2026-01"
  days: MonthDay[];
}

export interface Run {
  published: string;
  label: string;
  total_gwh: number;
  values: number[]; // 48 half-hour MW values
}

export interface TableRow {
  time: string;
  forecast: number;
  actual: number;
  error: number;
  position: string;
}

export interface DayKpis {
  forecast_gwh: number;
  actual_gwh: number;
  mae_mw: number;
  bias_mw: number;
  rmse_mw: number;
  largest_shortfall_mw: number;
  largest_shortfall_time: string;
}

export interface DayData {
  date: string;
  cutoff: string;
  latest_run_published: string;
  runs: Run[];
  actual: number[]; // 48 half-hour MW values
  times: string[]; // 48 "HH:MM" labels
  kpis: DayKpis;
  table: TableRow[];
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`);
  } catch {
    throw new Error(`Could not reach the WindDesk API at ${API_BASE}.`);
  }
  if (!res.ok) throw new Error(`WindDesk API returned ${res.status} for ${path}.`);
  return (await res.json()) as T;
}

export const fetchHealth = () => get<Health>('/api/health');
export const fetchConfig = () => get<Config>('/api/config');
export const fetchMonth = () => get<MonthSummary>('/api/months/2026-01/summary');
export const fetchDay = (date: string) => get<DayData>(`/api/days/${date}`);
