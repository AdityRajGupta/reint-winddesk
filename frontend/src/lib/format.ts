// Formatting helpers, mirroring the reference UI's conventions.

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-GB');
}

export function gw(v: number): string {
  return (v / 1000).toFixed(1);
}

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "2026-01-15" -> Date at UTC midnight (no local-timezone drift). */
export function parseDay(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "2026-01-15" -> "15 Jan 2026". */
export function dayLabel(date: string): string {
  const dt = parseDay(date);
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

/** "2026-01" -> "January 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${names[m - 1]} ${y}`;
}

/**
 * Decision-day label, as in the reference UI: the day before delivery,
 * e.g. "31 Dec" for 1 Jan, otherwise "14 Jan".
 */
export function decisionDayLabel(date: string): string {
  const dt = parseDay(date);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

/** Monday-first weekday index (Mon=0..Sun=6) for a YYYY-MM-DD date. */
export function dow(date: string): number {
  return (parseDay(date).getUTCDay() + 6) % 7;
}

export function dowName(date: string): string {
  return DAYS[dow(date)];
}

/**
 * Format a published timestamp for display, e.g. ISO "2026-01-14T17:00:00Z"
 * -> "14 Jan 17:00". Unparseable values are returned unchanged.
 */
export function publishedLabel(published: string): string {
  const t = Date.parse(published);
  if (Number.isNaN(t)) return published;
  const dt = new Date(t);
  const hh = String(dt.getUTCHours()).padStart(2, '0');
  const mm = String(dt.getUTCMinutes()).padStart(2, '0');
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${hh}:${mm}`;
}

/** Hours between a run's published time and the delivery day's UTC midnight. */
export function runAgeHours(published: string, deliveryDate: string): number | null {
  const t = Date.parse(published);
  if (Number.isNaN(t)) return null;
  return (parseDay(deliveryDate).getTime() - t) / 3600000;
}

/** Exact per-run metrics computed from 48 half-hour values (never estimated). */
export function computeRunMetrics(values: number[], actual: number[]) {
  let ae = 0;
  let se = 0;
  let be = 0;
  let minE = Infinity;
  let minH = 0;
  for (let h = 0; h < 48; h++) {
    const e = actual[h] - values[h];
    ae += Math.abs(e);
    se += e * e;
    be += e;
    if (e < minE) {
      minE = e;
      minH = h;
    }
  }
  const total = values.reduce((a, b) => a + b, 0) / 2 / 1000;
  return {
    mae: ae / 48,
    rmse: Math.sqrt(se / 48),
    bias: be / 48,
    total,
    largestShortfall: minE,
    largestShortfallH: minH,
  };
}

/** Table position, using the reference UI's ±100 MW thresholds. */
export function positionFor(error: number): string {
  if (error < -100) return 'Shortfall';
  if (error > 100) return 'Surplus';
  return 'On track';
}
