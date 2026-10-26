// One place for how the Analytics lenses write numbers and names, so every tile, table and tooltip agrees.
// Pure module.

/** 1,234 or 12.3K. */
export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return Math.round(n).toLocaleString('en-US');
}

/** A share (0..1) as a percent with one decimal below 10% and none above. */
export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const v = n * 100;
  return `${Math.abs(v) < 10 && v !== 0 ? v.toFixed(1) : Math.round(v)}%`;
}

/** 45s, 3m 20s, 1h 05m, 2.5d. */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '–';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${(h / 24).toFixed(1).replace(/\.0$/, '')}d`;
}

export function fmtValue(v: number | null, format: 'count' | 'pct' | 'duration'): string {
  return format === 'pct' ? fmtPct(v) : format === 'duration' ? fmtDuration(v) : fmtCount(v);
}

/**
 * The change from `previous` to `value`: percentage points for shares, a relative percent otherwise. `good` says
 * whether the change is good news given which direction is better; null when there is nothing to compare.
 */
export function delta(value: number | null, previous: number | null, format: 'count' | 'pct' | 'duration', better: 'up' | 'down') {
  if (value === null || previous === null) return null;
  if (value === previous) return { text: 'No change', good: null as boolean | null, dir: 'flat' as const };
  const up = value > previous;
  const good = up === (better === 'up');
  if (format === 'pct') {
    const pts = (value - previous) * 100;
    return { text: `${up ? '+' : '−'}${Math.abs(pts).toFixed(Math.abs(pts) < 10 ? 1 : 0)} pts`, good, dir: up ? ('up' as const) : ('down' as const) };
  }
  if (!previous) return { text: 'New', good, dir: up ? ('up' as const) : ('down' as const) };
  const rel = ((value - previous) / previous) * 100;
  return { text: `${up ? '+' : '−'}${Math.abs(rel) < 10 ? Math.abs(rel).toFixed(1) : Math.round(Math.abs(rel))}%`, good, dir: up ? ('up' as const) : ('down' as const) };
}

const SPECIAL: Record<string, string> = {
  sip: 'Monthly Picks',
  sip_tracker: 'SIP Blueprint',
  plan: 'Plan',
  reports: 'Insights',
  holdings: 'Holdings',
  overview: 'All portfolios',
  ai_lab: 'AI Lab',
  gold_silver: 'Gold & silver',
  picks_run_completed: 'Monthly Picks run',
  picks_run_started: 'Monthly Picks started',
  picks_run_failed: 'Monthly Picks failed',
  targets_saved: 'SIP targets saved',
  web: 'Web',
  android: 'Android',
  ios: 'iPhone',
  direct: 'Direct',
  whatsapp: 'WhatsApp',
  macos: 'macOS',
  ios_app: 'iPhone app',
  chromeos: 'ChromeOS',
  app: 'Phone app',
  exit: 'Left the app',
  start: 'Opened the app',
  other: 'Other',
  unknown: 'Unknown',
};

/** A catalog name ("entry_added") as words ("Entry added"). */
export function humanize(name: string): string {
  if (SPECIAL[name]) return SPECIAL[name];
  const t = name.replaceAll('_', ' ');
  return t ? t[0].toUpperCase() + t.slice(1) : name;
}

/** A path node ("screen:reports" or "entry_added") or funnel alternative as words. */
export function nodeLabel(node: string): string {
  return node.startsWith('screen:') ? humanize(node.slice(7)) : humanize(node);
}

/** A funnel step ("screen_viewed:screen=reports|entry_added") as words. */
const NAMED_STEPS: Record<string, string> = {
  'entry_added|import_completed|asset_added': 'Added a first holding',
  'entry_added|import_completed': 'Added a holding or import',
};

export function stepLabel(step: string): string {
  if (NAMED_STEPS[step]) return NAMED_STEPS[step];
  return step
    .split('|')
    .map((part) => {
      const [event, match] = part.split(':');
      if (!match) return humanize(event);
      const value = match.split('=')[1];
      if (event === 'screen_viewed') return `Opened ${humanize(value)}`;
      if (event === 'dialog_opened') return `Opened ${humanize(value)} dialog`;
      if (event === 'dialog_closed') return value === 'done' ? 'Saved the dialog' : 'Closed without saving';
      return `${humanize(event)}: ${humanize(value)}`;
    })
    .join(' or ');
}

/** A bucket name from the catalog ("under_1s", "p6_20") as words. */
export function bucketLabel(b: string): string {
  const map: Record<string, string> = {
    under_250ms: '< 250 ms', under_1s: '< 1 s', under_3s: '< 3 s', under_10s: '< 10 s', over_10s: '10 s +',
    cls_low: '< 0.1', cls_mid: '< 0.25', cls_high: '0.25 +',
    none: 'None', p1_5: '1–5', p6_20: '6–20', p21_plus: '21 +',
    one: 'One', two: 'Two', three_plus: 'Three +',
    stocks: 'Stocks only', multi: 'Stocks and more',
    week: 'Under a week', month: 'Under a month', half_year: 'Under 6 months', older: 'Older', empty: 'Empty',
  };
  return map[b] ?? humanize(b);
}

/** "12 Oct" from an ISO day. */
export function shortDate(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Rows as CSV text (values quoted when needed). */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}
