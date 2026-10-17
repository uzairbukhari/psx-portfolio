// The public data pipelines the admin console watches: what each one is, how often it should land, and the rules that
// turn "when did it last succeed" into ok / late / failing / idle. Pure (no Workers imports) so tests can check the rules.

export type PipelineStatus = 'ok' | 'late' | 'failing' | 'idle';
export type PipelineAction = 'refresh-funds';

export type PipelineDef = {
  id: string;
  label: string;
  /** Plain-language schedule shown in the table. */
  expected: string;
  /** `market`: every few minutes while the market is open. `daily`/`weekly`: judged on weekday-adjusted age. */
  cadence: 'market' | 'daily' | 'weekly';
  /** Weekday-adjusted hours since the last success before the row is "late", and before it is "failing". */
  lateHours: number;
  failHours: number;
  /** A required pipeline that has never succeeded is "failing"; an optional one is "idle". */
  required: boolean;
  workflow: string | null;
  action: PipelineAction | null;
};

export const PIPELINES: readonly PipelineDef[] = [
  { id: 'quotes', label: 'PSX quotes', expected: 'Every 5 minutes while the market is open', cadence: 'market', lateHours: 0.5, failHours: 1.5, required: true, workflow: 'psx-quotes.yml', action: null },
  { id: 'history', label: 'Price history', expected: 'Every 15 minutes while open, plus after close', cadence: 'market', lateHours: 0.75, failHours: 2, required: false, workflow: 'psx-history.yml', action: null },
  { id: 'facts', label: 'Company facts', expected: 'Daily after close', cadence: 'daily', lateHours: 36, failHours: 84, required: true, workflow: 'psx-facts.yml', action: null },
  { id: 'dividends', label: 'Dividend announcements', expected: 'Twice a day on weekdays', cadence: 'daily', lateHours: 72, failHours: 168, required: false, workflow: 'psx-payouts.yml', action: null },
  { id: 'directory', label: 'Company directory', expected: 'Daily after close', cadence: 'daily', lateHours: 72, failHours: 168, required: false, workflow: 'psx-directory.yml', action: null },
  { id: 'face-values', label: 'Face values', expected: 'Weekly (Sunday)', cadence: 'weekly', lateHours: 8 * 24, failHours: 15 * 24, required: false, workflow: 'psx-face-values.yml', action: null },
  { id: 'metals', label: 'Gold and silver rates', expected: 'Three times a day, Monday to Saturday', cadence: 'daily', lateHours: 30, failHours: 72, required: true, workflow: 'metal-rates.yml', action: null },
  { id: 'fx', label: 'Foreign currency rates', expected: 'Twice a day, Monday to Saturday', cadence: 'daily', lateHours: 30, failHours: 72, required: true, workflow: 'fx-rates.yml', action: null },
  { id: 'funds', label: 'MUFAP funds and prices', expected: 'Daily (cron Worker)', cadence: 'daily', lateHours: 36, failHours: 84, required: true, workflow: null, action: 'refresh-funds' },
  { id: 'ai-research', label: 'AI research', expected: 'Weekly (Saturday), experimental', cadence: 'weekly', lateHours: 9 * 24, failHours: 21 * 24, required: false, workflow: 'ai-research.yml', action: null },
];

const HOUR = 3_600_000;
const PKT_OFFSET = 5 * HOUR;
const DAY = 24 * HOUR;

/** Hours between two instants, leaving out Saturdays and Sundays in Pakistan time (nothing is expected to run). */
export function weekdayAdjustedHours(from: Date, to: Date): number {
  let cursor = from.getTime();
  const end = to.getTime();
  let ms = 0;
  while (cursor < end) {
    const local = cursor + PKT_OFFSET;
    const next = (Math.floor(local / DAY) + 1) * DAY - PKT_OFFSET;
    const weekday = new Date(local).getUTCDay();
    if (weekday !== 0 && weekday !== 6) ms += Math.min(next, end) - cursor;
    cursor = next;
  }
  return ms / HOUR;
}

export type PipelineVerdict = { status: PipelineStatus; ageMinutes: number | null };

/**
 * Status of one pipeline. `error` is the latest recorded failure; one newer than the last success keeps the row from
 * reading "ok" even though older data exists.
 */
export function pipelineStatus(
  def: PipelineDef,
  lastSuccessAt: string | null,
  error: { at: string | null } | null,
  now: Date,
  marketOpen: boolean,
): PipelineVerdict {
  const last = lastSuccessAt ? new Date(lastSuccessAt) : null;
  if (!last || Number.isNaN(last.getTime())) return { status: def.required ? 'failing' : 'idle', ageMinutes: null };
  const ageMinutes = Math.max(0, Math.round((now.getTime() - last.getTime()) / 60_000));
  // While the market is closed a market pipeline is only judged against the last session, like a daily one.
  const live = def.cadence === 'market' && marketOpen;
  const hours = live ? ageMinutes / 60 : weekdayAdjustedHours(last, now);
  const late = def.cadence === 'market' && !marketOpen ? 30 : def.lateHours;
  const fail = def.cadence === 'market' && !marketOpen ? 72 : def.failHours;
  let status: PipelineStatus = hours <= late ? 'ok' : hours <= fail ? 'late' : 'failing';
  const errorAt = error?.at ? new Date(error.at) : null;
  if (status === 'ok' && errorAt && errorAt.getTime() > last.getTime()) status = 'late';
  return { status, ageMinutes };
}

const RANK: Record<PipelineStatus, number> = { ok: 0, idle: 0, late: 1, failing: 2 };
export const worst = (a: PipelineStatus, b: PipelineStatus): PipelineStatus => (RANK[b] > RANK[a] ? b : a);
